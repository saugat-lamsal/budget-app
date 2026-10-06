import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, changeSettings, cardNotices, payoffCountdown, type CardStatement } from '../src/index.js';
import { codeOf, openTestBook, transfer } from './helpers.js';

const EVERYDAY: CardStatement = {
  card: 'everyday-card',
  closingDate: '2026-10-01',
  dueDate: '2026-10-26',
  statementBalance: 123_456,
  minimumPayment: 3_500,
};

const OLD: CardStatement = { ...EVERYDAY, card: 'old-card', statementBalance: 300_000, minimumPayment: 9_000 };

describe('9.1 everyday card reminders show the statement balance, the minimum, and the due date', () => {
  it('9.1 seven days before the due date', () => {
    expect(cardNotices('2026-10-19', EVERYDAY, [], DEFAULT_SETTINGS)).toEqual([
      { kind: 'reminder', card: 'everyday-card', daysBefore: 7, dueDate: '2026-10-26', statementBalance: 123_456, minimumPayment: 3_500 },
    ]);
  });

  it('9.1 two days before the due date', () => {
    expect(cardNotices('2026-10-24', EVERYDAY, [], DEFAULT_SETTINGS)).toEqual([
      { kind: 'reminder', card: 'everyday-card', daysBefore: 2, dueDate: '2026-10-26', statementBalance: 123_456, minimumPayment: 3_500 },
    ]);
  });

  it('9.1 no reminder on the other days', () => {
    for (const today of ['2026-10-18', '2026-10-20', '2026-10-23', '2026-10-25', '2026-10-26']) {
      expect(cardNotices(today, EVERYDAY, [], DEFAULT_SETTINGS), today).toEqual([]);
    }
  });

  it('9.1 the reminder days are a setting', () => {
    const settings = changeSettings(DEFAULT_SETTINGS, { cardReminderDaysBefore: [10, 0] });
    expect(cardNotices('2026-10-16', EVERYDAY, [], settings)).toMatchObject([{ kind: 'reminder', daysBefore: 10 }]);
    expect(cardNotices('2026-10-26', EVERYDAY, [], settings)).toMatchObject([{ kind: 'reminder', daysBefore: 0 }]);
    expect(cardNotices('2026-10-19', EVERYDAY, [], settings)).toEqual([]);
  });

  it('9.1 a one-cent statement still gets its reminder', () => {
    const tiny = { ...EVERYDAY, statementBalance: 1, minimumPayment: 1 };
    expect(cardNotices('2026-10-19', tiny, [], DEFAULT_SETTINGS)).toMatchObject([{ statementBalance: 1, minimumPayment: 1 }]);
  });

  it('9.1 a statement that makes no sense is refused', () => {
    expect(codeOf(() => cardNotices('2026-10-19', { ...EVERYDAY, dueDate: '2026-09-30' }, [], DEFAULT_SETTINGS))).toBe('bad-statement');
    expect(codeOf(() => cardNotices('2026-10-19', { ...EVERYDAY, minimumPayment: -1 }, [], DEFAULT_SETTINGS))).toBe('not-positive');
    expect(codeOf(() => cardNotices('2026-10-19', { ...EVERYDAY, statementBalance: 1.5 }, [], DEFAULT_SETTINGS))).toBe('not-cents');
    expect(codeOf(() => cardNotices('2026-02-30', EVERYDAY, [], DEFAULT_SETTINGS))).toBe('not-a-date');
  });
});

describe('9.2 old card reminders show the minimum and the due date', () => {
  it('9.2 no statement balance on the old card reminder', () => {
    expect(cardNotices('2026-10-19', OLD, [], DEFAULT_SETTINGS)).toEqual([
      { kind: 'reminder', card: 'old-card', daysBefore: 7, dueDate: '2026-10-26', minimumPayment: 9_000 },
    ]);
  });
});

