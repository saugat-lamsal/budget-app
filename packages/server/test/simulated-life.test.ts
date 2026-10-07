import { bankSide, type AccountId, type BankTransaction, type SetupInput } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import type { Posted } from '../../money/test/sim/bank.js';
import { liveALife, type BookTotals, type RecordedBankDay } from '../../money/test/sim/life.js';
import { checkBankRules, type BankRule } from '../src/bank/reading.js';
import { setUpTracking } from '../src/setup-day.js';
import { bankStatus } from '../src/status.js';
import { ACCOUNT_IDS, type FakePlaid } from './fake-plaid.js';
import { connected } from './harness.js';

// The simulated you (Phase 2), through the bank connection. The simulator
// lives its life as always: its own bank, which posts transactions, holds
// pending charges, and moves its balances like a bank, feeding its own book
// directly. Here each day the same bank activity is also handed to a
// made-up bank in Plaid's format, and the bank connection syncs it, reads
// it, and gives it to a second book. After every day:
// - the made-up bank in Plaid's format shows the simulator's own balances;
// - the self-check passes, against the bank connection's reading of those
//   balances and against the simulator's bank;
// - the second book has the same money as the simulator's book: the same
//   app side, money in transit, and old card debt (his answers only move
//   money between buckets, so they do not change these, and only the
//   simulator's book gets them);
// - the money in transit is the same list the simulator's bank shows;
// - nothing waits for a decision.
// SIM_BANK_SEEDS, SIM_BANK_FIRST_SEED and SIM_BANK_YEARS run more of it.

const ACCOUNT: Record<AccountId, string> = {
  checking: ACCOUNT_IDS.checking,
  savings: ACCOUNT_IDS.savings,
  'everyday-card': ACCOUNT_IDS.everyday,
  'old-card': ACCOUNT_IDS.old,
};

const OWN = ['checking', 'savings'] as const;
const ALL = ['checking', 'savings', 'everyday-card', 'old-card'] as const;
const CARDS = ['everyday-card', 'old-card'] as const;

// How the made-up bank describes things, as bank rules. A transfer's
// leaving half says where it went, and its arriving half where it came
// from. Payments to people and card charges use the simulator's own words.
const SIM_BANK_RULES: readonly BankRule[] = checkBankRules([
  ...OWN.flatMap((from) =>
    ALL.filter((to) => to !== from).flatMap((to) => [
      { id: `out-${from}-${to}`, account: from, contains: `SIM TRANSFER TO ${to}`, means: 'transfer', other: to },
      { id: `in-${from}-${to}`, account: to, contains: `SIM TRANSFER FROM ${from}`, means: 'transfer', other: from },
    ]),
  ),
  { id: 'zelle', account: 'checking', contains: 'ZELLE TO ', means: 'payment-to-person' },
  ...CARDS.flatMap((card) => [
    { id: `${card}-fee`, account: card, contains: 'LATE FEE', means: 'card-fee' },
    { id: `${card}-interest`, account: card, contains: 'INTEREST CHARGE', means: 'card-interest' },
  ]),
]);

// One of the simulator's bank transactions, as Plaid would show it: signed
// amounts (positive is money out), a pending charge posting as the pending
// one removed and the posted one added and linked, and a transfer as two
// separate transactions, one on each account.
function inPlaidFormat(fake: FakePlaid, txn: BankTransaction): void {
  switch (txn.kind) {
    case 'purchase':
      if (txn.pending) fake.addPending({ id: txn.id, account: ACCOUNT[txn.account], amount: txn.amount, date: txn.date, description: txn.description });
      else if (txn.pendingId !== undefined) fake.postPending(txn.pendingId, { id: txn.id, date: txn.date, amount: txn.amount });
      else fake.addPosted({ id: txn.id, account: ACCOUNT[txn.account], amount: txn.amount, date: txn.date, description: txn.description });
      return;
    case 'refund':
      fake.addPosted({ id: txn.id, account: ACCOUNT[txn.account], amount: -txn.amount, date: txn.date, description: txn.description });
      return;
    case 'deposit':
      fake.addPosted({ id: txn.id, account: ACCOUNT[txn.account], amount: -txn.amount, date: txn.date, description: txn.description });
      return;
    case 'card-charge':
      fake.addPosted({ id: txn.id, account: ACCOUNT[txn.account], amount: txn.amount, date: txn.date, description: txn.description });
      return;
    case 'payment-to-person':
      fake.addPosted({ id: txn.id, account: ACCOUNT.checking, amount: txn.amount, date: txn.date, description: txn.description });
      return;
    case 'transfer':
      fake.addPosted({ id: `${txn.id}-out`, account: ACCOUNT[txn.from], amount: txn.amount, date: txn.date, description: `SIM TRANSFER TO ${txn.to}` });
      fake.addPosted({ id: `${txn.id}-in`, account: ACCOUNT[txn.to], amount: -txn.amount, date: txn.date, description: `SIM TRANSFER FROM ${txn.from}` });
      return;
    case 'transfer-sent':
      fake.addPosted({ id: txn.id, account: ACCOUNT[txn.from], amount: txn.amount, date: txn.date, description: `SIM TRANSFER TO ${txn.to}` });
      return;
    case 'transfer-arrived':
      fake.addPosted({ id: txn.id, account: ACCOUNT[txn.to], amount: -txn.amount, date: txn.date, description: `SIM TRANSFER FROM ${txn.from}` });
      return;
    case 'pending-dropped':
      fake.dropPending(txn.pendingId);
      return;
  }
}

