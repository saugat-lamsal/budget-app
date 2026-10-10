import type { BankTransaction, Book, IsoDate, SetupInput } from '@budget-app/money';
import { bookOfSetup, replayCall, type BookCall } from '../../../../server/src/history/history.js';
import { everything } from '../../../../server/test/keeper-harness.js';
import type { Posted } from '../../../../money/test/sim/bank.js';
import { describeFailure, liveALife, type RecordedAnswer, type RecordedBankDay } from '../../../../money/test/sim/life.js';
import { PAY_PERIOD, PAY_PERIOD_SEED } from '../../../../money/test/sim/pay-period.js';

// The planned pay period (packages/money/test/sim/pay-period.ts), lived by
// the simulator, and everything it recorded: what its bank sent on setup day
// and on each day after, each answer the simulated person gave, and, at the
// end of each day, everything the screens can read from its own book. Every
// name and number is made up.

export interface PeriodDay extends RecordedBankDay {
  readonly index: number;
  readonly answers: readonly RecordedAnswer[];
  // The simulator's own book at the end of the day, as plain data.
  readonly book: unknown;
}

export interface Period {
  readonly setup: { readonly start: Posted; readonly feed: readonly BankTransaction[]; readonly input: SetupInput };
  readonly days: readonly PeriodDay[];
}

let lived: Period | undefined;

// Lived once per test file: the same seed and plan always give the same period.
export function period(): Period {
  if (lived !== undefined) return lived;
  let setup: Period['setup'] | undefined;
  const days: PeriodDay[] = [];
  let answers: RecordedAnswer[] = [];
  let ended: RecordedBankDay | undefined;
  const result = liveALife({
    seed: PAY_PERIOD_SEED,
    years: 0,
    plan: PAY_PERIOD,
    record: {
      setupDay: (s) => {
        setup = { start: s.start, feed: s.feed, input: s.input };
      },
      day: (d) => {
        ended = d;
      },
      answer: (a) => answers.push(a),
      endOfDay: ({ book }) => {
        if (ended === undefined) throw new Error('a day ended that was not recorded');
        days.push({ ...ended, index: days.length, answers, book: JSON.parse(JSON.stringify(everything(book))) as unknown });
        answers = [];
        ended = undefined;
      },
    },
  });
  if (!result.ok) throw new Error(describeFailure(result, 0));
  if (setup === undefined) throw new Error('no setup day was recorded');
  lived = { setup, days };
  return lived;
}

// The simulator's book as it stood at the end of a day, made again from what
// it recorded: setup day, then each day's bank activity and answers, in the
// order the simulator gave them. It is checked against the plain data the
// simulator saved from its own book that evening, so it is that book.
export function simulatorBookAt(index: number): Book {
  const p = period();
  const book = bookOfSetup(p.setup.input);
  for (const day of p.days.slice(0, index + 1)) {
    let given = 0;
    for (const answer of day.answers) {
      while (given < answer.afterFeed) book.receive(day.feed[given++] as BankTransaction);
      replayCall(book, { method: answer.method as BookCall['method'], args: answer.args });
    }
    while (given < day.feed.length) book.receive(day.feed[given++] as BankTransaction);
  }
  const day = p.days[index];
  if (day === undefined) throw new Error(`the period has no day ${index}`);
  const made = JSON.stringify(everything(book));
  if (made !== JSON.stringify(day.book)) throw new Error(`the simulator's book for ${day.date} could not be made again from what it recorded`);
  return book;
}

export function dayOf(date: IsoDate): PeriodDay {
  const day = period().days.find((d) => d.date === date);
  if (day === undefined) throw new Error(`the period has no day ${date}`);
  return day;
}

