import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, FROM_NEXT_PAYCHECK, nextPayday, payoffCountdown, type IsoDate, type Settings } from '../src/index.js';
import { codeOf, openTestBook, paycheck } from './helpers.js';

// Rulebook section 2, the pay schedule (QUESTIONS.md A48, his call, Oct 14,
// 2026): twice a month, on the 15th and on the last day of the month; when
// that day is a Saturday or Sunday, the Friday before. The other choice is
// every 14 days, counted from the last paycheck. The next payday is the one
// after the scheduled payday nearest the last paycheck, so a paycheck a few
// days early or late does not move the next one.
const TWICE = { paySchedule: 'twice-a-month', payScheduleDays: 14 } as const;
const next = (last: IsoDate, today: IsoDate = last) => nextPayday(last, TWICE, today);

describe('section 2 the pay schedule: twice a month, the 15th and the last day of the month', () => {
  it('section 2 starts as every 14 days; twice a month is the other choice', () => {
    expect(DEFAULT_SETTINGS.paySchedule).toBe('every-n-days');
    expect(DEFAULT_SETTINGS.payScheduleDays).toBe(14);
    expect(nextPayday('2026-10-15', { paySchedule: 'every-n-days', payScheduleDays: 14 }, '2026-10-16')).toEqual({ nextPayday: '2026-10-29', daysToPayday: 13 });
  });

  it('section 2 the 15th, then the last day (a weekday, the 31st)', () => {
    expect(next('2026-12-15', '2026-12-16')).toEqual({ nextPayday: '2026-12-31', daysToPayday: 15 });
  });

  it('section 2 the last day, then the 15th of the next month', () => {
    expect(next('2026-11-30')).toEqual({ nextPayday: '2026-12-15', daysToPayday: 15 });
  });

  it('section 2 a month whose last day is the 30th', () => {
    expect(next('2026-11-13')).toMatchObject({ nextPayday: '2026-11-30' });
  });

  it('section 2 the last day on a Saturday moves to the Friday before (Oct 31, 2026)', () => {
    expect(next('2026-10-15', '2026-10-16')).toEqual({ nextPayday: '2026-10-30', daysToPayday: 14 });
  });

  it('section 2 the 15th on a Sunday moves to the Friday before (Nov 15, 2026)', () => {
    expect(next('2026-10-30')).toMatchObject({ nextPayday: '2026-11-13' });
  });

  it('section 2 the 15th on a Saturday moves to the Friday before (Aug 15, 2026)', () => {
    expect(next('2026-07-31')).toMatchObject({ nextPayday: '2026-08-14' });
  });

  it('section 2 the last day on a Sunday moves to the Friday before (Jan 31, 2027)', () => {
    expect(next('2027-01-15')).toMatchObject({ nextPayday: '2027-01-29' });
    expect(next('2027-01-29')).toMatchObject({ nextPayday: '2027-02-15' });
  });

  it('section 2 February: the 28th on a Sunday is Friday the 26th; a leap year pays on the 29th', () => {
    expect(next('2027-02-15')).toMatchObject({ nextPayday: '2027-02-26' });
    expect(next('2027-02-26')).toMatchObject({ nextPayday: '2027-03-15' });
    expect(next('2028-02-15')).toMatchObject({ nextPayday: '2028-02-29' });
    expect(next('2028-02-29')).toMatchObject({ nextPayday: '2028-03-15' });
  });

  it('section 2 the year\'s end: Dec 31 to Jan 15, and Dec 31 on a Sunday is Friday the 29th', () => {
    expect(next('2026-12-31')).toEqual({ nextPayday: '2027-01-15', daysToPayday: 15 });
    expect(next('2028-12-15')).toMatchObject({ nextPayday: '2028-12-29' });
    expect(next('2028-12-29')).toMatchObject({ nextPayday: '2029-01-15' });
  });

  it('section 2 a paycheck a day late does not move the next payday', () => {
    expect(next('2026-10-16')).toMatchObject({ nextPayday: '2026-10-30' });
  });

  it('section 2 a paycheck a day early does not move the next payday', () => {
    expect(next('2026-10-29')).toMatchObject({ nextPayday: '2026-11-13' });
  });

  it('section 2 four days late in February, where paydays are 11 days apart, still pays next on the 26th', () => {
    expect(next('2027-02-19')).toMatchObject({ nextPayday: '2027-02-26' });
  });

  it('section 2 five days early in February is nearer the 26th than the 15th, so the next payday is Mar 15', () => {
    expect(next('2027-02-21')).toMatchObject({ nextPayday: '2027-03-15' });
  });

  it('section 2 three days early is still that payday', () => {
    expect(next('2027-02-12')).toMatchObject({ nextPayday: '2027-02-26' });
  });

  it('section 2 exactly halfway between two paydays counts as the earlier one, late', () => {
    // Dec 15 and Dec 31, 2026 are 16 days apart; Dec 23 is 8 from each.
    expect(next('2026-12-23')).toMatchObject({ nextPayday: '2026-12-31' });
    expect(next('2026-12-24')).toMatchObject({ nextPayday: '2027-01-15' });
  });

  it('section 2 a paycheck on the 1st, after a last day moved to the Friday before, counts as that payday', () => {
    expect(next('2027-02-01')).toMatchObject({ nextPayday: '2027-02-15' });
  });

  it('section 2 the pay schedule is one of the two choices', () => {
    const book = openTestBook();
    expect(codeOf(() => book.changeSettings({ paySchedule: 'monthly' as Settings['paySchedule'] }, '2026-10-06'))).toBe('bad-setting');
  });
});

