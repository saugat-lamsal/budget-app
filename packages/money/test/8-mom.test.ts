import { describe, expect, it } from 'vitest';
import { codeOf, deposit, MOM_NAME, openTestBook, payPerson, paycheck, type TestBookOptions } from './helpers.js';

function book(options: TestBookOptions = {}) {
  return openTestBook({ pots: { savings: 10_000, needs: 20_000, wants: 30_000, momReserve: 150_000, heldForOthers: 0 }, ...options });
}

const START = { savings: 10_000, needs: 20_000, wants: 30_000, momReserve: 150_000, heldForOthers: 0, unsortedIn: 0, unsortedOut: 0 };

function payMom(id: string, date: string, amount: number) {
  return payPerson(id, date, amount, MOM_NAME.toUpperCase());
}

describe('8.1 any payment matching the mom rule comes out of the mom reserve', () => {
  it('8.1 it comes out of the reserve with no question', () => {
    const b = book();
    expect(b.receive(payMom('m1', '2026-10-03', 100_000))).toEqual({ id: 'm1', outcome: 'sorted' });
    expect(b.pots()).toEqual({ ...START, momReserve: 50_000 });
    expect(b.reviewItems()).toEqual([]);
  });

  it('8.1 whatever the day or amount: one cent, mid-month, exactly the whole reserve', () => {
    const b = book();
    b.receive(payMom('m1', '2026-10-01', 1));
    b.receive(payMom('m2', '2026-10-17', 49_999));
    b.receive(payMom('m3', '2026-10-31', 100_000));
    expect(b.pots()).toEqual({ ...START, momReserve: 0 });
    expect(b.reviewItems()).toEqual([]);
  });

  it('8.1 the mom rule comes before any rule for people', () => {
    const b = book({ rules: [{ id: 'x', for: 'person', contains: 'MADE UP', choice: { to: 'wants' } }] });
    b.receive(payMom('m1', '2026-10-03', 100_000));
    expect(b.pots()).toEqual({ ...START, momReserve: 50_000 });
  });

  it('8.1 before the mom rule is set, a payment to her is like any payment to a person', () => {
    const b = book({ settings: { momRule: null } });
    expect(b.receive(payMom('m1', '2026-10-03', 100_000)).outcome).toBe('review');
    expect(b.pots()).toEqual({ ...START, unsortedOut: 100_000 });
  });

  it('8.1 a mom payment always stays on the reserve and cannot be re-sorted', () => {
    const b = book();
    b.receive(payMom('m1', '2026-10-03', 100_000));
    expect(codeOf(() => b.sort('m1', { to: 'wants' }, '2026-10-04'))).toBe('not-sortable');
  });

  it('8.1 the same mom payment sent twice counts once', () => {
    const b = book();
    b.receive(payMom('m1', '2026-10-03', 100_000));
    expect(b.receive(payMom('m1', '2026-10-03', 100_000)).outcome).toBe('duplicate');
    expect(b.pots().momReserve).toBe(50_000);
  });
});

describe('8.2 how much you sent this calendar month, against the target', () => {
  it('8.2 adds up the month and shows the target from the settings', () => {
    const b = book({ pots: { momReserve: 300_000 } });
    b.receive(payMom('m0', '2026-09-30', 50_000));
    b.receive(payMom('m1', '2026-10-01', 100_000));
    b.receive(payMom('m2', '2026-10-31', 100_000));
    b.receive(payMom('m3', '2026-11-01', 25_000));
    expect(b.momSentInMonth('2026-10')).toEqual({ month: '2026-10', sent: 200_000, target: { low: 200_000, high: 300_000 } });
    expect(b.momSentInMonth('2026-09').sent).toBe(50_000);
    expect(b.momSentInMonth('2026-11').sent).toBe(25_000);
  });

  it('8.2 a month with nothing sent shows zero', () => {
    expect(book().momSentInMonth('2026-12')).toEqual({ month: '2026-12', sent: 0, target: { low: 200_000, high: 300_000 } });
  });

  it('8.2 the whole payment counts as sent, even the part the reserve could not cover', () => {
    const b = book();
    b.receive(payMom('m1', '2026-10-03', 200_000));
    expect(b.momSentInMonth('2026-10').sent).toBe(200_000);
  });

  it('8.2 the target follows the settings', () => {
    const b = book({ settings: { momMonthlyTarget: { low: 1, high: 2 } } });
    expect(b.momSentInMonth('2026-10').target).toEqual({ low: 1, high: 2 });
  });

  it('8.2 a month must be written as YYYY-MM', () => {
    for (const bad of ['2026-13', '2026-1', 'October', '2026-10-01']) {
      expect(codeOf(() => book().momSentInMonth(bad)), bad).toBe('not-a-date');
    }
  });
});

