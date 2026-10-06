// Second opinion, rulebook section 0 (ground rules), section 2 (settings
// and starting values) and section 14 (setup day).

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MoneyError,
  changeSettings,
  parseDollars,
  splitPaycheck,
  startTracking,
  startingMoney,
  type Purchase,
} from '../src/index.js';
import { Life, SETTINGS, START_BANK, START_POTS } from './helpers.js';

describe('0.1 all amounts are whole cents', () => {
  it('0.1 a fraction of a cent is refused and changes nothing', () => {
    const life = new Life();
    const before = life.book.pots();
    expect(() =>
      life.book.receive({ kind: 'purchase', id: 'x', account: 'everyday-card', date: '2026-01-06', amount: 12.5, description: 'X', pending: false }),
    ).toThrow(MoneyError);
    expect(life.book.pots()).toEqual(before);
  });

  it('0.1 dollars text becomes whole cents', () => {
    expect(parseDollars('12.34')).toBe(1234);
  });

  it('0.1 a paycheck split never produces fractions', () => {
    const s = splitPaycheck(160003, 0, SETTINGS);
    for (const v of [s.momReserve, s.savings, s.needs, s.wants]) expect(Number.isInteger(v)).toBe(true);
  });
});

describe('0.2 / section 2 every number is a setting, starting at the section 2 values', () => {
  it('2 starting values', () => {
    const s = DEFAULT_SETTINGS;
    expect(s.split).toEqual({ savings: 50, needs: 30, wants: 20 });
    expect(s.momReservePerPaycheck).toBe(150000);
    expect(s.momReserveCap).toBe(300000);
    expect(s.momMonthlyTarget).toEqual({ low: 200000, high: 300000 });
    expect(s.lowBucketAlertPercent).toBe(20);
    expect([...s.cardReminderDaysBefore].sort((a, b) => b - a)).toEqual([7, 2]);
    expect(s.dailyReviewTime).toMatch(/^20:00/);
    expect(s.leftoverAtPayday).toEqual({ needs: 'ask', wants: 'ask' });
    expect(s.oldCardPromoEndDate).toBeNull();
    expect(s.payScheduleDays).toBe(14);
    expect(s.earlyPaycheckDays).toBe(10); // 3.7
  });

  it('2 the split must add up to 100', () => {
    expect(() => changeSettings(DEFAULT_SETTINGS, { split: { savings: 50, needs: 30, wants: 19 } })).toThrow(MoneyError);
  });

  it('0.2 the pay schedule is a setting', () => {
    // 7-day schedule: last paycheck Jan 2 -> next payday Jan 9
    const life = new Life({ settings: { payScheduleDays: 7 } });
    expect(life.book.safeToSpend('2026-01-05')).toMatchObject({ nextPayday: '2026-01-09', daysToPayday: 4 });
  });

  it('0.2 the early-paycheck window is a setting', () => {
    // window 5 days: a paycheck 6 days after the last one splits normally
    const life = new Life({ settings: { earlyPaycheckDays: 5 } });
    expect(life.paycheck(200000, '2026-01-08').outcome).toBe('paycheck');
  });

  it('0.2 the reserve cap is a setting', () => {
    // cap 1,000.00, reserve 0: 1,000 to reserve, 500 overflow to savings
    const s = splitPaycheck(200000, 0, { ...SETTINGS, momReserveCap: 100000 });
    expect(s).toMatchObject({ momReserve: 100000, savings: 50000 + 25000, needs: 15000, wants: 10000 });
  });
});

describe('0.3 changing a setting never rewrites a past pay period', () => {
  it('0.3 past paycheck split stays as it was', () => {
    const life = new Life();
    life.paycheck(200000, '2026-01-16');
    const before = life.book.paychecks()[0]!.split;
    const potsBefore = life.book.pots();
    life.book.changeSettings({ split: { savings: 10, needs: 45, wants: 45 }, momReservePerPaycheck: 0 }, '2026-01-20');
    expect(life.book.paychecks()[0]!.split).toEqual(before);
    expect(life.book.pots()).toEqual(potsBefore);
  });
});

describe('0.4 the app is read-only toward the bank', () => {
  it('0.4 moving money between buckets is bookkeeping only: the bank need not change', () => {
    const life = new Life();
    life.book.moveMoney({ from: 'needs', to: 'wants', amount: 25000 }, '2026-01-07');
    life.book.moveMoney({ from: 'savings', to: 'needs', amount: 1000, confirmed: true }, '2026-01-07');
    // same bank balances as before, still balanced
    life.expectBalanced();
  });
});

