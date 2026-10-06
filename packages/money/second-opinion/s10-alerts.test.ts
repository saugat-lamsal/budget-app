// Second opinion, rulebook section 10 (alerts).
//
// Each alert test starts a pay period with a paycheck so "what the bucket
// started the pay period with" is known:
//   before payday: needs 100.00, wants 50.00, savings 5,000.00
//   bank: pots total 5,150.00 -> checking 1,650.00 + savings 4,000 - card 500
//   paycheck Jan 16 2,000.00: reserve 1,500; rest 500 -> savings 250, needs 150, wants 100
//   period starts: needs 250.00, wants 150.00 (includes the roll-over)
//   low level: needs 20% of 250.00 = 50.00; wants 20% of 150.00 = 30.00

import { describe, expect, it } from 'vitest';
import { type Alert, type SortingRule } from '../src/index.js';
import { Life } from './helpers.js';

const RULES: SortingRule[] = [
  { id: 'r-grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
  { id: 'r-cinema', for: 'purchase', contains: 'CINEMA', bucket: 'wants' },
];

function startPeriod(pots: { needs?: number; wants?: number } = {}) {
  const needs = pots.needs ?? 10000;
  const wants = pots.wants ?? 5000;
  const checking = 300000 - (100000 - needs) - (50000 - wants);
  const life = new Life({ rules: RULES, pots: { needs, wants }, bank: { checking } });
  life.paycheck(200000, '2026-01-16');
  return life;
}

function alerts(life: Life, kind: Alert['kind'], bankConnection: 'ok' | 'needs-login' = 'ok') {
  return life.book.takeAlerts({ bankConnection, bankBalances: life.bank() }).filter((a) => a.kind === kind);
}

describe('10.1 low bucket alert below 20% of what the bucket started with', () => {
  it('10.1 the period started with the rolled-over amount included', () => {
    const life = startPeriod();
    expect(life.book.startedPeriodWith()).toEqual({ needs: 25000, wants: 15000 });
  });

  it('10.1 exactly at the level: no alert; one cent below: one alert; then no more', () => {
    const life = startPeriod();
    // 250.00 - 200.00 = 50.00 = the level, not below
    life.buy(20000, '2026-01-17', 'CITY GROCER');
    expect(alerts(life, 'low-bucket')).toEqual([]);
    // 50.00 - 0.01 = 49.99 < 50.00
    life.buy(1, '2026-01-17', 'CITY GROCER');
    expect(alerts(life, 'low-bucket')).toEqual([{ kind: 'low-bucket', bucket: 'needs', amount: 4999, startedWith: 25000 }]);
    // 49.99 - 10.00 = 39.99: still low, but once per pay period
    life.buy(1000, '2026-01-18', 'CITY GROCER');
    expect(alerts(life, 'low-bucket')).toEqual([]);
  });

  it('10.1 wants has its own alert', () => {
    // wants 150.00 - 120.01 = 29.99 < 30.00
    const life = startPeriod();
    life.buy(12001, '2026-01-17', 'CINEMA 8');
    expect(alerts(life, 'low-bucket')).toEqual([{ kind: 'low-bucket', bucket: 'wants', amount: 2999, startedWith: 15000 }]);
  });

  it('10.1 a new pay period can alert again', () => {
    const life = startPeriod();
    life.buy(20001, '2026-01-17', 'CITY GROCER'); // needs 49.99
    expect(alerts(life, 'low-bucket')).toHaveLength(1);
    // Jan 30 paycheck: needs 49.99 + 150.00 = 199.99 -> level 20% = about 40.00
    life.paycheck(200000, '2026-01-30');
    expect(life.book.startedPeriodWith().needs).toBe(19999);
    // 199.99 - 162.99 = 37.00, well below the level whichever way it rounds
    life.buy(16299, '2026-01-31', 'CITY GROCER');
    expect(alerts(life, 'low-bucket')).toEqual([{ kind: 'low-bucket', bucket: 'needs', amount: 3700, startedWith: 19999 }]);
  });

  it('10.1 a bucket that starts the period below zero gets no low alert', () => {
    // needs -200.00 + 150.00 = -50.00 at the start of the period
    const life = startPeriod({ needs: -20000 });
    expect(life.book.startedPeriodWith().needs).toBe(-5000);
    life.buy(1000, '2026-01-17', 'CITY GROCER');
    expect(alerts(life, 'low-bucket')).toEqual([]);
  });

  it('10.1 a bucket that starts the period at exactly zero gets no low alert', () => {
    // needs -150.00 + 150.00 = 0
    const life = startPeriod({ needs: -15000 });
    expect(life.book.startedPeriodWith().needs).toBe(0);
    life.buy(1000, '2026-01-17', 'CITY GROCER');
    expect(alerts(life, 'low-bucket')).toEqual([]);
  });
});

describe('10.2 empty bucket alert at zero or below, once per period', () => {
  it('10.2 one cent above zero: no empty alert', () => {
    const life = startPeriod();
    life.buy(24999, '2026-01-17', 'CITY GROCER'); // needs 0.01
    expect(alerts(life, 'empty-bucket')).toEqual([]);
  });

  it('10.2 exactly zero: empty alert', () => {
    const life = startPeriod();
    life.buy(25000, '2026-01-17', 'CITY GROCER'); // needs 0
    expect(alerts(life, 'empty-bucket')).toEqual([{ kind: 'empty-bucket', bucket: 'needs', amount: 0 }]);
  });

  it('10.2 below zero, then again below zero: one alert per period', () => {
    const life = startPeriod();
    life.buy(26000, '2026-01-17', 'CITY GROCER'); // needs -10.00
    expect(alerts(life, 'empty-bucket')).toEqual([{ kind: 'empty-bucket', bucket: 'needs', amount: -1000 }]);
    life.buy(500, '2026-01-18', 'CITY GROCER');
    expect(alerts(life, 'empty-bucket')).toEqual([]);
  });

  it('10.2 refunded back above zero and emptied again in the same period: still once', () => {
    const life = startPeriod();
    const p = life.buy(25000, '2026-01-17', 'CITY GROCER'); // 0
    expect(alerts(life, 'empty-bucket')).toHaveLength(1);
    life.refund(5000, '2026-01-18', 'CITY GROCER REFUND', p.id); // 50.00
    alerts(life, 'empty-bucket');
    life.buy(5000, '2026-01-19', 'CITY GROCER'); // 0 again
    expect(alerts(life, 'empty-bucket')).toEqual([]);
  });

  it('10.2 next pay period can alert again', () => {
    const life = startPeriod();
    life.buy(25000, '2026-01-17', 'CITY GROCER'); // 0
    expect(alerts(life, 'empty-bucket')).toHaveLength(1);
    life.paycheck(200000, '2026-01-30'); // needs 150.00
    life.buy(15000, '2026-01-31', 'CITY GROCER'); // 0
    expect(alerts(life, 'empty-bucket')).toEqual([{ kind: 'empty-bucket', bucket: 'needs', amount: 0 }]);
  });
});

describe('10.3 daily review only if something is unsorted', () => {
  it('10.3 nothing unsorted: no daily review', () => {
    const life = startPeriod();
    expect(alerts(life, 'daily-review')).toEqual([]);
  });

  it('10.3 one unsorted item: daily review at the review time', () => {
    const life = startPeriod();
    life.buy(1500, '2026-01-17', 'MYSTERY SHOP');
    const got = alerts(life, 'daily-review');
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ kind: 'daily-review', at: life.book.settings().dailyReviewTime, waiting: 1 });
  });
});

describe('10.4 totals do not match the bank', () => {
  it('10.4 one cent off: mismatch alert with the difference', () => {
    const life = startPeriod();
    const bank = life.bank();
    const got = life.book
      .takeAlerts({ bankConnection: 'ok', bankBalances: { ...bank, checking: bank.checking + 1 } })
      .filter((a) => a.kind === 'totals-mismatch');
    expect(got).toHaveLength(1);
    expect(Math.abs((got[0] as { difference: number }).difference)).toBe(1);
  });

  it('10.4 matching: no mismatch alert', () => {
    const life = startPeriod();
    expect(alerts(life, 'totals-mismatch')).toEqual([]);
  });
});

describe('10.5 bank connection needs login again', () => {
  it('10.5 needs-login gives a bank-login alert', () => {
    const life = startPeriod();
    expect(alerts(life, 'bank-login', 'needs-login')).toEqual([{ kind: 'bank-login' }]);
  });

  it('10.5 ok connection: no bank-login alert', () => {
    const life = startPeriod();
    expect(alerts(life, 'bank-login')).toEqual([]);
  });
});
