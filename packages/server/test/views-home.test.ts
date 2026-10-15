import { addDays, type BankBalances, type Book, type CardStatement, type Cents, type IsoDate } from '@budget-app/money';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  LAST_PAYCHECK,
  START_DATE,
  appSide,
  deposit,
  openTestBook,
  paycheck,
  purchase,
  sent,
  takenBack,
  transfer,
} from '../../money/test/helpers.js';
import { homeView, type Attention, type HomeInput, type HomeView } from '../src/views/home.js';

// The Home screen's numbers (Phase 4), worked out on the server from the
// book. Made-up numbers only.

const WANTS_RULE = { id: 'coffee', for: 'purchase', contains: 'COFFEE', bucket: 'wants' } as const;
const NEEDS_RULE = { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' } as const;

// Bank balances that agree with the book (12.3): the app side worked out
// from the buckets by hand (12.2), less money in transit (12.5), with the
// savings account and the everyday card at the amounts given.
function matchingBank(book: Book, savings: Cents = 0, everydayCard: Cents = 0): BankBalances {
  const checking = appSide(book.pots()) - book.inTransit().total - savings + everydayCard;
  return { checking, savings, everydayCard };
}

function input(book: Book | null, over: Partial<HomeInput> = {}): HomeInput {
  return {
    today: START_DATE,
    book,
    bank: book === null ? null : matchingBank(book),
    needsLogin: false,
    statements: [],
    madeUpData: false,
    seenTakeBacks: new Set(),
    lastChecked: null,
    ...over,
  };
}

function tracking(view: HomeView): Extract<HomeView, { state: 'tracking' }> {
  if (view.state !== 'tracking') throw new Error(`expected tracking, got ${view.state}`);
  return view;
}

function shownAmount(view: HomeView): Cents {
  const s = tracking(view).safeToSpend;
  if (!s.shown) throw new Error(`safe to spend held back: ${s.why}`);
  return s.amount;
}

function kinds(view: HomeView): Attention['kind'][] {
  return tracking(view).attention.map((a) => a.kind);
}

describe('11.1 safe to spend on Home', () => {
  it('11.1 safe to spend is wants left minus unsorted spending', () => {
    const book = openTestBook({ pots: { needs: 80_000, wants: 50_000 } });
    book.receive(purchase('p1', START_DATE, 1_234, 'NO RULE SHOP'));
    expect(shownAmount(homeView(input(book)))).toBe(48_766);
  });

  it('11.1 zero wants and nothing unsorted is $0.00, shown', () => {
    expect(shownAmount(homeView(input(openTestBook({ pots: { needs: 1_000 } }))))).toBe(0);
  });

  it('11.1 one cent is shown as one cent', () => {
    expect(shownAmount(homeView(input(openTestBook({ pots: { wants: 1 } }))))).toBe(1);
  });

  it('11.1 sorted spending comes out of wants once, not twice', () => {
    const book = openTestBook({ pots: { wants: 10_000 }, rules: [WANTS_RULE] });
    book.receive(purchase('p1', START_DATE, 450, 'COFFEE BAR'));
    expect(shownAmount(homeView(input(book)))).toBe(9_550);
  });

  it('11.1 below zero is shown as a negative number (B34)', () => {
    const book = openTestBook({ pots: { wants: 1_000 } });
    book.receive(purchase('p1', START_DATE, 1_001, 'NO RULE SHOP'));
    expect(shownAmount(homeView(input(book)))).toBe(-1);
  });

  it('11.1 very large amounts stay exact', () => {
    const big = 90_071_992_547_409;
    const book = openTestBook({ pots: { wants: big } });
    book.receive(purchase('p1', START_DATE, 1, 'NO RULE SHOP'));
    expect(shownAmount(homeView(input(book)))).toBe(big - 1);
  });
});

describe('11.3 what safe to spend never includes', () => {
  it('11.3 savings, mom reserve, held for others, and unsorted money in are left out', () => {
    const book = openTestBook({ pots: { savings: 900_000, wants: 25_000, momReserve: 150_000, heldForOthers: 40_000 } });
    book.receive(deposit('d1', START_DATE, 77_700, 'MYSTERY DEPOSIT'));
    expect(book.pots().unsortedIn).toBe(77_700);
    expect(shownAmount(homeView(input(book)))).toBe(25_000);
  });

  it('11.3 needs are not part of it (15d)', () => {
    const book = openTestBook({ pots: { needs: 300_000, wants: 100 } });
    expect(shownAmount(homeView(input(book)))).toBe(100);
  });
});

describe('11.2 days to payday on Home', () => {
  // The last paycheck was Sep 25 and paydays are every 14 days: Oct 9.
  it('11.2 counts the days to the next payday from the pay schedule', () => {
    const view = tracking(homeView(input(openTestBook(), { today: '2026-10-01' })));
    expect(view.payday).toEqual({ next: '2026-10-09', days: 8 });
  });

  it('11.2 one day before payday is 1', () => {
    expect(tracking(homeView(input(openTestBook(), { today: '2026-10-08' }))).payday.days).toBe(1);
  });

  it('11.2 on payday it is 0', () => {
    expect(tracking(homeView(input(openTestBook(), { today: '2026-10-09' }))).payday.days).toBe(0);
  });

  it('11.2 a late paycheck makes the days negative instead of jumping ahead (B35)', () => {
    const view = tracking(homeView(input(openTestBook(), { today: '2026-10-11' })));
    expect(view.payday).toEqual({ next: '2026-10-09', days: -2 });
  });

  it('11.2 a paycheck that arrives starts the count again', () => {
    const book = openTestBook();
    book.receive(paycheck('pay1', '2026-10-09', 200_000));
    expect(tracking(homeView(input(book, { today: '2026-10-09' }))).payday).toEqual({ next: '2026-10-23', days: 14 });
  });

  it('11.2 the pay schedule is the setting, not a fixed 14', () => {
    const book = openTestBook({ settings: { payScheduleDays: 7 } });
    expect(tracking(homeView(input(book, { today: LAST_PAYCHECK }))).payday).toEqual({ next: '2026-10-02', days: 7 });
  });
});

describe('0.5 Home when the totals do not match the bank', () => {
  it('0.5 one cent off holds back safe to spend and shows the check instead (12.3, B37)', () => {
    const book = openTestBook({ pots: { wants: 50_000 } });
    const bank = matchingBank(book);
    const view = tracking(homeView(input(book, { bank: { ...bank, checking: bank.checking + 1 } })));
    expect(view.safeToSpend).toEqual({
      shown: false,
      why: 'totals-do-not-match',
      check: { bankSide: 50_001, inTransit: 0, appSide: 50_000, difference: 1, ok: false },
      catchingUp: false,
    });
  });

  it('10.4 A47 a difference younger than the setting hours says the bank is still catching up', () => {
    const book = openTestBook({ pots: { wants: 50_000 } });
    const bank = matchingBank(book);
    const view = tracking(homeView(input(book, { bank: { ...bank, checking: bank.checking - 4_210 }, catchingUp: true })));
    expect(view.safeToSpend).toMatchObject({ shown: false, why: 'totals-do-not-match', check: { difference: -4_210 }, catchingUp: true });
    // A matching bank is never catching up: the number is shown.
    expect(tracking(homeView(input(book, { bank, catchingUp: true }))).safeToSpend).toEqual({ shown: true, amount: 50_000 });
  });

  it('0.5 the bank showing less is a negative difference (12.3)', () => {
    const book = openTestBook({ pots: { wants: 50_000 } });
    const bank = matchingBank(book);
    const view = tracking(homeView(input(book, { bank: { ...bank, everydayCard: bank.everydayCard + 1_234 } })));
    expect(view.safeToSpend.shown).toBe(false);
    if (!view.safeToSpend.shown && view.safeToSpend.why === 'totals-do-not-match') expect(view.safeToSpend.check.difference).toBe(-1_234);
  });

  it('0.5 the days to payday still show when the totals do not match (B37)', () => {
    const book = openTestBook();
    const bank = matchingBank(book);
    const view = tracking(homeView(input(book, { bank: { ...bank, savings: bank.savings + 5 } })));
    expect(view.payday).toEqual({ next: '2026-10-09', days: 8 });
  });

  it('0.5 with the bank not read and never checked, safe to spend is held back with nothing to show', () => {
    const view = tracking(homeView(input(openTestBook({ pots: { wants: 9_999 } }), { bank: null })));
    expect(view.safeToSpend).toEqual({ shown: false, why: 'bank-not-read', lastChecked: null });
  });

  it('0.5 with the bank not read, the last checked safe to spend is sent, with when (B82)', () => {
    const lastChecked = { amount: 61_250, at: '2026-10-07T07:15:00-05:00' };
    const view = tracking(homeView(input(openTestBook({ pots: { wants: 9_999 } }), { bank: null, lastChecked })));
    expect(view.safeToSpend).toEqual({ shown: false, why: 'bank-not-read', lastChecked });
  });

  it('0.5 the last checked number is that number, not one worked out now', () => {
    // Since the check, he sorted things and spent: the book says 9,999 now.
    const view = tracking(homeView(input(openTestBook({ pots: { wants: 9_999 } }), { bank: null, lastChecked: { amount: -1, at: '2026-10-06T21:00:00Z' } })));
    expect(view.safeToSpend).toMatchObject({ lastChecked: { amount: -1 } });
  });

  it('0.5 when the bank can be read, the last checked number plays no part', () => {
    const book = openTestBook({ pots: { wants: 9_999 } });
    expect(tracking(homeView(input(book, { lastChecked: { amount: 5, at: '2026-10-06T21:00:00Z' } }))).safeToSpend).toEqual({ shown: true, amount: 9_999 });
    const bank = matchingBank(book);
    const off = tracking(homeView(input(book, { bank: { ...bank, checking: bank.checking + 1 }, lastChecked: { amount: 5, at: '2026-10-06T21:00:00Z' } })));
    expect(off.safeToSpend).toMatchObject({ shown: false, why: 'totals-do-not-match' });
  });

  it('0.5 a last checked number that is not whole cents, or a time that is not a time, is refused', () => {
    const book = openTestBook();
    expect(() => homeView(input(book, { bank: null, lastChecked: { amount: 1.5, at: '2026-10-07T07:15:00Z' } }))).toThrow();
    expect(() => homeView(input(book, { bank: null, lastChecked: { amount: 100, at: '2026-10-07' } }))).toThrow();
    expect(() => homeView(input(book, { bank: null, lastChecked: { amount: 100, at: 'yesterday' } }))).toThrow();
  });

  it('12.5 a card payment on its way is not a mismatch', () => {
    const book = openTestBook({ pots: { wants: 50_000 } });
    // The bank before: $500.00 in checking, $0 owed on the card.
    // $120.00 leaves checking for the card and has not landed yet.
    book.receive(sent('s1', START_DATE, 12_000, 'checking', 'everyday-card'));
    const view = homeView(input(book, { bank: { checking: 38_000, savings: 0, everydayCard: 0 } }));
    expect(shownAmount(view)).toBe(50_000);
  });

  it('12.1 pending charges are part of the bank side the check uses', () => {
    const book = openTestBook({ pots: { wants: 50_000 }, rules: [WANTS_RULE] });
    book.receive(purchase('p1', START_DATE, 700, 'COFFEE BAR', { pending: true }));
    // The everyday card owes $7.00 counting the pending charge.
    expect(shownAmount(homeView(input(book, { bank: { checking: 50_000, savings: 0, everydayCard: 700 } })))).toBe(49_300);
  });
});

describe('10.1 10.2 bucket bars on Home', () => {
  // Before the first paycheck, a bucket started with what setup day gave it (B56).
  function spentDownTo(left: Cents): HomeView {
    const book = openTestBook({ pots: { needs: 100_000, wants: 100_000 }, rules: [WANTS_RULE] });
    book.receive(purchase('p1', START_DATE, 100_000 - left, 'COFFEE BAR'));
    return homeView(input(book));
  }

  it('10.1 each bar shows what is left and what the bucket started the pay period with', () => {
    const view = tracking(spentDownTo(60_000));
    expect(view.buckets.wants).toEqual({ left: 60_000, startedWith: 100_000, level: 'ok' });
    expect(view.buckets.needs).toEqual({ left: 100_000, startedWith: 100_000, level: 'ok' });
  });

  it('10.1 exactly at the alert level is not low', () => {
    expect(tracking(spentDownTo(20_000)).buckets.wants.level).toBe('ok');
  });

  it('10.1 one cent below the alert level is low', () => {
    expect(tracking(spentDownTo(19_999)).buckets.wants.level).toBe('low');
  });

  it('10.2 at zero the bar is empty', () => {
    expect(tracking(spentDownTo(0)).buckets.wants).toEqual({ left: 0, startedWith: 100_000, level: 'empty' });
  });

  it('10.2 overspent shows the negative amount and empty (3.5)', () => {
    expect(tracking(spentDownTo(-500)).buckets.wants).toEqual({ left: -500, startedWith: 100_000, level: 'empty' });
  });

  it('10.1 the bars use the alert percent setting', () => {
    const book = openTestBook({ pots: { needs: 100_000 }, rules: [NEEDS_RULE], settings: { lowBucketAlertPercent: 50 } });
    book.receive(purchase('p1', START_DATE, 50_001, 'GROCER'));
    expect(tracking(homeView(input(book))).buckets.needs.level).toBe('low');
  });

  it('10.1 showing the bars does not use up the once-per-pay-period alerts', () => {
    const book = openTestBook({ pots: { wants: 100_000 }, rules: [WANTS_RULE] });
    book.receive(purchase('p1', START_DATE, 90_000, 'COFFEE BAR'));
    homeView(input(book));
    homeView(input(book));
    const alerts = book.takeAlerts({ bankConnection: 'ok', bankBalances: matchingBank(book) });
    expect(alerts.filter((a) => a.kind === 'low-bucket')).toHaveLength(1);
  });

  it('10.1 after a paycheck the bars start from the new pay period', () => {
    const book = openTestBook({ pots: { needs: 10_000, wants: 10_000 }, settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } } });
    // $10,000.00: the mom reserve takes $1,500.00 first, then $8,500.00 is
    // split: needs 30% is $2,550.00 and wants 20% is $1,700.00, each on top
    // of the $100.00 that rolled over.
    book.receive(paycheck('pay1', '2026-10-09', 1_000_000));
    const view = tracking(homeView(input(book, { today: '2026-10-09' })));
    expect(view.buckets.needs).toEqual({ left: 265_000, startedWith: 265_000, level: 'ok' });
    expect(view.buckets.wants).toEqual({ left: 180_000, startedWith: 180_000, level: 'ok' });
  });
});

