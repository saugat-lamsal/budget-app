import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BankTransaction, SetupInput } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { liveALife, type BookTotals, type RecordedAnswer, type RecordedBankDay } from '../../money/test/sim/life.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { bookOfSetup, replayCall, totalsOf, type BookCall } from '../src/history/history.js';
import { appendEvent, readHistory } from '../src/history/history-db.js';
import { Keeper } from '../src/history/keeper.js';

// The simulated you (Phase 2), through the database, with the server stopped
// and started again every simulated day (the real server keeps everything).
// The simulator lives its life as always, feeding its own book. Everything
// its book is given is also saved in the book's history in a database file,
// in the same order: what its bank sent, and each answer the simulated person
// gave, with its date and the totals after it. Every evening the books are
// opened again from the file: the history must replay to the totals saved
// with each event, and then
// - the self-check passes against the simulator's own bank;
// - every bucket, the money waiting in review both ways, money in transit, the
//   old card debt, and how many items wait are the simulator's own book's.
// (How the bank connection reads what a bank sends in Plaid's format is the
// other simulated life's, simulated-life.test.ts.)
// SIM_DB_SEEDS, SIM_DB_FIRST_SEED and SIM_DB_YEARS run more.

interface Day extends RecordedBankDay {
  readonly answers: readonly RecordedAnswer[];
}

function liveAndRecord(seed: number, years: number): { input: SetupInput; totals: BookTotals; days: Day[] } {
  let setup: { input: SetupInput; totals: BookTotals } | undefined;
  const days: Day[] = [];
  let answers: RecordedAnswer[] = [];
  const result = liveALife({
    seed,
    years,
    record: {
      setupDay: (s) => {
        setup = { input: s.input, totals: s.totals };
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

function throughTheDatabase(seed: number, years: number): { days: number; answers: number; restarts: number } {
  const { input, totals, days } = liveAndRecord(seed, years);
  const dir = mkdtempSync(join(tmpdir(), 'budget-sim-'));
  const path = join(dir, 'books.sqlite');
  let db: Db = openDatabase(path);
  let answers = 0;
  let restarts = 0;
  try {
    const started = bookOfSetup(input);
    expect(started.appSide(), `seed ${seed}: setup day`).toBe(totals.appSide);
    appendEvent(db, { event: { kind: 'setup', input }, date: input.date, sync: null, totals: totalsOf(started) });
    // Stopped and started again: the books opened from the database file,
    // after the history replays to the totals saved with it.
    const restart = (date: string): Keeper => {
      db.close();
      db = openDatabase(path);
      restarts += 1;
      return Keeper.open({ db, now: () => new Date(`${date}T16:00:00Z`) });
    };
    let keeper = restart(input.date);
    for (const day of days) {
      const where = `seed ${seed}, ${day.date}`;
      const book = keeper.book();
      if (book === null) throw new Error(`${where}: no book`);
      const receive = (txn: BankTransaction): void => {
        book.receive(txn);
        appendEvent(db, { event: { kind: 'receive', txn }, date: day.date, sync: null, totals: totalsOf(book) });
      };
      let given = 0;
      for (const answer of day.answers) {
        while (given < answer.afterFeed) receive(day.feed[given++] as BankTransaction);
        const call: BookCall = { method: answer.method as BookCall['method'], args: answer.args };
        replayCall(book, call);
        appendEvent(db, { event: { kind: 'answer', answer: { book: [call] } }, date: day.date, sync: null, totals: totalsOf(book) });
        answers += 1;
      }
      while (given < day.feed.length) receive(day.feed[given++] as BankTransaction);
      keeper = restart(day.date);
      const reopened = keeper.book();
      if (reopened === null) throw new Error(`${where}: no book after the restart`);
      expect(reopened.selfCheck(day.balances), `${where}: the self-check`).toMatchObject({ ok: true, difference: 0 });
      expect({ pots: reopened.pots(), waiting: reopened.reviewItems().length }, `${where}: the simulator's own book`).toEqual({ pots: day.pots, waiting: day.waiting });
      const check = reopened.selfCheck(day.balances);
      expect({ appSide: check.appSide, inTransit: check.inTransit, oldCardDebt: reopened.oldCardDebt() }, `${where}: the same money as the simulator's book`).toEqual(day.totals);
    }
    expect(readHistory(db).filter((e) => e.event.kind === 'answer')).toHaveLength(answers);
    return { days: days.length, answers, restarts };
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const FIRST_SEED = Number(process.env['SIM_DB_FIRST_SEED'] ?? 1);
const SEEDS = Number(process.env['SIM_DB_SEEDS'] ?? 1);
const YEARS = Number(process.env['SIM_DB_YEARS'] ?? 1);

describe('the simulated you, through the database, the server started again every simulated day', () => {
  it.each(Array.from({ length: SEEDS }, (_, i) => FIRST_SEED + i))(
    "simulator: seed %i, every day the history replays, the self-check passes, and every bucket is the simulator's",
    (seed) => {
      const { days, answers, restarts } = throughTheDatabase(seed, YEARS);
      expect(days).toBe(Math.round(YEARS * 365));
      expect(restarts).toBe(days + 1);
      expect(answers).toBeGreaterThan(days / 2);
    },
    900_000,
  );
});