describe('0.5 if totals do not match the bank, say so instead of showing a number', () => {
  it('0.5 mismatch: no safe-to-spend amount, the difference instead', () => {
    const life = new Life();
    const r = life.book.checkedSafeToSpend('2026-01-05', { ...life.bank(), checking: life.bank().checking - 1 });
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty('safeToSpend');
    expect(r.ok === false && Math.abs(r.difference)).toBe(1);
  });

  it('0.5 match: the number is shown', () => {
    const life = new Life();
    const r = life.book.checkedSafeToSpend('2026-01-05', life.bank());
    expect(r).toMatchObject({ ok: true, safeToSpend: { amount: 50000, nextPayday: '2026-01-16', daysToPayday: 11 } });
  });
});

const pendingAtSetup: Purchase = {
  kind: 'purchase',
  id: 'p-setup',
  account: 'everyday-card',
  date: '2026-01-04',
  amount: 2000,
  description: 'CITY GROCER',
  pending: true,
};

describe('14.1 setup reads the current balances', () => {
  it('14.1 starting money = checking + savings - everyday card', () => {
    // 3,000 + 4,000 - 500 = 6,500.00
    expect(startingMoney(START_BANK, [])).toBe(650000);
  });

  it('14.1 pending charges count in the starting money (12.1)', () => {
    // card 500 + pending 20 = 520 -> 3,000 + 4,000 - 520 = 6,480.00
    expect(startingMoney(START_BANK, [pendingAtSetup])).toBe(648000);
  });
});

describe('14.2 the starting money is assigned across the pots', () => {
  it('14.2 assignment that adds up starts tracking with those pots', () => {
    const r = startTracking({
      date: '2026-01-05',
      bankBalances: START_BANK,
      pendingCharges: [],
      oldCardBalance: 300000,
      assignment: { savings: 400000, needs: 120000, wants: 80000, momReserve: 30000, heldForOthers: 20000 },
      lastPaycheckDate: '2026-01-02',
      settings: SETTINGS,
    });
    // 4,000 + 1,200 + 800 + 300 + 200 = 6,500.00
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.startingMoney).toBe(650000);
    expect(r.book.pots()).toMatchObject({ savings: 400000, needs: 120000, wants: 80000, momReserve: 30000, heldForOthers: 20000 });
    expect(r.book.oldCardDebt()).toBe(300000);
  });

  it('14.2 a pending charge at setup is not taken from a bucket again when it posts (4.6)', () => {
    const r = startTracking({
      date: '2026-01-05',
      bankBalances: START_BANK,
      pendingCharges: [pendingAtSetup],
      oldCardBalance: 300000,
      assignment: { ...START_POTS, needs: 98000 }, // 6,480.00
      lastPaycheckDate: '2026-01-02',
      settings: SETTINGS,
      rules: [{ id: 'g', for: 'purchase', contains: 'GROCER', bucket: 'needs' }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r.book.receive({ ...pendingAtSetup, id: 'p-setup-posted', pending: false, pendingId: 'p-setup', date: '2026-01-06' });
    expect(r.book.pots().needs).toBe(98000);
    // posted: card 520.00 -> 3,000 + 4,000 - 520 = 6,480.00
    expect(r.book.selfCheck({ ...START_BANK, everydayCard: 52000 }).ok).toBe(true);
  });
});

describe('14.3 the self-check must pass before tracking starts', () => {
  it('14.3 one cent unassigned: tracking does not start', () => {
    const r = startTracking({
      date: '2026-01-05',
      bankBalances: START_BANK,
      pendingCharges: [],
      oldCardBalance: 300000,
      assignment: { ...START_POTS, wants: 49999 },
      lastPaycheckDate: '2026-01-02',
      settings: SETTINGS,
    });
    expect(r.ok).toBe(false);
    expect(r).not.toHaveProperty('book');
    if (r.ok) return;
    expect(r.startingMoney).toBe(650000);
    expect(r.assigned).toBe(649999);
    expect(Math.abs(r.difference)).toBe(1);
  });

  it('14.3 one cent over-assigned: tracking does not start', () => {
    const r = startTracking({
      date: '2026-01-05',
      bankBalances: START_BANK,
      pendingCharges: [],
      oldCardBalance: 300000,
      assignment: { ...START_POTS, savings: 500001 },
      lastPaycheckDate: '2026-01-02',
      settings: SETTINGS,
    });
    expect(r.ok).toBe(false);
  });
});