describe('8.3 a payment bigger than the reserve: you pick the bucket for the difference', () => {
  it('8.3 the reserve goes to zero and the difference waits in review', () => {
    const b = book();
    b.receive(payMom('m1', '2026-10-03', 200_000));
    expect(b.pots()).toEqual({ ...START, momReserve: 0, unsortedOut: 50_000 });
    expect(b.reviewItems()).toEqual([
      { type: 'spending', id: 'm1:difference', date: '2026-10-03', amount: 50_000, description: `ZELLE TO ${MOM_NAME.toUpperCase()}`, reason: 'mom-difference', suggestion: null },
    ]);
    b.sort('m1:difference', { to: 'needs' }, '2026-10-04');
    expect(b.pots()).toEqual({ ...START, momReserve: 0, needs: -30_000 });
  });

  it('8.3 one cent more than the reserve asks about one cent', () => {
    const b = book();
    b.receive(payMom('m1', '2026-10-03', 150_001));
    expect(b.pots()).toEqual({ ...START, momReserve: 0, unsortedOut: 1 });
  });

  it('8.3 exactly the reserve asks nothing', () => {
    const b = book();
    b.receive(payMom('m1', '2026-10-03', 150_000));
    expect(b.reviewItems()).toEqual([]);
  });

  it('8.3 with the reserve already empty, the whole payment asks', () => {
    const b = book({ pots: { momReserve: 0 } });
    b.receive(payMom('m1', '2026-10-03', 7_500));
    expect(b.pots()).toMatchObject({ momReserve: 0, unsortedOut: 7_500 });
    b.sort('m1:difference', { to: 'wants' }, '2026-10-04');
    expect(b.pots()).toMatchObject({ momReserve: 0, wants: -7_500, unsortedOut: 0 });
  });

  it('8.3 a reserve below zero covers nothing: the whole payment asks, and the reserve stays where it is', () => {
    // The reserve can drop below zero if income that filled it is later
    // re-sorted after mom was paid from it.
    const b = book({ pots: { momReserve: 0 } });
    b.receive(deposit('d1', '2026-10-01', 150_000, 'MADE UP BONUS'));
    b.sort('d1', { to: 'income' }, '2026-10-01');
    b.receive(payMom('m1', '2026-10-02', 150_000));
    b.sort('d1', { to: 'savings' }, '2026-10-03');
    expect(b.pots().momReserve).toBe(-150_000);
    b.receive(payMom('m2', '2026-10-04', 7_500));
    expect(b.pots()).toMatchObject({ momReserve: -150_000, unsortedOut: 7_500 });
  });

  it('8.3 the difference is covered by one bucket, needs or wants', () => {
    const b = book();
    b.receive(payMom('m1', '2026-10-03', 160_000));
    for (const to of ['savings', 'momReserve', 'not-mine', 'income']) {
      expect(codeOf(() => b.sort('m1:difference', { to } as never, '2026-10-04')), to).toBe('bad-choice');
    }
    const split = { split: [{ bucket: 'needs' as const, amount: 5_000 }, { bucket: 'wants' as const, amount: 5_000 }] };
    expect(codeOf(() => b.sort('m1:difference', split, '2026-10-04'))).toBe('bad-choice');
    b.sort('m1:difference', { to: 'wants' }, '2026-10-04');
    b.sort('m1:difference', { to: 'needs' }, '2026-10-05');
    expect(b.pots()).toEqual({ ...START, momReserve: 0, needs: 10_000 });
  });
});

describe('8.4 the reserve carries over between months, up to its cap', () => {
  it('8.4 nothing resets at the start of a month', () => {
    const b = book();
    b.receive(payMom('m1', '2026-10-30', 50_000));
    b.receive(deposit('d1', '2026-11-01', 100, 'MADE UP INTEREST'));
    expect(b.pots().momReserve).toBe(100_000);
    b.receive(payMom('m2', '2026-11-02', 100_000));
    expect(b.pots().momReserve).toBe(0);
    expect(b.reviewItems().filter((i) => i.type === 'spending')).toEqual([]);
  });

  it('8.4 paydays across months never push it past the cap; the rest goes to savings', () => {
    const b = book({ pots: { momReserve: 0 }, lastPaycheckDate: '2026-09-25', settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(paycheck('p2', '2026-10-23', 400_000));
    b.receive(paycheck('p3', '2026-11-06', 400_000));
    expect(b.pots().momReserve).toBe(300_000);
    expect(b.paychecks().map((p) => p.split.momReserve)).toEqual([150_000, 150_000, 0]);
    b.receive(payMom('m1', '2026-11-10', 100_000));
    b.receive(paycheck('p4', '2026-11-20', 400_000));
    expect(b.pots().momReserve).toBe(300_000);
    expect(b.paychecks()[3]?.split).toMatchObject({ momReserve: 100_000, detail: { overflowToSavings: 50_000 } });
  });
});
