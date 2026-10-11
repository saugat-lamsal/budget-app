import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BankTransaction, IsoDate } from '@budget-app/money';
import { openDatabase, type Db } from '../../../../server/src/db/database.js';
import { Keeper } from '../../../../server/src/history/keeper.js';
import { memoryLog, type LogLine } from '../../../../server/src/log.js';
import { serveBooks } from '../../../../server/src/serve/serving.js';
import type { SyncTimer } from '../../../../server/src/serve/sync-timer.js';
import { FakeClock } from '../../../../server/test/fake-clock.js';
import { FakePhone } from '../../../../server/test/fake-phone.js';
import { connected, type Harness } from '../../../../server/test/harness.js';
import { SIM_BANK_RULES, inPlaidFormat } from '../../../../server/test/sim-bank.js';
import type { Period } from './period.js';

// The real server, as npm run serve runs it (serveBooks: the screens behind
// the login, and the timer that syncs with the bank by itself), with its books
// in a database file of its own and the made-up bank in Plaid's format (the
// simulator's bank, sim-bank.ts). Time moves only when the test moves it: the
// books and the sync timer read the same clock (FakeClock), so the bank's
// activity reaches the books only when the timer syncs. Stopped and started
// again, it opens the books from the database file, as a restart would.

// The bank rules that come with the bank connection: the simulator's, but for
// payments to people from checking, which he adds on Setup day.
export const ZELLE_FROM_CHECKING = 'ZELLE TO ';
export const BANK_RULES_AT_CONNECTION = SIM_BANK_RULES.filter((r) => r.id !== 'zelle-checking');

// A time of day in New York in October (EDT, UTC-4), as the clock says it.
export const atNewYork = (day: IsoDate, hour: number, minute = 0): Date => new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), hour + 4, minute));

// How it is served: the built screens, and listening and closing (the browser
// tests' own, harness.ts; the agent's server has its own).
export interface Serving {
  readonly webRoot: string;
  listen(server: Server): Promise<string>;
  close(server: Server): Promise<void>;
}

export class RealServer {
  readonly clock: { now: Date };
  readonly fakeClock: FakeClock;
  readonly lines: LogLine[] = [];
  readonly #dir: string;
  readonly #path: string;
  readonly h: Harness;
  readonly #serving: Serving;
  keeper!: Keeper;
  #server: Server | undefined;
  #timer: SyncTimer | undefined;
  base = '';
  restarts = 0;
  syncs = 0;

  private constructor(h: Harness, dir: string, path: string, now: Date, serving: Serving) {
    this.h = h;
    this.#serving = serving;
    this.#dir = dir;
    this.#path = path;
    this.clock = { now };
    this.fakeClock = new FakeClock(this.clock);
  }

  // An empty database with the made-up bank connected (npm run serve -- --connect),
  // its history read, before setup day.
  static async start(period: Period, now: Date, serving: Serving): Promise<RealServer> {
    const dir = mkdtempSync(join(tmpdir(), 'budget-pay-period-'));
    const path = join(dir, 'books.sqlite');
    const { start, feed, input } = period.setup;
    const h = await connected({
      posted: { checking: start.checking, savings: start.savings, everyday: start.everydayCard, old: start.oldCard },
      history: (fake) => {
        for (const txn of feed) inPlaidFormat(fake, txn);
      },
      rules: BANK_RULES_AT_CONNECTION,
      today: input.date,
      path,
    });
    const real = new RealServer(h, dir, path, now, serving);
    real.#open();
    await real.#serve();
    return real;
  }

  get db(): Db {
    return this.h.db;
  }

  #open(): void {
    this.keeper = Keeper.open({ db: this.h.db, now: () => this.clock.now, log: memoryLog(this.lines), origin: () => this.base });
  }

  async #serve(): Promise<void> {
    const { server, timer } = serveBooks({
      keeper: this.keeper,
      bank: { plaid: this.h.plaid, box: this.h.box, log: memoryLog(this.lines), pageSize: 3 },
      clock: this.fakeClock,
      webRoot: this.#serving.webRoot,
      origin: () => this.base,
      // The alerts (Phase 5) are not looked at in the pay period: their timer
      // is not started, so the server works as it did for Phase 4.
      sender: new FakePhone(() => this.clock.now),
    });
    this.#server = server;
    this.#timer = timer;
    // Passkeys are made for the app's host name: localhost, as npm run serve prints it.
    this.base = (await this.#serving.listen(server)).replace('127.0.0.1', 'localhost');
    timer.start();
    await timer.idle();
  }

  // Stopped (the timer first, letting a sync on its way finish), and started
  // again from the database file: the history replays to its totals first.
  async restart(): Promise<void> {
    await this.#stop();
    this.h.db.close();
    (this.h as { db: Db }).db = openDatabase(this.#path);
    this.#open();
    await this.#serve();
    this.restarts += 1;
  }

  async #stop(): Promise<void> {
    await this.#timer?.stop();
    if (this.#server !== undefined) await this.#serving.close(this.#server);
    this.#server = undefined;
  }

  // What the bank does, in Plaid's format; it reaches the books at the next sync.
  give(txns: readonly BankTransaction[]): void {
    for (const txn of txns) inPlaidFormat(this.h.fake, txn);
  }

  // Moves the clock on to a moment, running the timer's syncs on the way.
  async moveTo(when: Date): Promise<void> {
    const ms = when.getTime() - this.clock.now.getTime();
    if (ms < 0) throw new Error(`the clock cannot go back from ${this.clock.now.toISOString()} to ${when.toISOString()}`);
    await this.fakeClock.advance(ms, () => this.#settle());
  }

  // Moves the clock on until the timer's next sync has run.
  async untilSynced(): Promise<void> {
    const before = this.keeper.lastRead();
    const due = this.keeper.syncDueIn();
    if (due === null) throw new Error('nothing to sync with');
    await this.fakeClock.advance(Math.max(0, due) + 1, () => this.#settle());
    if (this.keeper.lastRead() === before) throw new Error('the timer did not sync');
    this.syncs += 1;
  }

  async #settle(): Promise<void> {
    await this.#timer?.idle();
  }

  async done(): Promise<void> {
    await this.#stop();
    this.h.db.close();
    rmSync(this.#dir, { recursive: true, force: true });
  }
}
