import type { BankBalances, Book, Cents, IsoDate } from '@budget-app/money';
import { appSide, openTestBook, type TestBookOptions } from '../../money/test/helpers.js';
import { checkBankRules } from '../src/bank/reading.js';
import { trendsView, type BeforeSetup, type HistoryLine, type TrendsInput } from '../src/trends.js';
import type { TrendsView } from '../src/views/trends.js';

// What the Future and Habits tests (40.10 to 40.17) share: the same made-up
// books as trends.test.ts. The books open on Oct 1, 2026 (setup day), the
// last paycheck Sep 25, paid every 14 days, so the next payday is Oct 9.
// Every name and number is made up.

export const START = { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 50_000, heldForOthers: 0 } as const;
export const RULES = [
  { id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
  { id: 'roommate', for: 'person', contains: 'MADE UP ROOMMATE', choice: { to: 'wants' } },
] as const;

export const BANK_RULES = checkBankRules([
  { id: 'chk-old', account: 'checking', contains: 'payment to CRD 4444', means: 'transfer', other: 'old-card' },
  { id: 'chk-sav', account: 'checking', contains: 'transfer to SAV 2222', means: 'transfer', other: 'savings' },
  { id: 'zelle', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' },
]);

export function book(options: TestBookOptions = {}): Book {
  return openTestBook({ pots: START, rules: RULES, ...options });
}

function matchingBank(b: Book): BankBalances {
  return { checking: appSide(b.pots()) - b.inTransit().total, savings: 0, everydayCard: 0 };
}

export type Tracking = Extract<TrendsView, { state: 'tracking' }>;

export function view(b: Book, today: IsoDate, over: Partial<TrendsInput> = {}): Tracking {
  const v = trendsView({ today, book: b, bank: matchingBank(b), madeUpData: false, before: null, ...over });
  if (v.state !== 'tracking') throw new Error(`expected tracking, got ${v.state}`);
  return v;
}

// Plaid's sign: positive is money out of the account.
export const line = (id: string, account: HistoryLine['account'], date: IsoDate, amount: Cents, description: string): HistoryLine => ({ id, account, date, amount, description });

export function before(lines: readonly HistoryLine[], over: Partial<BeforeSetup> = {}): BeforeSetup {
  return { setupDay: '2026-10-01', lastPaycheckDate: '2026-09-25', historyFrom: '2026-07-05', lines, bankRules: BANK_RULES, ...over };
}
