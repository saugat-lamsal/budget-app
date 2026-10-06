import { describe, expect, it } from 'vitest';
import type { Book } from '../src/index.js';
import { MOM_NAME, appSide, codeOf, deposit, openTestBook, payPerson, paycheck, posted, purchase, refund, sent } from './helpers.js';

// A total too large to stay exact is refused (0.1). Whatever was refused
// must change nothing at all, so the same transaction can be tried again
// and is not mistaken for a duplicate (found in the review). The amounts
// are far beyond any real budget; what matters is "refused means unchanged".
const MAX = Number.MAX_SAFE_INTEGER;
const HUGE = MAX - 1_000;

describe('0.1 a refused transaction leaves no trace', () => {
  it('0.1 a transfer half that would overflow the in-transit total', () => {
    const b = openTestBook();
    b.receive(sent('s1', '2026-10-05', HUGE, 'checking', 'savings'));
    expect(codeOf(() => b.receive(sent('s2', '2026-10-05', HUGE, 'checking', 'savings')))).toBe('not-cents');
    expect(b.inTransit()).toEqual({ total: HUGE, items: [{ id: 's1', date: '2026-10-05', from: 'checking', to: 'savings', amount: HUGE, seen: 'left' }] });
    expect(codeOf(() => b.receive(sent('s2', '2026-10-05', HUGE, 'checking', 'savings')))).toBe('not-cents');
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('0.1 a purchase that would overflow its bucket', () => {
    const b = openTestBook({ pots: { needs: -HUGE }, rules: [{ id: 'g', for: 'purchase', contains: 'GROCER', bucket: 'needs' }] });
    expect(codeOf(() => b.receive(purchase('e1', '2026-10-05', 2_000, 'MADE UP GROCER')))).toBe('not-cents');
    expect(b.purchases()).toEqual([]);
    expect(b.reviewItems()).toEqual([]);
    expect(codeOf(() => b.receive(purchase('e1', '2026-10-05', 2_000, 'MADE UP GROCER')))).toBe('not-cents');
  });

  it('0.1 a posting that would overflow keeps the pending charge as it was', () => {
    const b = openTestBook({ pots: { wants: -HUGE + 5_000 }, rules: [{ id: 'c', for: 'purchase', contains: 'CAFE', bucket: 'wants' }] });
    b.receive(purchase('p1', '2026-10-05', 1_000, 'MADE UP CAFE', { pending: true }));
    expect(codeOf(() => b.receive(posted('p2', 'p1', '2026-10-06', 10_000, 'MADE UP CAFE')))).toBe('not-cents');
    expect(b.purchases()).toMatchObject([{ id: 'p1', amount: 1_000, pending: true }]);
    expect(codeOf(() => b.receive(posted('p2', 'p1', '2026-10-06', 10_000, 'MADE UP CAFE')))).toBe('not-cents');
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('0.1 a refund that would overflow leaves the purchase as it was', () => {
    const b = openTestBook({ pots: { wants: HUGE }, rules: [{ id: 'c', for: 'purchase', contains: 'CAFE', bucket: 'wants' }] });
    b.receive(purchase('e1', '2026-10-05', 5_000, 'MADE UP CAFE'));
    // Wants fills up again in between, so giving the 5,000 back would overflow it.
    b.receive(deposit('d1', '2026-10-05', 4_000, 'MADE UP GIFT'));
    b.sort('d1', { to: 'wants' }, '2026-10-05');
    expect(codeOf(() => b.receive(refund('r1', '2026-10-06', 5_000, 'e1')))).toBe('not-cents');
    expect(b.purchases()).toMatchObject([{ id: 'e1', refunded: 0 }]);
    expect(codeOf(() => b.receive(refund('r1', '2026-10-06', 5_000, 'e1')))).toBe('not-cents');
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('0.1 a deposit a rule would sort into an overflowing bucket is refused whole', () => {
    const b = openTestBook({ pots: { wants: HUGE }, rules: [{ id: 'f', for: 'deposit', contains: 'FRIEND', choice: { to: 'wants' } }] });
    expect(codeOf(() => b.receive(deposit('d1', '2026-10-05', 5_000, 'MADE UP FRIEND')))).toBe('not-cents');
    expect(b.reviewItems()).toEqual([]);
    expect(b.pots().unsortedIn).toBe(0);
    expect(codeOf(() => b.receive(deposit('d1', '2026-10-05', 5_000, 'MADE UP FRIEND')))).toBe('not-cents');
  });

  it('0.1 sorting money in that would overflow its bucket leaves it waiting in review', () => {
    const b = openTestBook({ pots: { wants: HUGE } });
    b.receive(deposit('d1', '2026-10-06', 1_001, 'MADE UP GIFT'));
    expect(codeOf(() => b.sort('d1', { to: 'wants' }, '2026-10-06'))).toBe('not-cents');
    expect(b.reviewItems().map((i) => i.id)).toEqual(['d1']);
    expect(b.pots()).toMatchObject({ wants: HUGE, unsortedIn: 1_001 });
    // Still truly waiting: a new rule for it sorts it.
    b.addRule({ id: 'gift', for: 'deposit', contains: 'GIFT', choice: { to: 'needs' } }, '2026-10-07');
    expect(b.reviewItems()).toEqual([]);
    expect(b.pots()).toMatchObject({ needs: 1_001, unsortedIn: 0 });
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('0.1 a re-sort of spending that would overflow keeps the old sort', () => {
    const b = openTestBook({ pots: { needs: -HUGE } });
    b.receive(purchase('e1', '2026-10-05', 1_001, 'MADE UP STORE'));
    b.sort('e1', { to: 'wants' }, '2026-10-05');
    expect(codeOf(() => b.sort('e1', { to: 'needs' }, '2026-10-06'))).toBe('not-cents');
    expect(b.purchases()[0]?.sortedTo).toEqual({ to: 'wants' });
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('0.1 answering a leftover question that would overflow savings leaves the question open', () => {
    const b = openTestBook({ pots: { savings: HUGE - 125_000, needs: 2_000 } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(codeOf(() => b.answerLeftover('leftover:p1:needs', 'move-to-savings', '2026-10-09'))).toBe('not-cents');
    expect(b.reviewItems().map((i) => i.id)).toEqual(['leftover:p1:needs']);
    b.answerLeftover('leftover:p1:needs', 'roll-over', '2026-10-09');
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('0.1 a mom payment whose uncovered part would overflow leaves the reserve as it was', () => {
    const b = openTestBook({ pots: { momReserve: 1_000 } });
    b.receive(purchase('e1', '2026-10-05', HUGE, 'MADE UP STORE'));
    expect(codeOf(() => b.receive(payPerson('m1', '2026-10-06', 5_000, MOM_NAME)))).toBe('not-cents');
    expect(b.pots()).toMatchObject({ momReserve: 1_000, unsortedOut: HUGE });
    expect(b.momSentInMonth('2026-10').sent).toBe(0);
    expect(codeOf(() => b.receive(payPerson('m1', '2026-10-06', 5_000, MOM_NAME)))).toBe('not-cents');
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('0.1 a paycheck that would overflow changes no bucket, asks no leftover question, and starts no pay period', () => {
    const b = openTestBook({ pots: { savings: HUGE - 20_000, needs: 10_000 } });
    expect(codeOf(() => b.receive(paycheck('p1', '2026-10-09', 400_000)))).toBe('not-cents');
    expect(b.period().number).toBe(0);
    expect(b.lastPaycheckDate()).toBe('2026-09-25');
    expect(b.reviewItems()).toEqual([]);
    expect(b.pots()).toMatchObject({ savings: HUGE - 20_000, needs: 10_000 });
    expect(codeOf(() => b.receive(paycheck('p1', '2026-10-09', 400_000)))).toBe('not-cents');
    expect(b.recountPots()).toEqual(b.pots());
  });

});

// Everything a refused call could have touched, to compare before and after.
function state(b: Book) {
  return {
    pots: b.pots(),
    review: b.reviewItems(),
    purchases: b.purchases(),
    period: b.period(),
    lastPaycheckDate: b.lastPaycheckDate(),
    paychecks: b.paychecks(),
    started: b.startedPeriodWith(),
    rules: b.rules(),
    log: b.changeLog(),
    inTransit: b.inTransit(),
    debt: b.oldCardDebt(),
  };
}

const MOVE_NEEDS = { leftoverAtPayday: { needs: 'move-to-savings', wants: 'roll-over' } } as const;

describe('0.1 a refused change of several steps leaves no trace (found in the review of A5 and A8)', () => {
  it('0.1 a payday refused after moving a leftover to savings puts it all back', () => {
    // Moving needs' 30.00 to savings fits; the new savings share does not.
    const b = openTestBook({ pots: { savings: MAX - 100_000, needs: 3_000 }, settings: MOVE_NEEDS });
    const before = state(b);
    expect(codeOf(() => b.receive(paycheck('p1', '2026-10-09', 400_000)))).toBe('not-cents');
    expect(state(b)).toEqual(before);
    expect(codeOf(() => b.receive(paycheck('p1', '2026-10-09', 400_000)))).toBe('not-cents');
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('0.1 a refused payday keeps this pay period\'s split for other income (13.1)', () => {
    const b = openTestBook({ pots: { wants: MAX - 100_000 } });
    b.changeSettings({ split: { savings: 0, needs: 0, wants: 100 } }, '2026-10-05');
    expect(codeOf(() => b.receive(paycheck('p1', '2026-10-09', 400_000)))).toBe('not-cents');
    b.receive(deposit('d1', '2026-10-10', 1_000, 'MADE UP SIDE JOB'));
    b.sort('d1', { to: 'other-income' }, '2026-10-10');
    expect(b.pots()).toMatchObject({ savings: 500, needs: 300, wants: MAX - 100_000 + 200 });
  });

  it('0.1 a refused payday keeps the unanswered leftover question from the last payday', () => {
    const b = openTestBook({ pots: { needs: 3_000 } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.moveMoney({ from: 'needs', to: 'savings', amount: 70_000 }, '2026-10-10');
    b.receive(deposit('big', '2026-10-11', MAX - 200_000, 'MADE UP WINDFALL'));
    b.sort('big', { to: 'savings' }, '2026-10-11');
    const before = state(b);
    expect(before.review.map((i) => i.id)).toEqual(['leftover:p1:needs']);
    expect(codeOf(() => b.receive(paycheck('p2', '2026-10-23', 400_000)))).toBe('not-cents');
    expect(state(b)).toEqual(before);
    b.answerLeftover('leftover:p1:needs', 'roll-over', '2026-10-24');
  });

  it('0.1 a refused "this is my paycheck" leaves the deposit waiting, and the self-check holds', () => {
    // Someone owes you 5,000.00, which keeps the app side small enough to add up.
    const b = openTestBook({ pots: { savings: MAX - 100_000, needs: 3_000, heldForOthers: -500_000 }, settings: MOVE_NEEDS });
    b.receive(deposit('d1', '2026-10-09', 400_000, 'MADE UP NEW JOB'));
    const bank = { checking: appSide(b.pots()), savings: 0, everydayCard: 0 };
    const before = state(b);
    expect(codeOf(() => b.sort('d1', { to: 'paycheck' }, '2026-10-09'))).toBe('not-cents');
    expect(state(b)).toEqual(before);
    expect(b.selfCheck(bank).ok).toBe(true);
    expect(b.receive(deposit('d1', '2026-10-09', 400_000, 'MADE UP NEW JOB')).outcome).toBe('duplicate');
    expect(codeOf(() => b.sort('d1', { to: 'paycheck' }, '2026-10-09'))).toBe('not-cents');
    b.sort('d1', { to: 'not-mine' }, '2026-10-09');
    expect(b.selfCheck(bank).ok).toBe(true);
  });

  it('0.1 a payday never fails on keeping track of what the last pay period started with (10.1)', () => {
    // The first pay period started far below zero, and payday moves a
    // leftover to savings. The old start is replaced, never worked out.
    const b = openTestBook({ pots: { savings: MAX - 1_000, needs: -(MAX - 1_000) }, settings: MOVE_NEEDS });
    b.moveMoney({ from: 'savings', to: 'needs', amount: MAX - 1_000, confirmed: true }, '2026-10-02');
    b.receive(deposit('x1', '2026-10-03', 3_000, 'MADE UP FRIEND'));
    b.sort('x1', { to: 'needs' }, '2026-10-03');
    b.receive(deposit('d1', '2026-10-04', 1_000, 'MADE UP NEW JOB'));
    const bank = { checking: appSide(b.pots()), savings: 0, everydayCard: 0 };
    b.sort('d1', { to: 'paycheck' }, '2026-10-04');
    expect(b.selfCheck(bank).ok).toBe(true);
    expect(b.period().number).toBe(1);
    expect(b.startedPeriodWith().needs).toBe(b.pots().needs);
    b.receive(paycheck('p1', '2026-10-18', 1_000));
    expect(b.period().number).toBe(2);
  });

  it('0.1 a new rule refused part way through sorting what is waiting changes nothing (13.2)', () => {
    const b = openTestBook({ pots: { wants: MAX - 11_000 } });
    b.receive(deposit('d1', '2026-10-05', 1_000, 'MADE UP GIFT'));
    b.receive(deposit('d2', '2026-10-05', 1_000_000, 'MADE UP GIFT'));
    const before = state(b);
    expect(codeOf(() => b.addRule({ id: 'gift', for: 'deposit', contains: 'GIFT', choice: { to: 'other-income' } }, '2026-10-06'))).toBe('not-cents');
    expect(state(b)).toEqual(before);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('0.1 a changed rule refused part way through sorting what is waiting changes nothing (13.2)', () => {
    const b = openTestBook({ pots: { wants: MAX - 11_000 }, rules: [{ id: 'gift', for: 'deposit', contains: 'NOTHING LIKE IT', choice: { to: 'wants' } }] });
    b.receive(deposit('d1', '2026-10-05', 1_000, 'MADE UP GIFT'));
    b.receive(deposit('d2', '2026-10-05', 1_000_000, 'MADE UP GIFT'));
    const before = state(b);
    expect(codeOf(() => b.changeRule({ id: 'gift', for: 'deposit', contains: 'GIFT', choice: { to: 'wants' } }, '2026-10-06'))).toBe('not-cents');
    expect(state(b)).toEqual(before);
  });

  it('0.1 "always do this" refused part way through changes nothing, not even the item you corrected (13.6)', () => {
    const b = openTestBook({ pots: { wants: MAX - 11_000 } });
    b.receive(deposit('d1', '2026-10-05', 1_000, 'MADE UP GIFT'));
    b.receive(deposit('d2', '2026-10-05', 1_000_000, 'MADE UP GIFT'));
    const before = state(b);
    expect(codeOf(() => b.sortAlways('d1', { to: 'other-income' }, { id: 'gift', contains: 'GIFT' }, '2026-10-06'))).toBe('not-cents');
    expect(state(b)).toEqual(before);
  });
});
