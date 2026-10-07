import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { bucketLevel } from '../src/index.js';

// Rules 10.1 and 10.2 as a state the screens can show at any time (the
// bucket bars on Home), without taking the once-per-pay-period alerts.
// takeAlerts uses the same function, so the bars and the alerts agree.

describe('10.1 low bucket level', () => {
  it('10.1 below 20% of what the bucket started with is low', () => {
    // Started with $1,000.00: the level is $200.00.
    expect(bucketLevel(19_999, 100_000, 20)).toBe('low');
    expect(bucketLevel(1, 100_000, 20)).toBe('low');
  });

  it('10.1 exactly at the level is not low (strictly below, B57)', () => {
    expect(bucketLevel(20_000, 100_000, 20)).toBe('ok');
  });

  it('10.1 one cent below the level is low', () => {
    expect(bucketLevel(19_999, 100_000, 20)).toBe('low');
  });

  it('10.1 compares to the exact cent when the level is not a whole cent (B57)', () => {
    // Started with $899.99: the level is $179.998.
    expect(bucketLevel(18_000, 89_999, 20)).toBe('ok');
    expect(bucketLevel(17_999, 89_999, 20)).toBe('low');
  });

  it('10.1 a bucket that started at zero or below is never low', () => {
    expect(bucketLevel(1, 0, 20)).toBe('ok');
    expect(bucketLevel(500, -10_000, 20)).toBe('ok');
  });

  it('10.1 the percent is the setting, not a fixed 20', () => {
    expect(bucketLevel(29_999, 100_000, 30)).toBe('low');
    expect(bucketLevel(30_000, 100_000, 30)).toBe('ok');
    expect(bucketLevel(1, 100_000, 0)).toBe('ok');
    expect(bucketLevel(99_999, 100_000, 100)).toBe('low');
  });

  it('10.1 very large amounts stay exact', () => {
    // Times 100 this is past the largest exact whole number, so the
    // comparison must not be done in plain floating point.
    const startedWith = 900_719_925_474_095;
    const level = 180_143_985_094_819; // a fifth of it, exactly
    expect(bucketLevel(level, startedWith, 20)).toBe('ok');
    expect(bucketLevel(level - 1, startedWith, 20)).toBe('low');
  });
});

describe('10.2 empty bucket level', () => {
  it('10.2 zero is empty', () => {
    expect(bucketLevel(0, 100_000, 20)).toBe('empty');
  });

  it('10.2 below zero is empty, and empty wins over low (B58)', () => {
    expect(bucketLevel(-1, 100_000, 20)).toBe('empty');
    expect(bucketLevel(-50_000, 100_000, 20)).toBe('empty');
  });

  it('10.2 one cent is not empty', () => {
    expect(bucketLevel(1, 0, 20)).toBe('ok');
  });

  it('10.2 a bucket that started at zero or below and is still there is empty', () => {
    expect(bucketLevel(0, 0, 20)).toBe('empty');
    expect(bucketLevel(-100, -100, 20)).toBe('empty');
  });
});

describe('10.1 and 10.2 levels, for any amounts', () => {
  it('10.1 10.2 the level matches the rule worked out on its own', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_00, max: 1_000_000_00 }),
        fc.integer({ min: -1_000_000_00, max: 1_000_000_00 }),
        fc.integer({ min: 0, max: 100 }),
        (amount, startedWith, percent) => {
          const expected = amount <= 0 ? 'empty' : startedWith > 0 && amount * 100 < startedWith * percent ? 'low' : 'ok';
          expect(bucketLevel(amount, startedWith, percent)).toBe(expected);
        },
      ),
    );
  });

  it('10.1 refuses amounts that are not whole cents', () => {
    expect(() => bucketLevel(0.5, 100, 20)).toThrow();
    expect(() => bucketLevel(10, 100.5, 20)).toThrow();
    expect(() => bucketLevel(10, 100, 20.5)).toThrow();
  });
});