describe('10.3 waiting in review on Home', () => {
  it('10.3 nothing waiting: no review item', () => {
    expect(kinds(homeView(input(openTestBook())))).not.toContain('review');
  });

  it('10.3 counts what is waiting and the spending held back from safe to spend (4.3)', () => {
    const book = openTestBook({ pots: { wants: 50_000 } });
    book.receive(purchase('p1', START_DATE, 1_000, 'NO RULE SHOP'));
    book.receive(purchase('p2', START_DATE, 1, 'ANOTHER SHOP'));
    book.receive(deposit('d1', START_DATE, 5_000, 'MYSTERY DEPOSIT'));
    const view = tracking(homeView(input(book)));
    expect(view.attention).toContainEqual({ kind: 'review', waiting: 3, heldBack: 1_001 });
    expect(view.waitingInReview).toBe(3);
  });

  it('10.3 leftover questions count as waiting (B32)', () => {
    const book = openTestBook({ pots: { needs: 10_000, wants: 10_000 } });
    book.receive(paycheck('pay1', '2026-10-09', 1_000_000));
    const view = tracking(homeView(input(book, { today: '2026-10-09' })));
    expect(view.attention).toContainEqual({ kind: 'review', waiting: 2, heldBack: 0 });
  });
});

describe('10.5 bank login on Home', () => {
  it('10.5 the bank needing a login comes first', () => {
    const book = openTestBook();
    book.receive(purchase('p1', START_DATE, 1_000, 'NO RULE SHOP'));
    expect(kinds(homeView(input(book, { needsLogin: true })))).toEqual(['bank-login', 'review']);
  });

  it('10.5 no item when the connection is fine', () => {
    expect(kinds(homeView(input(openTestBook())))).toEqual([]);
  });
});

