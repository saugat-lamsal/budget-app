import { type BankBalances, type Book } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { MOM_NAME, START_DATE, openTestBook, payPerson, paycheck, purchase } from '../../money/test/helpers.js';
import { paydayView, type PaydayView } from '../src/views/payday.js';

// The Payday screen's numbers (QUESTIONS.md B104 to B107), worked out on the
// server from the book. The screen only formats them. Made-up numbers only.

const RULES = [{ id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' }] as const;

function aBook(): Book {
  const book = openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 20_000, momReserve: 120_000 }, rules: RULES });
  book.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
  book.receive(payPerson('m1', '2026-10-04', 50_000, MOM_NAME));
  book.receive(paycheck('p1', '2026-10-09', 400_000));
  return book;
}

// A bank that agrees with the book, with this much in the savings account.
function bank(book: Book, inSavings: number): BankBalances {
  const side = book.appSide() - book.inTransit().total;
  return { checking: side - inSavings, savings: inSavings, everydayCard: 0 };
}

function tracking(view: PaydayView): Extract<PaydayView, { state: 'tracking' }> {
  if (view.state !== 'tracking') throw new Error(`expected tracking, got ${view.state}`);
  return view;
}

const view = (book: Book, b: BankBalances | null, today = '2026-10-12') => tracking(paydayView({ today, book, bank: b, madeUpData: true }));

describe('14 before setup day', () => {
  it('14 there is nothing to show, and it says so', () => {
    expect(paydayView({ today: START_DATE, book: null, bank: null, madeUpData: true })).toEqual({ state: 'not-set-up', madeUpData: true });
    expect(paydayView({ today: START_DATE, book: null, bank: null, madeUpData: false })).toEqual({ state: 'not-set-up', madeUpData: false });
  });
});

describe('B104 B105 B106 the report is the money math\'s own', () => {
  it('B104 the paycheck, the leftovers, and the pay period that ended are the book\'s paydayReport', () => {
    const book = aBook();
    const v = view(book, bank(book, 0));
    expect(v.report).toEqual(book.paydayReport());
    expect(v.report.paycheck?.split).toEqual(book.paychecks()[0]?.split);
    expect(v.madeUpData).toBe(true);
    expect(v.today).toBe('2026-10-12');
  });

  it('11.2 the next payday and the days to it come from the pay schedule, going negative when the paycheck is late (B35)', () => {
    const book = aBook();
    expect(view(book, bank(book, 0), '2026-10-12').payday).toEqual({ next: '2026-10-23', days: 11 });
    expect(view(book, bank(book, 0), '2026-10-23').payday).toEqual({ next: '2026-10-23', days: 0 });
    expect(view(book, bank(book, 0), '2026-10-25').payday).toEqual({ next: '2026-10-23', days: -2 });
  });

  it('3.4 the questions waiting are the leftover questions of review, needs then wants, with their choices', () => {
    const book = aBook();
    const v = view(book, bank(book, 0));
    expect(v.questions.map((q) => q.item.id)).toEqual(['leftover:p1:needs', 'leftover:p1:wants']);
    expect(v.questions).toEqual(book.reviewDetails().filter((d) => d.item.type === 'leftover'));
    expect(v.questions.every((q) => q.options.type === 'leftover' && q.options.answers.length === 2)).toBe(true);
    // And the report points at the same questions.
    expect(v.report.leftovers.map((l) => l.question)).toEqual(v.questions.map((q) => q.item.id));
  });

  it('3.4 B107 once a question is answered it is no longer asked here, and the report says what happened', () => {
    const book = aBook();
    book.answerLeftover('leftover:p1:needs', 'move-to-savings', '2026-10-10');
    const v = view(book, bank(book, 0));
    expect(v.questions.map((q) => q.item.id)).toEqual(['leftover:p1:wants']);
    expect(v.report.leftovers[0]).toMatchObject({ bucket: 'needs', outcome: 'moved-to-savings', amount: 46_750, question: null });
  });

  it('B104 before the first paycheck there is nothing to report but the days to the next one', () => {
    const book = openTestBook({ pots: { needs: 1_000 } });
    const v = view(book, bank(book, 0), '2026-10-05');
    expect(v.report).toEqual({ period: { number: 0, startDate: START_DATE }, paycheck: null, leftovers: [], ended: null });
    expect(v.questions).toEqual([]);
    expect(v.payday).toEqual({ next: '2026-10-09', days: 4 });
  });
});

describe('3.8 how much to move to savings', () => {
  it('3.8 savings plus the mom reserve is what the account should hold; the rest is still to move', () => {
    const book = aBook();
    const pots = book.pots();
    const should = pots.savings + pots.momReserve;
    expect(view(book, bank(book, should - 135_000)).toSavings).toEqual({
      state: 'known',
      transfer: { shouldBeInSavings: should, savingsAccountBalance: should - 135_000, stillToMove: 135_000 },
    });
  });

  it('3.8 an account that holds enough has nothing to move', () => {
    const book = aBook();
    const should = book.pots().savings + book.pots().momReserve;
    expect(view(book, bank(book, should)).toSavings).toEqual({ state: 'known', transfer: { shouldBeInSavings: should, savingsAccountBalance: should, stillToMove: 0 } });
  });

  it('3.8 an account that holds more than it should has nothing to move, and the extra is shown on its own', () => {
    const book = aBook();
    const should = book.pots().savings + book.pots().momReserve;
    expect(view(book, bank(book, should + 2_500)).toSavings).toEqual({
      state: 'known',
      transfer: { shouldBeInSavings: should, savingsAccountBalance: should + 2_500, stillToMove: 0, extraInSavings: 2_500 },
    });
  });

  it('0.5 when the bank cannot be read there is no amount to move, and it says so', () => {
    const book = aBook();
    expect(view(book, null).toSavings).toEqual({ state: 'bank-not-read' });
    expect(view(book, null).report).toEqual(book.paydayReport());
  });

  it('3.8 money already on its way to savings counts as moved (B46)', () => {
    const book = aBook();
    book.receive({ kind: 'transfer-sent', id: 's1', from: 'checking', to: 'savings', date: '2026-10-10', amount: 100_000, description: 'TRANSFER TO SAVINGS' });
    const should = book.pots().savings + book.pots().momReserve;
    expect(view(book, bank(book, should - 100_000)).toSavings).toEqual({
      state: 'known',
      transfer: { shouldBeInSavings: should, savingsAccountBalance: should - 100_000, stillToMove: 0 },
    });
  });
});

describe('asking changes nothing, and the answer can be sent as JSON', () => {
  it('nothing in the book changes', () => {
    const book = aBook();
    const before = JSON.stringify([book.pots(), book.reviewItems(), book.changeLog(), book.paychecks()]);
    view(book, bank(book, 0));
    expect(JSON.stringify([book.pots(), book.reviewItems(), book.changeLog(), book.paychecks()])).toBe(before);
  });

  it('what is sent comes back from JSON the same', () => {
    const book = aBook();
    const v = paydayView({ today: '2026-10-12', book, bank: bank(book, 0), madeUpData: false });
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
  });
});