describe('9.3 reminders stop once a payment covering the minimum is seen', () => {
  it('9.3 a payment of at least the minimum after the statement stops the reminders', () => {
    const paid = [{ date: '2026-10-10', amount: 3_500 }];
    expect(cardNotices('2026-10-19', EVERYDAY, paid, DEFAULT_SETTINGS)).toEqual([]);
    expect(cardNotices('2026-10-24', EVERYDAY, paid, DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.3 one cent short of the minimum does not stop them', () => {
    expect(cardNotices('2026-10-19', EVERYDAY, [{ date: '2026-10-10', amount: 3_499 }], DEFAULT_SETTINGS)).toHaveLength(1);
  });

  it('9.3 a payment on or before the statement date belongs to the last statement', () => {
    expect(cardNotices('2026-10-19', EVERYDAY, [{ date: '2026-10-01', amount: 999_999 }], DEFAULT_SETTINGS)).toHaveLength(1);
    expect(cardNotices('2026-10-19', EVERYDAY, [{ date: '2026-10-02', amount: 3_500 }], DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.3 a payment dated after today is not seen yet', () => {
    expect(cardNotices('2026-10-19', EVERYDAY, [{ date: '2026-10-20', amount: 3_500 }], DEFAULT_SETTINGS)).toHaveLength(1);
  });

  it('9.3 a statement with nothing due needs no payment, so it sends no reminder', () => {
    expect(cardNotices('2026-10-19', { ...EVERYDAY, statementBalance: 0, minimumPayment: 0 }, [], DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.3 the book lists the payments it has seen to each card', () => {
    const b = openTestBook({ oldCardDebt: 300_000 });
    b.receive(transfer('t1', '2026-10-05', 45_000, 'checking', 'everyday-card'));
    b.receive(transfer('t2', '2026-10-06', 9_000, 'checking', 'old-card'));
    b.receive(transfer('t3', '2026-10-07', 1_000, 'savings', 'everyday-card'));
    b.receive(transfer('t4', '2026-10-08', 2_000, 'checking', 'savings'));
    expect(b.cardPayments('everyday-card')).toEqual([
      { date: '2026-10-05', amount: 45_000 },
      { date: '2026-10-07', amount: 1_000 },
    ]);
    expect(b.cardPayments('old-card')).toEqual([{ date: '2026-10-06', amount: 9_000 }]);
    expect(cardNotices('2026-10-19', OLD, b.cardPayments('old-card'), DEFAULT_SETTINGS)).toEqual([]);
  });
});

describe('9.4 the due date passes with no payment seen: overdue alert', () => {
  it('9.4 the day after the due date with no payment, the alert shows', () => {
    expect(cardNotices('2026-10-27', EVERYDAY, [], DEFAULT_SETTINGS)).toEqual([
      { kind: 'overdue', card: 'everyday-card', dueDate: '2026-10-26', minimumPayment: 3_500 },
    ]);
  });

  it('9.4 not on the due date itself', () => {
    expect(cardNotices('2026-10-26', EVERYDAY, [], DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.4 any payment seen since the statement means it is not overdue', () => {
    expect(cardNotices('2026-10-27', EVERYDAY, [{ date: '2026-10-26', amount: 1 }], DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.4 it applies to the old card too', () => {
    expect(cardNotices('2026-11-15', OLD, [], DEFAULT_SETTINGS)).toEqual([{ kind: 'overdue', card: 'old-card', dueDate: '2026-10-26', minimumPayment: 9_000 }]);
  });

  it('9.4 a statement with nothing due is never overdue', () => {
    expect(cardNotices('2026-10-27', { ...EVERYDAY, statementBalance: 0, minimumPayment: 0 }, [], DEFAULT_SETTINGS)).toEqual([]);
  });
});

describe('9.5 old card payoff countdown', () => {
  it('9.5 stays off until the promo end date is entered', () => {
    const b = openTestBook({ oldCardDebt: 300_000 });
    expect(payoffCountdown(b, '2026-10-06')).toEqual({ on: false, reason: 'no-promo-end-date' });
  });

  it('9.5 with a promo end date it waits on the open questions (QUESTIONS.md A7)', () => {
    const b = openTestBook({ oldCardDebt: 300_000, settings: { oldCardPromoEndDate: '2027-06-30' } });
    expect(payoffCountdown(b, '2026-10-06')).toEqual({ on: false, reason: 'waiting-on-rule' });
  });
});