describe('3.8 money to move into savings on Home', () => {
  it('3.8 shows what should be in the savings account and what is still to move', () => {
    const book = openTestBook({ pots: { savings: 100_000, momReserve: 50_000, wants: 1_000 } });
    const view = tracking(homeView(input(book, { bank: matchingBank(book, 120_000) })));
    expect(view.attention).toContainEqual({ kind: 'move-to-savings', stillToMove: 30_000, shouldBeInSavings: 150_000, savingsAccountBalance: 120_000, onItsWay: 0 });
  });

  it('3.8 B46 money already on its way to the savings account is shown with it, and counts as moved', () => {
    const book = openTestBook({ pots: { savings: 100_000, momReserve: 50_000, wants: 1_000 } });
    book.receive(sent('to-savings', START_DATE, 20_000, 'checking', 'savings'));
    const view = tracking(homeView(input(book, { bank: matchingBank(book, 120_000) })));
    expect(view.attention).toContainEqual({ kind: 'move-to-savings', stillToMove: 10_000, shouldBeInSavings: 150_000, savingsAccountBalance: 120_000, onItsWay: 20_000 });
  });

  it('3.8 one cent still to move is shown', () => {
    const book = openTestBook({ pots: { savings: 100_000 } });
    const view = tracking(homeView(input(book, { bank: matchingBank(book, 99_999) })));
    expect(view.attention).toContainEqual({ kind: 'move-to-savings', stillToMove: 1, shouldBeInSavings: 100_000, savingsAccountBalance: 99_999, onItsWay: 0 });
  });

  it('3.8 nothing to move when the account holds exactly enough', () => {
    const book = openTestBook({ pots: { savings: 100_000 } });
    expect(kinds(homeView(input(book, { bank: matchingBank(book, 100_000) })))).not.toContain('move-to-savings');
  });

  it('3.8 an account holding more than it should is not something to do (18f)', () => {
    const book = openTestBook({ pots: { savings: 100_000, needs: 500_000 } });
    expect(kinds(homeView(input(book, { bank: matchingBank(book, 400_000) })))).not.toContain('move-to-savings');
  });

  it('3.8 money already on its way to savings counts as moved (B46)', () => {
    const book = openTestBook({ pots: { savings: 100_000 } });
    book.receive(sent('s1', START_DATE, 100_000, 'checking', 'savings'));
    // Checking held $1,000.00 and already shows it gone; savings does not
    // show it yet.
    const view = homeView(input(book, { bank: { checking: 0, savings: 0, everydayCard: 0 } }));
    expect(shownAmount(view)).toBe(0);
    expect(kinds(view)).not.toContain('move-to-savings');
  });
});