interface Recorded {
  setup?: { readonly start: Posted; readonly feed: readonly BankTransaction[]; readonly input: SetupInput; readonly totals: BookTotals };
  readonly days: RecordedBankDay[];
}

function liveAndRecord(seed: number, years: number): Required<Recorded> {
  const recorded: Recorded = { days: [] };
  const result = liveALife({
    seed,
    years,
    record: {
      setupDay: (setup) => {
        recorded.setup = setup;
      },
      day: (day) => recorded.days.push(day),
    },
  });
  if (!result.ok) throw new Error(`the simulated life failed on its own: seed ${seed}, ${result.date}, ${result.check}: ${result.message}`);
  if (recorded.setup === undefined) throw new Error('no setup day was recorded');
  return { setup: recorded.setup, days: recorded.days };
}

async function throughTheBankConnection(seed: number, years: number): Promise<{ days: number; transactions: number }> {
  const { setup, days } = liveAndRecord(seed, years);
  const h = await connected({
    posted: { checking: setup.start.checking, savings: setup.start.savings, everyday: setup.start.everydayCard, old: setup.start.oldCard },
    history: (fake) => {
      for (const txn of setup.feed) inPlaidFormat(fake, txn);
    },
    rules: SIM_BANK_RULES,
    today: setup.input.date,
  });
  // 14: setup day from what the bank connection synced, with his own
  // assignment, and the payments he confirms are on their way (B48).
  const outcome = setUpTracking(h.db, {
    today: setup.input.date,
    assignment: setup.input.assignment,
    lastPaycheckDate: setup.input.lastPaycheckDate,
    settings: setup.input.settings,
    rules: setup.input.rules ?? [],
    inTransit: (setup.input.transfersInTransit ?? []).map((half) => half.id),
  });
  expect(outcome, `seed ${seed}: setup day`).toEqual({ ok: true, startingMoney: setup.totals.appSide });
  let transactions = setup.feed.length;
  for (const day of days) {
    for (const txn of day.feed) inPlaidFormat(h.fake, txn);
    transactions += day.feed.length;
    await h.sync(day.date, { pageSize: 100 });
    const where = `seed ${seed}, ${day.date}`;
    expect([h.fake.posted(ACCOUNT.checking), h.fake.posted(ACCOUNT.savings), h.fake.posted(ACCOUNT['everyday-card']), h.fake.posted(ACCOUNT['old-card'])], `${where}: posted balances`).toEqual([
      day.posted.checking,
      day.posted.savings,
      day.posted.everydayCard,
      day.posted.oldCard,
    ]);
    const status = bankStatus(h.db);
    expect(status.selfCheck, `${where}: the self-check`).toMatchObject({ ok: true, difference: 0 });
    const check = status.selfCheck;
    if (check === null) throw new Error(`${where}: no self-check`);
    expect(bankSide(day.balances) + check.inTransit - check.appSide, `${where}: the self-check against the simulator's own bank`).toBe(0);
    expect({ appSide: check.appSide, inTransit: check.inTransit, oldCardDebt: status.oldCard?.book }, `${where}: the same money as the simulator's book`).toEqual(day.totals);
    expect(status.inTransit?.items.map((i) => `${i.from} ${i.to} ${i.amount} ${i.seen}`).sort(), `${where}: money in transit`).toEqual(day.halvesShowing);
    expect(status.oldCard?.difference, `${where}: the old card`).toBe(0);
    expect(status.attention, `${where}: nothing waits for a decision`).toEqual([]);
  }
  return { days: days.length, transactions };
}

const FIRST_SEED = Number(process.env['SIM_BANK_FIRST_SEED'] ?? 1);
const SEEDS = Number(process.env['SIM_BANK_SEEDS'] ?? 2);
const YEARS = Number(process.env['SIM_BANK_YEARS'] ?? 1);

describe('the simulated you, through the bank connection in Plaid\'s format', () => {
  it.each(Array.from({ length: SEEDS }, (_, i) => FIRST_SEED + i))(
    'simulator: seed %i, every day the self-check passes and the money matches the simulator\'s book',
    async (seed) => {
      const { days, transactions } = await throughTheBankConnection(seed, YEARS);
      expect(days).toBe(Math.round(YEARS * 365));
      expect(transactions).toBeGreaterThan(days);
    },
    600_000,
  );
});
