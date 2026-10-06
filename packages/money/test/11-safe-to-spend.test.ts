import { describe, expect, it } from 'vitest';
import { codeOf, deposit, openTestBook, paycheck, purchase, type TestBookOptions } from './helpers.js';

function book(options: TestBookOptions = {}) {
  return openTestBook({
    pots: { savings: 200_000, needs: 50_000, wants: 30_000, momReserve: 150_000, heldForOthers: 6_000 },
    lastPaycheckDate: '2026-10-09',
    ...options,
  });
}

describe('11.1 safe to spend = wants left, minus unsorted spending', () => {
  it('11.1 with nothing unsorted, it is what is left in wants', () => {
    expect(book().safeToSpend('2026-10-14').amount).toBe(30_000);
  });

  it('11.1 unsorted spending is taken off', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-12', 4_500, 'MADE UP STORE'));
    expect(b.safeToSpend('2026-10-14').amount).toBe(25_500);
  });

  it('11.1 needs never count, even when unsorted spending could be a need', () => {
    const b = book({ pots: { needs: 999_999, wants: 0 } });
    b.receive(purchase('e1', '2026-10-12', 1, 'MADE UP STORE'));
    expect(b.safeToSpend('2026-10-14').amount).toBe(-1);
  });

  it('11.1 it can go below zero when wants are overspent', () => {
    expect(book({ pots: { wants: -2_500 } }).safeToSpend('2026-10-14').amount).toBe(-2_500);
  });

  it('11.1 sorting an unsorted purchase into needs gives it back', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-12', 4_500, 'MADE UP STORE'));
    b.sort('e1', { to: 'needs' }, '2026-10-13');
    expect(b.safeToSpend('2026-10-14').amount).toBe(30_000);
  });

  it('11.1 sorting it into wants keeps it off', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-12', 4_500, 'MADE UP STORE'));
    b.sort('e1', { to: 'wants' }, '2026-10-13');
    expect(b.safeToSpend('2026-10-14').amount).toBe(25_500);
  });
});

describe('11.2 shown with the days until the next payday, from the pay schedule', () => {
  it('11.2 counts from the last paycheck plus 14 days', () => {
    expect(book().safeToSpend('2026-10-14')).toEqual({ amount: 30_000, nextPayday: '2026-10-23', daysToPayday: 9 });
  });

  it('11.2 the day after a paycheck shows 13 days; payday itself shows 0', () => {
    expect(book().safeToSpend('2026-10-10').daysToPayday).toBe(13);
    expect(book().safeToSpend('2026-10-23').daysToPayday).toBe(0);
  });

  it('11.2 a new paycheck restarts the count', () => {
    const b = book({ settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } } });
    b.receive(paycheck('p1', '2026-10-23', 400_000));
    expect(b.safeToSpend('2026-10-23')).toMatchObject({ nextPayday: '2026-11-06', daysToPayday: 14 });
  });

  it('11.2 a paycheck that is late shows as negative days', () => {
    expect(book().safeToSpend('2026-10-25').daysToPayday).toBe(-2);
  });

  it('11.2 the pay schedule is a setting', () => {
    expect(book({ settings: { payScheduleDays: 7 } }).safeToSpend('2026-10-14')).toMatchObject({ nextPayday: '2026-10-16', daysToPayday: 2 });
  });

  it('11.2 today must be a real date', () => {
    expect(codeOf(() => book().safeToSpend('2026-10-32'))).toBe('not-a-date');
  });
});

describe('11.3 savings, mom reserve, held for others, and unsorted money in are never part of it', () => {
  it('11.3 changing any of them does not change safe to spend', () => {
    const base = book().safeToSpend('2026-10-14').amount;
    const different = book({ pots: { savings: -1, needs: 50_000, wants: 30_000, momReserve: 999_999, heldForOthers: -50_000 } });
    expect(different.safeToSpend('2026-10-14').amount).toBe(base);
  });

  it('11.3 money waiting in review does not raise it', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-12', 100_000, 'MADE UP GIFT'));
    expect(b.pots().unsortedIn).toBe(100_000);
    expect(b.safeToSpend('2026-10-14').amount).toBe(30_000);
  });

  it('11.3 money held for others does not raise it', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-12', 100_000, 'MADE UP ROOMMATE'));
    b.sort('d1', { to: 'not-mine' }, '2026-10-12');
    expect(b.safeToSpend('2026-10-14').amount).toBe(30_000);
  });
});
