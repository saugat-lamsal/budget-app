import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BankTransaction, IsoDate, SetupInput } from '@budget-app/money';
import { expect } from 'vitest';
import type { Posted } from '../../money/test/sim/bank.js';
import { liveALife, type DayStep, type ExpectedAlert, type RecordedAnswer, type RecordedBankDay } from '../../money/test/sim/life.js';
import { alertKey, type AlertFacts } from '../src/alerts/alerts.js';
import { outboxCounts, readOutbox } from '../src/alerts/outbox.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { readAccounts, readItems, saveItem } from '../src/db/store.js';
import { readPlaidItem } from '../src/bank/plaid-item.js';
import { readBankItem } from '../src/bank/reading.js';
import { rolesOf } from '../src/bank/stored-account.js';
import { bookOfSetup, replayCall, totalsOf, type BookCall } from '../src/history/history.js';
import { appendEvent, readHistory } from '../src/history/history-db.js';
import { Keeper, type SyncBank } from '../src/history/keeper.js';
import { instantIn, timeIn } from '../src/history/today.js';
import { memoryLog } from '../src/log.js';
import type { AlertTimer } from '../src/serve/alert-timer.js';
import { serveBooks } from '../src/serve/serving.js';
import { planSync, type Plan, type PlanInput } from '../src/sync/plan.js';
import { FakeClock } from './fake-clock.js';
import { FakePhone } from './fake-phone.js';
import { connected, type Harness } from './harness.js';
import { ACCOUNT, SIM_BANK_RULES, inPlaidFormat } from './sim-bank.js';

// Phase 5, part one: the simulated you (Phase 2) through the real server, with
// its alerts. The simulator lives its life and works out on its own, from the
// rulebook, which alerts are due after each step of each day (setup day, each
// sync, each answer, the evening at the daily review time). The real server
// lives the same days on a clock the test moves: the bank's activity reaches
// it only by syncs with the made-up bank (what the bank shows, its balances and
// its card statements), each answer is saved in its history, and its own
// alert timer works the alerts out, keeps them, and sends them to a fake phone.
// What its book is given is the simulator's own (the sync's test seam), so the
// two books are the same.
//
// Every day, every alert the simulator expects is in the outbox once, due at
// the right moment in his home time zone (the evening at 8:00 PM on both
// sides of Nov 1 and Mar 14), reached the phone exactly once, and nothing else
// was kept or sent: never a "totals do not match" alert, since the self-check
// passes all the way. Two ways:
// - one server for months: the phone fails now and then over the evening (the
//   alerts go once it answers again), and some syncs come in the night (they
//   go at once, A35's plain reading);
// - the server stopped every night and started every morning (the history
//   replays each time), down over the evening now and then (the evening's
//   alerts go when it is back, due 8:00 PM: A36's plain reading), a sync
//   failing now and then (tried again five minutes later), and the bank
//   wanting a login now and then (a "log in to your bank again" alert).
// ALERT_SIM_SEEDS, ALERT_SIM_FIRST_SEED and ALERT_SIM_YEARS run more lives of
// the second way. Every name and number is made up.

const MINUTE = 60_000;

interface Day extends RecordedBankDay {
  readonly answers: readonly RecordedAnswer[];
}

interface Lived {
  readonly start: Posted;
  readonly feed: readonly BankTransaction[];
  readonly input: SetupInput;
  readonly days: readonly Day[];
}

function liveAndRecord(seed: number, years: number): Lived {
  let setup: Omit<Lived, 'days'> | undefined;
  const days: Day[] = [];
  let answers: RecordedAnswer[] = [];
  const result = liveALife({
    seed,
    years,
    record: {
      setupDay: (s) => {
        setup = { start: s.start, feed: s.feed, input: s.input };
      },
      day: (day) => {
        days.push({ ...day, answers });
        answers = [];
      },
      answer: (a) => answers.push(a),
    },
  });
  if (!result.ok) throw new Error(`the simulated life failed on its own: seed ${seed}, ${result.date}, ${result.check}: ${result.message}`);
  if (setup === undefined) throw new Error('no setup day was recorded');
  return { ...setup, days };
}

// The simulator's expected alert as the server's facts (the daily review and
// the overdue alert are for the day they come on).
function factsOf(alert: ExpectedAlert, date: IsoDate): AlertFacts {
  switch (alert.kind) {
    case 'daily-review':
      return { kind: 'daily-review', date, waiting: alert.waiting };
    case 'card-overdue':
      return { kind: 'card-overdue', card: alert.card, dueDate: alert.dueDate, minimumPayment: alert.minimumPayment, date };
    default:
      return alert;
  }
}

// A small random number maker of its own, from the seed, for when things go wrong.
function randomFrom(seed: number): (outOf: number) => boolean {
  let state = seed * 2_654_435_761 + 1;
  return (outOf) => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) % outOf === 0;
  };
}

