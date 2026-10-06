import { describe, expect, it } from 'vitest';
import { MOM_NAME, codeOf, deposit, openTestBook, payPerson, paycheck, posted, purchase, refund, sent } from './helpers.js';

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