describe('9.1 to 9.4 card reminders on Home', () => {
  const everyday: CardStatement = { card: 'everyday-card', closingDate: '2026-09-20', dueDate: '2026-10-15', statementBalance: 123_456, minimumPayment: 3_500 };
  const old: CardStatement = { card: 'old-card', closingDate: '2026-09-20', dueDate: '2026-10-15', statementBalance: 300_000, minimumPayment: 4_000 };

  function onDay(today: IsoDate, statements: readonly CardStatement[], book = openTestBook({ pots: { needs: 500_000 } })): HomeView {
    return homeView(input(book, { today, statements }));
  }

  it('9.1 the everyday card shows its statement balance, minimum, and due date 7 days before', () => {
    expect(tracking(onDay('2026-10-08', [everyday])).attention).toEqual([
      { kind: 'card-due', card: 'everyday-card', dueDate: '2026-10-15', daysLeft: 7, statementBalance: 123_456, minimumPayment: 3_500 },
    ]);
  });

  it('9.1 and 2 days before', () => {
    expect(kinds(onDay('2026-10-13', [everyday]))).toEqual(['card-due']);
  });

  it('9.6 on the days between the reminders too, until it is paid (A17)', () => {
    expect(tracking(onDay('2026-10-10', [everyday])).attention).toEqual([
      { kind: 'card-due', card: 'everyday-card', dueDate: '2026-10-15', daysLeft: 5, statementBalance: 123_456, minimumPayment: 3_500 },
    ]);
  });

  it('9.6 not before the first reminder day', () => {
    expect(kinds(onDay('2026-10-07', [everyday]))).toEqual([]);
  });

  it('9.2 the old card shows its minimum and due date only', () => {
    expect(tracking(onDay('2026-10-13', [old])).attention).toEqual([
      { kind: 'card-due', card: 'old-card', dueDate: '2026-10-15', daysLeft: 2, minimumPayment: 4_000 },
    ]);
  });

  it('9.3 the everyday card paid in full has no reminder', () => {
    const book = openTestBook({ pots: { needs: 500_000 } });
    book.receive(transfer('t1', '2026-10-01', 123_456, 'checking', 'everyday-card'));
    expect(kinds(onDay('2026-10-13', [everyday], book))).toEqual([]);
  });

  it('9.3 the everyday card paid one cent short still reminds', () => {
    const book = openTestBook({ pots: { needs: 500_000 } });
    book.receive(transfer('t1', '2026-10-01', 123_455, 'checking', 'everyday-card'));
    expect(kinds(onDay('2026-10-13', [everyday], book))).toEqual(['card-due']);
  });

  it('9.4 past the due date with less than the minimum paid is overdue, every day', () => {
    expect(tracking(onDay('2026-10-16', [old])).attention).toEqual([{ kind: 'card-overdue', card: 'old-card', dueDate: '2026-10-15', minimumPayment: 4_000 }]);
    expect(kinds(onDay('2026-11-30', [old]))).toEqual(['card-overdue']);
  });

  it('9.4 the minimum paid means no overdue item', () => {
    const book = openTestBook({ pots: { needs: 500_000 } });
    book.receive(transfer('t1', '2026-10-01', 4_000, 'checking', 'old-card'));
    expect(kinds(onDay('2026-10-16', [old], book))).toEqual([]);
  });

  it('9.4 9.6 on the due date itself it is due, not overdue yet', () => {
    expect(tracking(onDay('2026-10-15', [old])).attention).toEqual([{ kind: 'card-due', card: 'old-card', dueDate: '2026-10-15', daysLeft: 0, minimumPayment: 4_000 }]);
  });
});