describe('11.2 days to payday from the twice-a-month schedule', () => {
  it('11.2 counts down to the next scheduled payday', () => {
    const book = openTestBook({ date: '2026-10-15', lastPaycheckDate: '2026-10-15', settings: TWICE });
    expect(book.safeToSpend('2026-10-20')).toMatchObject({ nextPayday: '2026-10-30', daysToPayday: 10 });
  });

  it('11.2 B35 a payday that passes with no paycheck goes negative instead of jumping ahead', () => {
    const book = openTestBook({ date: '2026-10-15', lastPaycheckDate: '2026-10-15', settings: TWICE });
    expect(book.safeToSpend('2026-11-02')).toMatchObject({ nextPayday: '2026-10-30', daysToPayday: -3 });
  });

  it('11.2 the next paycheck, a day early, restarts the count from the schedule', () => {
    const book = openTestBook({ date: '2026-10-15', lastPaycheckDate: '2026-10-15', settings: { ...TWICE, leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } } });
    expect(book.receive(paycheck('p1', '2026-10-29', 400_000)).outcome).toBe('paycheck');
    expect(book.safeToSpend('2026-10-29')).toMatchObject({ nextPayday: '2026-11-13', daysToPayday: 15 });
  });
});

describe('3.7 the shortest gap between twice-a-month paydays still splits', () => {
  it('3.7 Feb 15 to Feb 26, 2027 is 11 days: on time, it is a paycheck, not held for review', () => {
    const book = openTestBook({ date: '2027-02-15', lastPaycheckDate: '2027-02-15', settings: TWICE });
    expect(book.receive(paycheck('p1', '2027-02-26', 400_000)).outcome).toBe('paycheck');
  });
});

describe('13.1 a change of pay schedule applies right away; it is not the split', () => {
  it('13.1 changed mid pay period, the next payday moves at once, and it is logged', () => {
    const book = openTestBook({ date: '2026-10-15', lastPaycheckDate: '2026-10-15' });
    expect(book.safeToSpend('2026-10-20')).toMatchObject({ nextPayday: '2026-10-29' });
    book.changeSettings({ paySchedule: 'twice-a-month' }, '2026-10-20');
    expect(book.safeToSpend('2026-10-20')).toMatchObject({ nextPayday: '2026-10-30', daysToPayday: 10 });
    expect(book.changeLog().at(-1)).toMatchObject({ kind: 'settings-changed', changes: { paySchedule: 'twice-a-month' }, before: { paySchedule: 'every-n-days' } });
    expect(FROM_NEXT_PAYCHECK).not.toContain('paySchedule');
  });
});

describe('9.5 the payoff countdown counts the twice-a-month paydays', () => {
  const book = (end: IsoDate) => openTestBook({ date: '2026-10-15', lastPaycheckDate: '2026-10-15', oldCardDebt: 300_000, settings: { ...TWICE, oldCardPromoEndDate: end } });

  it('9.5 paydays after today and before the end: Oct 30, Nov 13, Nov 30, Dec 15, Dec 31', () => {
    expect(payoffCountdown(book('2027-01-10'), '2026-10-16')).toEqual({ on: true, owed: 300_000, promoEndDate: '2027-01-10', paydaysLeft: 5, perPayday: 60_000 });
  });

  it('9.5 a payday today does not count, nor one on the end date', () => {
    expect(payoffCountdown(book('2027-01-10'), '2026-10-30')).toMatchObject({ paydaysLeft: 4, perPayday: 75_000 });
    expect(payoffCountdown(book('2026-12-31'), '2026-10-16')).toMatchObject({ paydaysLeft: 4 });
  });
});
