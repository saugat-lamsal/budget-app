import { startTracking, type BankBalances, type Book, type IsoDate, type SetupInput } from '@budget-app/money';
import { liveALife, type RecordedBankDay } from '../../../money/test/sim/life.js';
import { Random } from '../../../money/test/sim/random.js';

// Random made-up lives (the Phase 2 simulator), each stopped on a random day.
// WEB_LIVES and WEB_FIRST_SEED run more, or replay one.

export const LIVES = Number(process.env['WEB_LIVES'] ?? 6);
export const FIRST_SEED = Number(process.env['WEB_FIRST_SEED'] ?? 1);

export interface Day {
  readonly seed: number;
  readonly day: number;
  readonly book: Book;
  readonly today: IsoDate;
  readonly bank: BankBalances;
}

// The simulator's bank, day by day, played into a fresh book up to a random
// day. Nobody answers anything in review, so things pile up there, which is
// a fine thing for the screens to show too. The same seed always gives the
// same book, so a twin of it can be made to compare with.
export function randomDay(seed: number): Day {
  let setup: SetupInput | undefined;
  const days: RecordedBankDay[] = [];
  const result = liveALife({ seed, years: 0.4, record: { setupDay: (s) => (setup = s.input), day: (d) => days.push(d) } });
  if (!result.ok || setup === undefined) throw new Error(`life ${seed} did not finish`);
  const started = startTracking(setup);
  if (!started.ok) throw new Error(`life ${seed} could not start tracking`);
  const stopAt = new Random(seed * 7919).int(0, days.length - 1);
  for (const day of days.slice(0, stopAt + 1)) for (const txn of day.feed) started.book.receive(txn);
  const day = days[stopAt] as RecordedBankDay;
  return { seed, day: stopAt, book: started.book, today: day.date, bank: day.balances };
}