describe('10.6 a take-back on Home, until it is seen (B84)', () => {
  function tookBack(): ReturnType<typeof openTestBook> {
    const book = openTestBook({ pots: { wants: 50_000 }, rules: [WANTS_RULE] });
    book.receive(purchase('p1', '2026-10-02', 3_890, 'COFFEE BAR'));
    book.receive(purchase('p2', '2026-10-02', 3_890, 'COFFEE BAR'));
    book.receive(takenBack('tb1', 'p2', '2026-10-03'));
    return book;
  }

  it('10.6 the bank taking back a charge shows what, how much, and when', () => {
    const view = tracking(homeView(input(tookBack(), { today: '2026-10-03' })));
    expect(view.attention).toEqual([{ kind: 'bank-took-back', id: 'p2', date: '2026-10-03', description: 'COFFEE BAR', amount: 3_890 }]);
    // 4.10: its money went back where it came from.
    expect(shownAmount(view)).toBe(50_000 - 3_890);
  });

  it('10.6 it stays, day after day, until he has seen it', () => {
    const book = tookBack();
    expect(kinds(homeView(input(book, { today: '2026-10-20' })))).toEqual(['bank-took-back']);
    // Taking the phone alert (Phase 5) does not count as seeing it on Home.
    book.takeAlerts({ bankConnection: 'ok', bankBalances: matchingBank(book) });
    expect(kinds(homeView(input(book, { today: '2026-10-20' })))).toEqual(['bank-took-back']);
  });

  it('10.6 once seen, it is gone', () => {
    expect(kinds(homeView(input(tookBack(), { seenTakeBacks: new Set(['p2']) })))).toEqual([]);
  });

  it('10.6 each take-back on its own, oldest first, and seeing one leaves the other', () => {
    const book = tookBack();
    book.receive(purchase('p3', '2026-10-04', 1, 'COFFEE BAR'));
    book.receive(takenBack('tb2', 'p3', '2026-10-05'));
    const both = tracking(homeView(input(book, { today: '2026-10-05' })));
    expect(both.attention.map((a) => (a.kind === 'bank-took-back' ? a.id : a.kind))).toEqual(['p2', 'p3']);
    const one = tracking(homeView(input(book, { today: '2026-10-05', seenTakeBacks: new Set(['p2']) })));
    expect(one.attention).toEqual([{ kind: 'bank-took-back', id: 'p3', date: '2026-10-05', description: 'COFFEE BAR', amount: 1 }]);
  });

  it('10.6 nothing taken back, nothing shown; a seen id that matches nothing changes nothing', () => {
    expect(kinds(homeView(input(openTestBook(), { seenTakeBacks: new Set(['nothing-like-this']) })))).toEqual([]);
  });
});

