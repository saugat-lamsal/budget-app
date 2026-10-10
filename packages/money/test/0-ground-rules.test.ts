import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MoneyError,
  addCents,
  addDays,
  assertCents,
  changeSettings,
  daysBetween,
  formatDollars,
  monthOf,
  parseDollars,
  percentOf,
  subtractCents,
  validateSettings,
  type Settings,
} from '../src/index.js';

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof MoneyError) return error.code;
    throw error;
  }
  return 'no error';
}

describe('0.1 all amounts are whole cents', () => {
  it('0.1 accepts whole cents: zero, one cent, negative, and very large', () => {
    for (const value of [0, 1, -1, 150_000, -150_000, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER]) {
      expect(() => assertCents(value)).not.toThrow();
    }
  });

  it('0.1 rejects anything that is not a whole number of cents', () => {
    for (const value of [0.5, 1.5, 0.1, -0.01, Number.NaN, Infinity, -Infinity, 2 ** 53, '100', null, undefined]) {
      expect(codeOf(() => assertCents(value))).toBe('not-cents');
    }
  });

  it('0.1 adding and subtracting stays exact', () => {
    expect(addCents(10, 20)).toBe(30);
    expect(addCents(1, -1)).toBe(0);
    // The classic floating point trap: 0.10 + 0.20 in dollars is not 0.30.
    // In cents it is exact.
    expect(addCents(10, 20, 30)).toBe(60);
    expect(subtractCents(0, 1)).toBe(-1);
    expect(subtractCents(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(0);
  });

  it('0.1 refuses a total too large to stay exact instead of rounding it', () => {
    expect(codeOf(() => addCents(Number.MAX_SAFE_INTEGER, 1))).toBe('not-cents');
    expect(codeOf(() => subtractCents(-Number.MAX_SAFE_INTEGER, 1))).toBe('not-cents');
    expect(codeOf(() => addCents(0.5, 0.5))).toBe('not-cents');
  });

  it('0.1 a percentage of an amount rounds down to a whole cent', () => {
    expect(percentOf(100, 30)).toBe(30);
    expect(percentOf(1, 30)).toBe(0);
    expect(percentOf(99, 50)).toBe(49);
    expect(percentOf(0, 50)).toBe(0);
    expect(percentOf(12_345, 0)).toBe(0);
    expect(percentOf(12_345, 100)).toBe(12_345);
    // Very large amounts stay exact (the multiplication would overflow a
    // plain number before the division).
    expect(percentOf(Number.MAX_SAFE_INTEGER, 50)).toBe(4_503_599_627_370_495);
    expect(percentOf(Number.MAX_SAFE_INTEGER, 100)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('0.1 a percentage must be a whole number from 0 to 100, of an amount of zero or more', () => {
    expect(codeOf(() => percentOf(100, 101))).toBe('bad-percent');
    expect(codeOf(() => percentOf(100, -1))).toBe('bad-percent');
    expect(codeOf(() => percentOf(100, 12.5))).toBe('bad-percent');
    expect(codeOf(() => percentOf(-100, 50))).toBe('not-positive');
    expect(codeOf(() => percentOf(1.5, 50))).toBe('not-cents');
  });

  it('0.1 dollars are read and written without floating point', () => {
    expect(parseDollars('1,234.56')).toBe(123_456);
    expect(parseDollars('$1,500.00')).toBe(150_000);
    expect(parseDollars('0.01')).toBe(1);
    expect(parseDollars('0.10')).toBe(10);
    expect(parseDollars('-12.30')).toBe(-1_230);
    expect(parseDollars('-$12.30')).toBe(-1_230);
    expect(parseDollars('3000')).toBe(300_000);
    expect(parseDollars('90,071,992,547,409.91')).toBe(Number.MAX_SAFE_INTEGER);
    for (const bad of ['', '1.234', '1.5', '12.', '.50', 'abc', '1,23.00', '1 000.00', '--1.00', '90,071,992,547,409.92']) {
      expect(codeOf(() => parseDollars(bad))).toBe('not-dollars');
    }
    expect(formatDollars(123_456)).toBe('$1,234.56');
    expect(formatDollars(1)).toBe('$0.01');
    expect(formatDollars(0)).toBe('$0.00');
    expect(formatDollars(-1_230)).toBe('-$12.30');
    expect(formatDollars(Number.MAX_SAFE_INTEGER)).toBe('$90,071,992,547,409.91');
  });
});

describe('calendar dates (the money math has no clock; dates are passed in)', () => {
  it('counts days between dates, across months, years, and a leap day', () => {
    expect(daysBetween('2026-10-01', '2026-10-15')).toBe(14);
    expect(daysBetween('2026-10-15', '2026-10-01')).toBe(-14);
    expect(daysBetween('2026-12-25', '2027-01-08')).toBe(14);
    expect(daysBetween('2028-02-20', '2028-03-05')).toBe(14);
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14); // US clocks change on Mar 8; days do not.
    expect(addDays('2026-10-01', 14)).toBe('2026-10-15');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(monthOf('2026-10-31')).toBe('2026-10');
  });

  it('rejects dates that do not exist', () => {
    for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-01', '10/06/2026', '', '2026-10-06T00:00']) {
      expect(codeOf(() => daysBetween(bad, '2026-10-06'))).toBe('not-a-date');
    }
  });
});

describe('0.2 every number and rule is a setting', () => {
  it('0.2 the starting settings match rulebook section 2', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      split: { savings: 50, needs: 30, wants: 20 },
      momReservePerPaycheck: 150_000,
      momReserveCap: 300_000,
      momMonthlyTarget: { low: 200_000, high: 300_000 },
      lowBucketAlertPercent: 20,
      cardReminderDaysBefore: [7, 2],
      dailyReviewTime: '20:00',
      leftoverAtPayday: { needs: 'ask', wants: 'ask' },
      oldCardPromoEndDate: null,
      paycheckRule: null,
      payScheduleDays: 14,
      momRule: null,
      earlyPaycheckDays: 10,
      homeTimeZone: 'America/New_York',
    } satisfies Settings);
  });

  it('0.2 the starting settings cannot be changed by accident', () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.split)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.cardReminderDaysBefore)).toBe(true);
  });

  it('0.2 any setting can be changed, and the result is checked', () => {
    const changed = changeSettings(DEFAULT_SETTINGS, {
      split: { savings: 60, needs: 25, wants: 15 },
      momReservePerPaycheck: 100_000,
      momReserveCap: 250_000,
      payScheduleDays: 7,
      earlyPaycheckDays: 5,
      leftoverAtPayday: { needs: 'roll-over', wants: 'move-to-savings' },
      paycheckRule: { contains: 'ACME PAYROLL' },
      momRule: { contains: 'Made Up Name' },
      oldCardPromoEndDate: '2027-06-30',
      cardReminderDaysBefore: [10, 3, 1],
      dailyReviewTime: '21:30',
      lowBucketAlertPercent: 25,
      momMonthlyTarget: { low: 100_000, high: 200_000 },
      homeTimeZone: 'America/Chicago',
    });
    expect(changed.split).toEqual({ savings: 60, needs: 25, wants: 15 });
    expect(changed.homeTimeZone).toBe('America/Chicago');
    expect(changed.payScheduleDays).toBe(7);
    expect(changed.oldCardPromoEndDate).toBe('2027-06-30');
    expect(DEFAULT_SETTINGS.split).toEqual({ savings: 50, needs: 30, wants: 20 });
    expect(Object.isFrozen(changed)).toBe(true);
  });

  it('0.2 the split must add up to exactly 100', () => {
    expect(codeOf(() => changeSettings(DEFAULT_SETTINGS, { split: { savings: 50, needs: 30, wants: 30 } }))).toBe('bad-setting');
    expect(codeOf(() => changeSettings(DEFAULT_SETTINGS, { split: { savings: 50, needs: 30, wants: 19 } }))).toBe('bad-setting');
    expect(codeOf(() => changeSettings(DEFAULT_SETTINGS, { split: { savings: 110, needs: -10, wants: 0 } }))).toBe('bad-setting');
    expect(codeOf(() => changeSettings(DEFAULT_SETTINGS, { split: { savings: 50.5, needs: 29.5, wants: 20 } }))).toBe('bad-setting');
    expect(changeSettings(DEFAULT_SETTINGS, { split: { savings: 100, needs: 0, wants: 0 } }).split.savings).toBe(100);
  });

  it('0.2 settings that make no sense are refused', () => {
    const bad: Partial<Settings>[] = [
      { momReservePerPaycheck: -1 },
      { momReservePerPaycheck: 1.5 },
      { momReserveCap: -1 },
      { momMonthlyTarget: { low: 300_001, high: 300_000 } },
      { momMonthlyTarget: { low: -1, high: 300_000 } },
      { lowBucketAlertPercent: 101 },
      { lowBucketAlertPercent: -1 },
      { cardReminderDaysBefore: [-1] },
      { cardReminderDaysBefore: [1.5] },
      { dailyReviewTime: '24:00' },
      { dailyReviewTime: '8pm' },
      { oldCardPromoEndDate: '2027-02-30' },
      { paycheckRule: { contains: '' } },
      { paycheckRule: { contains: '   ' } },
      { momRule: { contains: '' } },
      { payScheduleDays: 0 },
      { payScheduleDays: 14.5 },
      { earlyPaycheckDays: -1 },
      { homeTimeZone: '' },
      { homeTimeZone: 'Mars/Olympus_Mons' },
      { homeTimeZone: 'EST5EDT; DROP' },
    ];
    for (const patch of bad) {
      expect(codeOf(() => changeSettings(DEFAULT_SETTINGS, patch)), JSON.stringify(patch)).toBe('bad-setting');
    }
  });

  it('0.2 exact boundaries are allowed: a zero reserve, a reserve equal to the cap, a target of one amount', () => {
    expect(() => changeSettings(DEFAULT_SETTINGS, { momReservePerPaycheck: 0, momReserveCap: 0 })).not.toThrow();
    expect(() => changeSettings(DEFAULT_SETTINGS, { momReservePerPaycheck: 300_000, momReserveCap: 300_000 })).not.toThrow();
    expect(() => changeSettings(DEFAULT_SETTINGS, { momMonthlyTarget: { low: 250_000, high: 250_000 } })).not.toThrow();
    expect(() => changeSettings(DEFAULT_SETTINGS, { lowBucketAlertPercent: 0 })).not.toThrow();
    expect(() => changeSettings(DEFAULT_SETTINGS, { lowBucketAlertPercent: 100 })).not.toThrow();
    expect(() => changeSettings(DEFAULT_SETTINGS, { dailyReviewTime: '00:00' })).not.toThrow();
    expect(() => changeSettings(DEFAULT_SETTINGS, { dailyReviewTime: '23:59' })).not.toThrow();
    expect(() => changeSettings(DEFAULT_SETTINGS, { earlyPaycheckDays: 0 })).not.toThrow();
  });

  it('section 2 the home time zone is a setting: any time zone by its name, America/New_York to start; the money math only keeps it', () => {
    for (const zone of ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'UTC', 'Asia/Kathmandu']) {
      expect(changeSettings(DEFAULT_SETTINGS, { homeTimeZone: zone }).homeTimeZone).toBe(zone);
    }
    expect(codeOf(() => changeSettings(DEFAULT_SETTINGS, { homeTimeZone: 'New York' }))).toBe('bad-setting');
    expect(codeOf(() => changeSettings(DEFAULT_SETTINGS, { homeTimeZone: 'x'.repeat(65) }))).toBe('bad-setting');
  });

  it('0.2 validateSettings accepts the starting settings unchanged', () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});