export type Way = 'one-server' | 'restarts';

interface Expected {
  readonly facts: AlertFacts;
  readonly dueAt: string;
  // When the phone should show it: at dueAt, or within this window after it.
  readonly shownBy: { readonly from: number; readonly to: number };
}

export interface Outcome {
  readonly days: number;
  readonly alerts: number;
  readonly late: number;
  readonly restarts: number;
  readonly nightSyncs: number;
  readonly failedSyncs: number;
  readonly logins: number;
  readonly offsets: ReadonlySet<string>;
}

export async function throughTheServer(seed: number, years: number, way: Way): Promise<Outcome> {
  const lived = liveAndRecord(seed, years);
  const { input, days } = lived;
  const zone = input.settings.homeTimeZone;
  const reviewTime = input.settings.dailyReviewTime;
  const at = (date: IsoDate, time: string, plusMs = 0): Date => new Date(instantIn(zone, date, time).getTime() + plusMs);
  const chance = randomFrom(seed);
  const dir = mkdtempSync(join(tmpdir(), 'budget-alerts-sim-'));
  const path = join(dir, 'books.sqlite');
  const clock = { now: at(input.date, '07:00') };
  const fakeClock = new FakeClock(clock);
  const phone = new FakePhone(() => clock.now);
  let h: Harness | undefined;
  let db: Db | undefined;
  let alerts: AlertTimer | undefined;
  const expected = new Map<string, Expected>();
  const outcome = { days: 0, alerts: 0, late: 0, restarts: 0, nightSyncs: 0, failedSyncs: 0, logins: 0, offsets: new Set<string>() };
  try {
    h = await connected({
      posted: { checking: lived.start.checking, savings: lived.start.savings, everyday: lived.start.everydayCard, old: lived.start.oldCard },
      history: (fake) => {
        for (const txn of lived.feed) inPlaidFormat(fake, txn);
      },
      rules: SIM_BANK_RULES,
      today: input.date,
      path,
    });
    const harness = h;
    db = h.db;
    // Setup day reads what the bank sent with his accounts and bank rules as
    // they are now (setup-day.ts); its book is the simulator's own.
    const roles = rolesOf(readAccounts(db));
    for (const item of readItems(db).values()) {
      const role = roles.get(item.accountId);
      const read = readPlaidItem(item.raw);
      if (role !== undefined && read.ok) saveItem(db, { ...item, kind: readBankItem(role, read.item.amount, read.item.description, SIM_BANK_RULES).kind });
    }
    appendEvent(db, { event: { kind: 'setup', input }, date: input.date, sync: null, totals: totalsOf(bookOfSetup(input)) });

    // What the next sync gives the book: the simulator's own transactions,
    // given only by a sync that goes through. The bank's items, balances and
    // statements are read from the made-up bank as always.
    let toGive: BankTransaction[] = [];
    const plan = (planInput: PlanInput): Plan => {
      const { items } = planSync({ ...planInput, book: null });
      const book = planInput.book;
      if (book === null) throw new Error('no book to give the bank to');
      const totals = toGive.map((txn) => {
        book.receive(txn);
        return totalsOf(book);
      });
      return { items, events: toGive, totals, attention: [] };
    };
    const bank: SyncBank = { plaid: h.plaid, box: h.box, log: memoryLog([]), pageSize: 100, plan };

    let keeper: Keeper | undefined;
    const start = (): void => {
      if (db === undefined) db = openDatabase(path);
      keeper = Keeper.open({ db, now: () => clock.now });
      const serving = serveBooks({ keeper, bank, clock: fakeClock, webRoot: 'C:/made-up/no-screens/', origin: () => '', sender: phone });
      alerts = serving.alerts;
      alerts.start();
    };
    const stop = async (): Promise<void> => {
      await alerts?.stop();
      alerts = undefined;
      keeper = undefined;
      db?.close();
      db = undefined;
      outcome.restarts += 1;
    };
    const settle = async (): Promise<void> => {
      await alerts?.idle();
    };
    // The clock moves on to the moment, with every timer of the server's at its own moment.
    const until = async (moment: Date, where: string): Promise<void> => {
      const ms = moment.getTime() - clock.now.getTime();
      if (ms < 0) throw new Error(`${where}: the steps of the day ran past ${moment.toISOString()}`);
      await fakeClock.advance(ms, settle);
    };
    const expect1 = (alertsDue: readonly ExpectedAlert[], date: IsoDate, dueAt: Date, shownTo = dueAt.getTime()): void => {
      for (const alert of alertsDue) {
        const facts = factsOf(alert, date);
        expected.set(alertKey(facts), { facts, dueAt: dueAt.toISOString(), shownBy: { from: dueAt.getTime(), to: shownTo } });
      }
    };
    // A sync; true when it went through.
    const sync = async (): Promise<boolean> => {
      if (keeper === undefined) throw new Error('the server is not running');
      let ok = false;
      try {
        const result = await keeper.sync(bank);
        ok = !result.needsLogin;
      } catch {
        ok = false;
      }
      if (ok) toGive = [];
      await settle();
      return ok;
    };

    clock.now = at(input.date, '08:00');
    start();
    await settle();
    let logins = 0;

    for (const day of days) {
      const where = `seed ${seed} (${way}), ${day.date}`;
      const morning = way === 'restarts' ? at(day.date, '07:30') : null;
      if (morning !== null && db === undefined) {
        await until(morning, where);
        start();
        await settle();
      }
      // The statements that closed today are at the bank before the morning sync.
      for (const s of day.statements) {
        harness.fake.setStatement(ACCOUNT[s.card], {
          is_overdue: false,
          last_payment_amount: null,
          last_payment_date: null,
          last_statement_issue_date: s.closingDate,
          last_statement_balance: s.statementBalance / 100,
          minimum_payment_amount: s.minimumPayment / 100,
          next_payment_due_date: s.dueDate,
        });
      }
      const steps = day.steps;
      let fed = 0;
      // Some days the first of the day's syncs comes in the night (one server only).
      const night = way === 'one-server' && steps.some((s) => s.kind === 'sync') && (chance(5) || day.date === '2026-11-01' || day.date === '2027-03-14');
      let daySteps = 0;
      let eveningSteps = 0;
      let nightDone = false;
      const runStep = async (step: DayStep): Promise<void> => {
        if (step.kind === 'setup') {
          expect1(step.alerts, day.date, at(day.date, '08:00'));
          return;
        }
        if (step.kind === 'evening') return;
        // The moment of the step.
        let moment: Date;
        if (night && !nightDone && step.kind === 'sync') {
          moment = at(day.date, '02:30');
          nightDone = true;
          outcome.nightSyncs += 1;
        } else if (step.phase === 'evening') moment = at(day.date, '18:00', 30_000 * eveningSteps++);
        else moment = at(day.date, '09:00', 10 * MINUTE * daySteps++);
        if (step.phase === 'evening' && moment.getTime() >= at(day.date, '19:59').getTime()) throw new Error(`${where}: too many evening steps`);
        if (step.phase === 'day' && moment.getTime() >= at(day.date, '18:00').getTime()) throw new Error(`${where}: too many day steps`);
        await until(moment, where);
        if (step.kind === 'sync') {
          const txns = day.feed.slice(fed, step.afterFeed);
          for (const txn of txns) inPlaidFormat(harness.fake, txn);
          toGive = [...toGive, ...txns];
          fed = step.afterFeed;
          // Now and then the bank cannot be reached: tried again five minutes later (day steps only).
          if (way === 'restarts' && step.phase === 'day' && chance(9)) {
            harness.fake.beforeCall = () => 'network';
            expect(await sync(), `${where}: a sync that cannot reach the bank`).toBe(false);
            harness.fake.beforeCall = undefined;
            outcome.failedSyncs += 1;
            moment = new Date(moment.getTime() + 5 * MINUTE);
            await until(moment, where);
          }
          expect(await sync(), `${where}: a sync`).toBe(true);
          expect1(step.alerts, day.date, moment);
          return;
        }
        // An answer: given to the running books and saved in their history, as the desk does.
        if (keeper === undefined || db === undefined) throw new Error(`${where}: the server is not running`);
        expect(fed, `${where}: the answer comes after what the bank sent before it`).toBe(day.answers[step.index]?.afterFeed);
        const answer = day.answers[step.index];
        const book = keeper.book();
        if (answer === undefined || book === null) throw new Error(`${where}: no answer ${step.index}`);
        const call: BookCall = { method: answer.method as BookCall['method'], args: answer.args };
        replayCall(book, call);
        appendEvent(db, { event: { kind: 'answer', answer: { book: [call] } }, date: day.date, sync: null, totals: totalsOf(book) });
        alerts?.poke();
        await settle();
        expect1(step.alerts, day.date, moment);
      };

      // The night sync, if any, comes first: it is the day's first sync.
      if (night) {
        const first = steps.findIndex((s) => s.kind === 'sync');
        const before = steps.slice(0, first);
        if (before.some((s) => s.kind === 'answer')) throw new Error(`${where}: an answer before the first sync`);
        for (const s of before) await runStep(s);
        await runStep(steps[first] as DayStep);
      }
      // The morning sync reads the statements (and the bank wanting a login, now and then).
      await until(at(day.date, '08:30'), where);
      if (way === 'restarts' && chance(12)) {
        harness.fake.needsLogin = true;
        expect(await sync(), `${where}: the bank wants a login`).toBe(false);
        logins += 1;
        outcome.logins += 1;
        expect1([], day.date, clock.now);
        const facts: AlertFacts = { kind: 'bank-login', time: logins };
        expected.set(alertKey(facts), { facts, dueAt: clock.now.toISOString(), shownBy: { from: clock.now.getTime(), to: clock.now.getTime() } });
        // He logs in again.
        await until(at(day.date, '08:45'), where);
        harness.fake.needsLogin = false;
      }
      expect(await sync(), `${where}: the morning sync`).toBe(true);
      for (const [i, step] of steps.entries()) {
        if (night && i <= steps.findIndex((s) => s.kind === 'sync')) continue;
        if (step.kind !== 'evening') await runStep(step);
      }
      expect(fed, `${where}: every bank transaction of the day was synced`).toBe(day.feed.length);

      // The evening, at the daily review time.
      const evening = at(day.date, reviewTime);
      const eveningAlerts = steps.filter((s) => s.kind === 'evening').flatMap((s) => s.alerts);
      outcome.offsets.add(timeIn(zone, evening).slice(-6));
      expect(timeIn(zone, evening).slice(11, 16), `${where}: the evening is at the review time on the clock`).toBe(reviewTime);
      if (way === 'one-server' && chance(6)) {
        // The phone cannot be reached from 7:55 PM to 8:12 PM: tried at 8:00, 8:01, 8:03, 8:07, and shown at 8:15.
        await until(at(day.date, '19:55'), where);
        phone.failing = 'the phone cannot be reached';
        await until(at(day.date, '20:12'), where);
        phone.failing = null;
        expect1(eveningAlerts, day.date, evening, at(day.date, '20:15').getTime());
        outcome.late += eveningAlerts.length;
      } else if (way === 'restarts' && chance(7)) {
        // Down over the evening: back at 9:30 PM, when the evening's alerts are worked out and sent.
        await until(at(day.date, '19:59'), where);
        await stop();
        await until(at(day.date, '21:30'), where);
        start();
        await settle();
        expect1(eveningAlerts, day.date, evening, at(day.date, '21:30').getTime());
        outcome.late += eveningAlerts.length;
      } else expect1(eveningAlerts, day.date, evening);
      await until(at(day.date, '23:00'), where);

      // The end of the day: the outbox, the phone, and nothing else.
      const kept = readOutbox(db as Db, 1_000_000).rows.map((r) => [r.key, r.dueAt] as const);
      const wanted = [...expected.entries()].map(([key, e]) => [key, e.dueAt] as const);
      const byKey = (a: readonly [string, string], b: readonly [string, string]): number => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      if (process.env["ALERT_SIM_DEBUG"] !== undefined) appendFileSync(process.env["ALERT_SIM_DEBUG"], `${where} ${Math.round(performance.now() / 1000)} s ${expected.size} alerts, memory MB ${JSON.stringify(Object.fromEntries(Object.entries(process.memoryUsage()).map(([k, v]) => [k, Math.round(v / 1_048_576)])))}\n`);
      expect(kept.toSorted(byKey), `${where}: every alert kept once, due at its moment, and nothing else`).toEqual(wanted.toSorted(byKey));
      expect(outboxCounts(db as Db).notSent, `${where}: everything sent by the end of the day`).toBe(0);
      expect(phone.ids().toSorted(), `${where}: every alert shown on the phone, and nothing else`).toEqual([...expected.keys()].toSorted());
      expect(phone.repeats, `${where}: nothing shown twice`).toBe(0);
      for (const shown of phone.shown) {
        const e = expected.get(shown.id);
        const time = Date.parse(shown.at);
        if (e === undefined || time < e.shownBy.from || time > e.shownBy.to) {
          throw new Error(`${where}: ${shown.id} was shown at ${shown.at}, due ${e?.dueAt ?? 'never'}, to be shown by ${e === undefined ? 'never' : new Date(e.shownBy.to).toISOString()}`);
        }
      }
      if (way === 'restarts') await stop();
      outcome.days += 1;
    }

    // The history: the facts of every alert given, each once, and an evening handled for every day.
    if (db === undefined) start();
    const history = readHistory(db as Db).flatMap((e) => (e.event.kind === 'alerts' ? [e.event.alerts] : []));
    const given = history.flatMap((a) => a.given.map((g) => [g.key, g.facts] as const));
    expect(new Set(given.map(([key]) => key)).size, `seed ${seed}: each alert given once`).toBe(given.length);
    expect(Object.fromEntries(given), `seed ${seed}: the facts of every alert`).toEqual(Object.fromEntries([...expected.entries()].map(([key, e]) => [key, e.facts])));
    expect(history.filter((a) => a.check.kind === 'evening')).toHaveLength(days.length);
    outcome.alerts = expected.size;
    return outcome;
  } finally {
    await alerts?.stop();
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