describe('Home: what comes first', () => {
  it('bank login, overdue cards, take-backs, review, savings, then cards due', () => {
    const book = openTestBook({ pots: { savings: 100_000, needs: 500_000 } });
    book.receive(purchase('p1', '2026-10-13', 1_000, 'NO RULE SHOP'));
    book.receive(purchase('p2', '2026-10-13', 500, 'NO RULE SHOP'));
    book.receive(takenBack('tb1', 'p2', '2026-10-13'));
    const overdue: CardStatement = { card: 'old-card', closingDate: '2026-09-01', dueDate: '2026-10-01', statementBalance: 1_000, minimumPayment: 1_000 };
    const due: CardStatement = { card: 'everyday-card', closingDate: '2026-09-20', dueDate: '2026-10-15', statementBalance: 9_999, minimumPayment: 2_500 };
    const view = homeView(input(book, { today: '2026-10-13', needsLogin: true, statements: [due, overdue], bank: matchingBank(book, 50_000) }));
    expect(kinds(view)).toEqual(['bank-login', 'card-overdue', 'bank-took-back', 'review', 'move-to-savings', 'card-due']);
  });
});

describe('14 Home before setup day', () => {
  it('14 before setup day there is nothing to show yet', () => {
    expect(homeView(input(null))).toEqual({ state: 'not-set-up', madeUpData: false });
  });

  it('the demo says its numbers are made up', () => {
    expect(homeView(input(null, { madeUpData: true }))).toEqual({ state: 'not-set-up', madeUpData: true });
    expect(tracking(homeView(input(openTestBook(), { madeUpData: true }))).madeUpData).toBe(true);
  });
});

