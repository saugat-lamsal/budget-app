// Second opinion, rulebook section 9 (credit card reminders).
// Reminder days from section 2: 7 and 2 days before the due date.
// Statement closes Mar 5, due Mar 30. Due - 7 = Mar 23, due - 2 = Mar 28.

import { describe, expect, it } from 'vitest';
import { cardNotices, payoffCountdown, type CardStatement } from '../src/index.js';
import { Life, SETTINGS } from './helpers.js';

const EVERYDAY: CardStatement = {
  card: 'everyday-card',
  closingDate: '2026-03-05',
  dueDate: '2026-03-30',
  statementBalance: 81245, // 812.45
  minimumPayment: 3500, // 35.00
};

const OLD: CardStatement = {
  card: 'old-card',
  closingDate: '2026-03-05',
  dueDate: '2026-03-30',
  statementBalance: 295000, // 2,950.00
  minimumPayment: 4000, // 40.00
};

const pay = (date: string, amount: number) => ({ date, amount });

describe('9.1 everyday card reminders show statement balance, minimum, due date', () => {
  it('9.1 7 days before', () => {
    expect(cardNotices('2026-03-23', EVERYDAY, [], SETTINGS)).toEqual([
      { kind: 'reminder', card: 'everyday-card', daysBefore: 7, dueDate: '2026-03-30', statementBalance: 81245, minimumPayment: 3500 },
    ]);
  });

  it('9.1 2 days before', () => {
    expect(cardNotices('2026-03-28', EVERYDAY, [], SETTINGS)).toEqual([
      { kind: 'reminder', card: 'everyday-card', daysBefore: 2, dueDate: '2026-03-30', statementBalance: 81245, minimumPayment: 3500 },
    ]);
  });

  it('9.1 not on other days', () => {
    expect(cardNotices('2026-03-25', EVERYDAY, [], SETTINGS)).toEqual([]);
  });
});

describe('9.2 old card reminders show the minimum and the due date', () => {
  it('9.2 7 days before, no statement balance', () => {
    expect(cardNotices('2026-03-23', OLD, [], SETTINGS)).toEqual([
      { kind: 'reminder', card: 'old-card', daysBefore: 7, dueDate: '2026-03-30', minimumPayment: 4000 },
    ]);
  });
});

describe('9.3 when reminders stop', () => {
  it('9.3 everyday: paying the minimum does not stop reminders', () => {
    expect(cardNotices('2026-03-28', EVERYDAY, [pay('2026-03-10', 3500)], SETTINGS)).toHaveLength(1);
  });

  it('9.3 everyday: one cent short of the statement balance still reminds', () => {
    // 812.44 < 812.45
    expect(cardNotices('2026-03-28', EVERYDAY, [pay('2026-03-10', 81244)], SETTINGS)).toHaveLength(1);
  });

  it('9.3 everyday: payments adding up to the full balance stop reminders', () => {
    // 400.00 + 412.45 = 812.45
    expect(cardNotices('2026-03-28', EVERYDAY, [pay('2026-03-10', 40000), pay('2026-03-20', 41245)], SETTINGS)).toEqual([]);
  });

  it('9.3 everyday: a payment before the statement does not count', () => {
    expect(cardNotices('2026-03-28', EVERYDAY, [pay('2026-03-01', 81245)], SETTINGS)).toHaveLength(1);
  });

  it('9.3 old card: one cent short of the minimum still reminds', () => {
    expect(cardNotices('2026-03-28', OLD, [pay('2026-03-10', 3999)], SETTINGS)).toHaveLength(1);
  });

  it('9.3 old card: exactly the minimum stops reminders', () => {
    expect(cardNotices('2026-03-28', OLD, [pay('2026-03-10', 4000)], SETTINGS)).toEqual([]);
  });

  it('9.3 old card: two payments adding to the minimum stop reminders', () => {
    // 15.00 + 25.00 = 40.00
    expect(cardNotices('2026-03-28', OLD, [pay('2026-03-08', 1500), pay('2026-03-12', 2500)], SETTINGS)).toEqual([]);
  });
});

describe('9.4 overdue alert when the due date passes with less than the minimum paid', () => {
  for (const statement of [EVERYDAY, OLD]) {
    const card = statement.card;
    const min = statement.minimumPayment;

    it(`9.4 ${card}: nothing paid, day after due -> overdue`, () => {
      expect(cardNotices('2026-03-31', statement, [], SETTINGS)).toEqual([
        { kind: 'overdue', card, dueDate: '2026-03-30', minimumPayment: min },
      ]);
    });

    it(`9.4 ${card}: one cent short of minimum -> overdue`, () => {
      expect(cardNotices('2026-03-31', statement, [pay('2026-03-10', min - 1)], SETTINGS)).toHaveLength(1);
    });

    it(`9.4 ${card}: exactly the minimum -> no overdue`, () => {
      expect(cardNotices('2026-03-31', statement, [pay('2026-03-10', min)], SETTINGS)).toEqual([]);
    });

    it(`9.4 ${card}: on the due date itself -> not overdue yet`, () => {
      expect(cardNotices('2026-03-30', statement, [], SETTINGS).filter((n) => n.kind === 'overdue')).toEqual([]);
    });
  }
});

describe('9.5 old card payoff countdown', () => {
  it('9.5 off when no promo end date is entered', () => {
    const life = new Life({ settings: { oldCardPromoEndDate: null } });
    expect(payoffCountdown(life.book, '2026-01-05')).toEqual({ on: false, reason: 'no-promo-end-date' });
  });

  it('9.5 on once the promo end date is entered', () => {
    // Rulebook: balance / paychecks left before the promo ends. With a date
    // entered the countdown should be on.
    const life = new Life({ settings: { oldCardPromoEndDate: '2026-12-31' } });
    const result: { on: boolean } = payoffCountdown(life.book, '2026-01-05');
    expect(result.on).toBe(true);
  });
});