describe('Home view, for random books', () => {
  it('11.1 12.3 10.1 10.3 every number matches the money math, and survives the trip to the phone', () => {
    const shops = ['COFFEE BAR', 'GROCER', 'NO RULE SHOP'] as const;
    fc.assert(
      fc.property(
        fc.record({
          needs: fc.integer({ min: -100_000, max: 5_000_000 }),
          wants: fc.integer({ min: -100_000, max: 5_000_000 }),
          savings: fc.integer({ min: 0, max: 50_000_000 }),
          momReserve: fc.integer({ min: 0, max: 300_000 }),
        }),
        fc.array(fc.record({ shop: fc.constantFrom(...shops), amount: fc.integer({ min: 1, max: 200_000 }), pending: fc.boolean() }), { maxLength: 12 }),
        fc.integer({ min: -3, max: 3 }),
        fc.integer({ min: 0, max: 30 }),
        (pots, buys, bankOff, day) => {
          const book = openTestBook({ pots, rules: [WANTS_RULE, NEEDS_RULE] });
          buys.forEach((b, i) => book.receive(purchase(`p${i}`, START_DATE, b.amount, b.shop, { pending: b.pending })));
          const bank = matchingBank(book, pots.savings);
          const today = addDays(START_DATE, day);
          const view = tracking(homeView(input(book, { today, bank: { ...bank, checking: bank.checking + bankOff } })));
          const p = book.pots();
          if (bankOff === 0) expect(view.safeToSpend).toEqual({ shown: true, amount: p.wants - p.unsortedOut });
          else expect(view.safeToSpend).toMatchObject({ shown: false, why: 'totals-do-not-match', check: { difference: bankOff } });
          expect(view.buckets.needs.left).toBe(p.needs);
          expect(view.buckets.wants.left).toBe(p.wants);
          expect(view.waitingInReview).toBe(book.reviewItems().length);
          expect(view.payday.days).toBe(8 - day);
          expect(JSON.parse(JSON.stringify(view))).toEqual(view);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('Step 3: "Checked at", when the bank was last read', () => {
  it('Step 3 Checked at is the moment the bank was last read, in his home time zone, with that zone', () => {
    const book = openTestBook();
    const view = tracking(homeView(input(book, { checkedAt: { at: '2026-10-09T15:05:00-04:00', timeZone: 'America/New_York' } })));
    expect(view.checkedAt).toEqual({ at: '2026-10-09T15:05:00-04:00', timeZone: 'America/New_York' });
    expect(view.timeZone).toBe('America/New_York');
  });

  it('Step 3 before the first read there is none to show', () => {
    expect(tracking(homeView(input(openTestBook()))).checkedAt).toBeNull();
    expect(tracking(homeView(input(openTestBook(), { checkedAt: null }))).checkedAt).toBeNull();
  });

  it('Step 3 0.5 10.5 it stays when the bank cannot be read: the last read, next to the last checked safe to spend', () => {
    const book = openTestBook();
    const view = tracking(homeView(input(book, { bank: null, needsLogin: true, lastChecked: { amount: 61_250, at: '2026-10-09T15:05:00-04:00' }, checkedAt: { at: '2026-10-09T15:05:00-04:00', timeZone: 'America/New_York' } })));
    expect(view.safeToSpend).toEqual({ shown: false, why: 'bank-not-read', lastChecked: { amount: 61_250, at: '2026-10-09T15:05:00-04:00' } });
    expect(view.checkedAt?.at).toBe('2026-10-09T15:05:00-04:00');
  });

  it('Step 3 the times on Home are in his home time zone, the setting (section 2)', () => {
    const book = openTestBook();
    book.changeSettings({ homeTimeZone: 'America/Chicago' }, START_DATE);
    expect(tracking(homeView(input(book))).timeZone).toBe('America/Chicago');
  });

  it('Step 3 a time that is not a time with its offset is refused', () => {
    for (const at of ['2026-10-09T15:05:00', 'soon', '2026-10-09']) expect(() => homeView(input(openTestBook(), { checkedAt: { at, timeZone: 'America/New_York' } })), at).toThrow();
  });
});
