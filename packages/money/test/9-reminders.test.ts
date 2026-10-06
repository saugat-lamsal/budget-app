import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, changeSettings, cardNotices, payoffCountdown, type CardStatement, type Cents, type IsoDate, type Settings } from '../src/index.js';
import { arrived, cardCharge, codeOf, openTestBook, purchase, sent, transfer } from './helpers.js';

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

describe('9.3 everyday card: reminders continue until the full statement balance is paid', () => {
  it('9.3 paying only the minimum does not stop them', () => {
    expect(cardNotices('2026-10-19', EVERYDAY, [{ date: '2026-10-10', amount: 3_500 }], DEFAULT_SETTINGS)).toHaveLength(1);
  });

  it('9.3 paying the full statement balance stops them', () => {
    const paid = [{ date: '2026-10-10', amount: 123_456 }];
    expect(cardNotices('2026-10-19', EVERYDAY, paid, DEFAULT_SETTINGS)).toEqual([]);
    expect(cardNotices('2026-10-24', EVERYDAY, paid, DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.3 one cent short of the full balance does not stop them', () => {
    expect(cardNotices('2026-10-19', EVERYDAY, [{ date: '2026-10-10', amount: 123_455 }], DEFAULT_SETTINGS)).toHaveLength(1);
  });

  it('9.3 payments since the statement add up toward the full balance', () => {
    const inTwo = [
      { date: '2026-10-05', amount: 100_000 },
      { date: '2026-10-15', amount: 23_456 },
    ];
    expect(cardNotices('2026-10-19', EVERYDAY, inTwo, DEFAULT_SETTINGS)).toEqual([]);
    const short = [
      { date: '2026-10-05', amount: 100_000 },
      { date: '2026-10-15', amount: 23_455 },
    ];
    expect(cardNotices('2026-10-19', EVERYDAY, short, DEFAULT_SETTINGS)).toHaveLength(1);
  });

  it('9.3 a balance with no minimum still reminds until it is paid', () => {
    expect(cardNotices('2026-10-19', { ...EVERYDAY, statementBalance: 5_000, minimumPayment: 0 }, [], DEFAULT_SETTINGS)).toHaveLength(1);
  });

  it('9.3 a statement with nothing to pay, or a credit, sends no reminder', () => {
    expect(cardNotices('2026-10-19', { ...EVERYDAY, statementBalance: 0, minimumPayment: 0 }, [], DEFAULT_SETTINGS)).toEqual([]);
    expect(cardNotices('2026-10-19', { ...EVERYDAY, statementBalance: -500, minimumPayment: 0 }, [], DEFAULT_SETTINGS)).toEqual([]);
  });
});

describe('9.3 old card: reminders stop once payments since the statement add up to the minimum', () => {
  it('9.3 a payment of at least the minimum after the statement stops them', () => {
    const paid = [{ date: '2026-10-10', amount: 9_000 }];
    expect(cardNotices('2026-10-19', OLD, paid, DEFAULT_SETTINGS)).toEqual([]);
    expect(cardNotices('2026-10-24', OLD, paid, DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.3 one cent short of the minimum does not stop them', () => {
    expect(cardNotices('2026-10-19', OLD, [{ date: '2026-10-10', amount: 8_999 }], DEFAULT_SETTINGS)).toHaveLength(1);
  });

  it('9.3 two smaller payments that add up to the minimum stop them (A6)', () => {
    const inTwo = [
      { date: '2026-10-05', amount: 4_500 },
      { date: '2026-10-15', amount: 4_500 },
    ];
    expect(cardNotices('2026-10-19', OLD, inTwo, DEFAULT_SETTINGS)).toEqual([]);
    expect(cardNotices('2026-10-24', OLD, inTwo, DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.3 smaller payments one cent short of the minimum do not stop them', () => {
    const short = [
      { date: '2026-10-05', amount: 4_500 },
      { date: '2026-10-15', amount: 4_499 },
    ];
    expect(cardNotices('2026-10-19', OLD, short, DEFAULT_SETTINGS)).toEqual([{ kind: 'reminder', card: 'old-card', daysBefore: 7, dueDate: '2026-10-26', minimumPayment: 9_000 }]);
  });

  it('9.3 they stop from the day the payments reach the minimum, not before', () => {
    const inTwo = [
      { date: '2026-10-05', amount: 4_500 },
      { date: '2026-10-20', amount: 4_500 },
    ];
    expect(cardNotices('2026-10-19', OLD, inTwo, DEFAULT_SETTINGS)).toHaveLength(1);
    expect(cardNotices('2026-10-24', OLD, inTwo, DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.3 a payment before the statement date does not count toward the minimum', () => {
    const mixed = [
      { date: '2026-09-28', amount: 4_500 },
      { date: '2026-10-15', amount: 4_500 },
    ];
    expect(cardNotices('2026-10-19', OLD, mixed, DEFAULT_SETTINGS)).toHaveLength(1);
  });

  it('9.3 a statement with no minimum sends no reminder', () => {
    expect(cardNotices('2026-10-19', { ...OLD, minimumPayment: 0 }, [], DEFAULT_SETTINGS)).toEqual([]);
  });
});

describe('9.3 which payments count, for either card', () => {
  it('9.3 a payment on or before the statement date belongs to the last statement', () => {
    expect(cardNotices('2026-10-19', EVERYDAY, [{ date: '2026-10-01', amount: 999_999 }], DEFAULT_SETTINGS)).toHaveLength(1);
    expect(cardNotices('2026-10-19', EVERYDAY, [{ date: '2026-10-02', amount: 123_456 }], DEFAULT_SETTINGS)).toEqual([]);
    expect(cardNotices('2026-10-19', OLD, [{ date: '2026-10-01', amount: 999_999 }], DEFAULT_SETTINGS)).toHaveLength(1);
  });

  it('9.3 a payment dated after today is not seen yet', () => {
    expect(cardNotices('2026-10-19', EVERYDAY, [{ date: '2026-10-20', amount: 123_456 }], DEFAULT_SETTINGS)).toHaveLength(1);
    expect(cardNotices('2026-10-19', OLD, [{ date: '2026-10-20', amount: 9_000 }], DEFAULT_SETTINGS)).toHaveLength(1);
  });

  it('9.3 the book lists the payments it has seen to each card', () => {
    const b = openTestBook({ oldCardDebt: 300_000 });
    b.receive(transfer('t1', '2026-10-05', 45_000, 'checking', 'everyday-card'));
    b.receive(transfer('t2', '2026-10-06', 9_000, 'checking', 'old-card'));
    b.receive(transfer('t3', '2026-10-07', 1_000, 'savings', 'everyday-card'));
    b.receive(transfer('t4', '2026-10-08', 2_000, 'checking', 'savings'));
    expect(b.cardPayments('everyday-card')).toEqual([
      { date: '2026-10-05', amount: 45_000, landedOn: '2026-10-05' },
      { date: '2026-10-07', amount: 1_000, landedOn: '2026-10-07' },
    ]);
    expect(b.cardPayments('old-card')).toEqual([{ date: '2026-10-06', amount: 9_000, landedOn: '2026-10-06' }]);
    expect(cardNotices('2026-10-19', OLD, b.cardPayments('old-card'), DEFAULT_SETTINGS)).toEqual([]);
  });
});

describe('9.4 the due date passes and payments since the statement add up to less than the minimum: overdue alert', () => {
  it('9.4 the day after the due date with no payment, the alert shows', () => {
    expect(cardNotices('2026-10-27', EVERYDAY, [], DEFAULT_SETTINGS)).toEqual([
      { kind: 'overdue', card: 'everyday-card', dueDate: '2026-10-26', minimumPayment: 3_500 },
    ]);
  });

  it('9.4 not on the due date itself', () => {
    expect(cardNotices('2026-10-26', EVERYDAY, [], DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.4 everyday card: payments since the statement that add up to less than the minimum leave it overdue (A6)', () => {
    const overdue = [{ kind: 'overdue', card: 'everyday-card', dueDate: '2026-10-26', minimumPayment: 3_500 }];
    expect(cardNotices('2026-10-27', EVERYDAY, [{ date: '2026-10-26', amount: 1 }], DEFAULT_SETTINGS)).toEqual(overdue);
    const short = [
      { date: '2026-10-05', amount: 1_750 },
      { date: '2026-10-15', amount: 1_749 },
    ];
    expect(cardNotices('2026-10-27', EVERYDAY, short, DEFAULT_SETTINGS)).toEqual(overdue);
  });

  it('9.4 it applies to the old card too', () => {
    expect(cardNotices('2026-11-15', OLD, [], DEFAULT_SETTINGS)).toEqual([{ kind: 'overdue', card: 'old-card', dueDate: '2026-10-26', minimumPayment: 9_000 }]);
  });

  it('9.4 old card: payments since the statement that add up to less than the minimum leave it overdue (A6)', () => {
    const overdue = [{ kind: 'overdue', card: 'old-card', dueDate: '2026-10-26', minimumPayment: 9_000 }];
    expect(cardNotices('2026-10-27', OLD, [{ date: '2026-10-10', amount: 1 }], DEFAULT_SETTINGS)).toEqual(overdue);
    const short = [
      { date: '2026-10-05', amount: 4_500 },
      { date: '2026-10-15', amount: 4_499 },
    ];
    expect(cardNotices('2026-10-27', OLD, short, DEFAULT_SETTINGS)).toEqual(overdue);
  });

  it('9.4 old card: payments that add up to the minimum mean it is not overdue', () => {
    const inTwo = [
      { date: '2026-10-05', amount: 4_500 },
      { date: '2026-10-15', amount: 4_500 },
    ];
    expect(cardNotices('2026-10-27', OLD, inTwo, DEFAULT_SETTINGS)).toEqual([]);
    expect(cardNotices('2026-10-27', OLD, [{ date: '2026-10-26', amount: 9_001 }], DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.4 old card: a payment after the due date that brings the total to the minimum ends the overdue alert', () => {
    const late = [
      { date: '2026-10-10', amount: 5_000 },
      { date: '2026-10-28', amount: 4_000 },
    ];
    expect(cardNotices('2026-10-27', OLD, late, DEFAULT_SETTINGS)).toHaveLength(1);
    expect(cardNotices('2026-10-28', OLD, late, DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.4 old card: the book\'s list of payments, added up, is what counts', () => {
    const b = openTestBook({ oldCardDebt: 300_000 });
    b.receive(transfer('t1', '2026-10-05', 4_500, 'checking', 'old-card'));
    expect(cardNotices('2026-10-27', OLD, b.cardPayments('old-card'), DEFAULT_SETTINGS)).toHaveLength(1);
    b.receive(sent('s2', '2026-10-20', 4_500, 'checking', 'old-card'));
    expect(cardNotices('2026-10-27', OLD, b.cardPayments('old-card'), DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.4 a statement with nothing due is never overdue', () => {
    expect(cardNotices('2026-10-27', { ...EVERYDAY, statementBalance: 0, minimumPayment: 0 }, [], DEFAULT_SETTINGS)).toEqual([]);
    expect(cardNotices('2026-10-27', { ...EVERYDAY, statementBalance: 5_000, minimumPayment: 0 }, [], DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.4 a minimum due with no payment is overdue, even when the statement shows nothing owed', () => {
    expect(cardNotices('2026-10-19', { ...EVERYDAY, statementBalance: 0, minimumPayment: 3_500 }, [], DEFAULT_SETTINGS)).toEqual([]);
    expect(cardNotices('2026-10-27', { ...EVERYDAY, statementBalance: 0, minimumPayment: 3_500 }, [], DEFAULT_SETTINGS)).toEqual([
      { kind: 'overdue', card: 'everyday-card', dueDate: '2026-10-26', minimumPayment: 3_500 },
    ]);
  });

  it('9.4 on the everyday card, a payment of just the minimum means it is not overdue', () => {
    expect(cardNotices('2026-10-27', EVERYDAY, [{ date: '2026-10-20', amount: 3_500 }], DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.4 everyday card: payments that add up to the minimum mean it is not overdue (A6)', () => {
    const inTwo = [
      { date: '2026-10-05', amount: 1_750 },
      { date: '2026-10-15', amount: 1_750 },
    ];
    expect(cardNotices('2026-10-27', EVERYDAY, inTwo, DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.4 everyday card: a payment after the due date that brings the total to the minimum ends the overdue alert (A6)', () => {
    const late = [
      { date: '2026-10-10', amount: 2_000 },
      { date: '2026-10-28', amount: 1_500 },
    ];
    expect(cardNotices('2026-10-27', EVERYDAY, late, DEFAULT_SETTINGS)).toHaveLength(1);
    expect(cardNotices('2026-10-28', EVERYDAY, late, DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.4 everyday card: the book\'s list of payments, added up, is what counts (A6)', () => {
    const b = openTestBook();
    b.receive(transfer('t1', '2026-10-05', 1_750, 'checking', 'everyday-card'));
    expect(cardNotices('2026-10-27', EVERYDAY, b.cardPayments('everyday-card'), DEFAULT_SETTINGS)).toHaveLength(1);
    b.receive(sent('s2', '2026-10-20', 1_750, 'savings', 'everyday-card'));
    expect(cardNotices('2026-10-27', EVERYDAY, b.cardPayments('everyday-card'), DEFAULT_SETTINGS)).toEqual([]);
  });
});

describe('9.5 old card payoff countdown', () => {
  it('9.5 stays off until the promo end date is entered', () => {
    const b = openTestBook({ oldCardDebt: 300_000 });
    expect(payoffCountdown(b, '2026-10-06')).toEqual({ on: false, reason: 'no-promo-end-date' });
  });

  // Paydays come from the pay schedule: the last paycheck, Sep 25, plus 14
  // days at a time: Oct 9, Oct 23, Nov 6, Nov 20, Dec 4, Dec 18, Jan 1,
  // Jan 15, and so on.
  const withPromo = (end: IsoDate, owed: Cents = 300_000, settings: Partial<Settings> = {}) =>
    openTestBook({ oldCardDebt: owed, settings: { oldCardPromoEndDate: end, ...settings } });

  it('9.5 what the old card owes, divided by the paydays left before the promo ends, each share rounded up to the cent (A7)', () => {
    // After Oct 6 and before Jan 10: Oct 9 to Jan 1, 7 paydays.
    // 3,000.00 / 7 = 428.5714..., rounded up to 428.58.
    expect(payoffCountdown(withPromo('2027-01-10'), '2026-10-06')).toEqual({ on: true, owed: 300_000, promoEndDate: '2027-01-10', paydaysLeft: 7, perPayday: 42_858 });
  });

  it('9.5 an amount that divides evenly is not rounded up', () => {
    expect(payoffCountdown(withPromo('2027-01-10', 280_000), '2026-10-06')).toMatchObject({ paydaysLeft: 7, perPayday: 40_000 });
  });

  it('9.5 a payday on the promo end date does not count; one the day before does', () => {
    expect(payoffCountdown(withPromo('2027-01-01'), '2026-10-06')).toMatchObject({ paydaysLeft: 6, perPayday: 50_000 });
    expect(payoffCountdown(withPromo('2027-01-02'), '2026-10-06')).toMatchObject({ paydaysLeft: 7 });
  });

  it('9.5 only paydays after today count, not one today', () => {
    expect(payoffCountdown(withPromo('2027-01-10'), '2026-10-09')).toMatchObject({ paydaysLeft: 6, perPayday: 50_000 });
    expect(payoffCountdown(withPromo('2027-01-10'), '2026-10-08')).toMatchObject({ paydaysLeft: 7 });
  });

  it('9.5 a late paycheck whose payday has passed is not counted (QUESTIONS.md B59)', () => {
    // No paycheck since Sep 25, and Oct 9 has passed by Oct 12.
    expect(payoffCountdown(withPromo('2027-01-10'), '2026-10-12')).toMatchObject({ paydaysLeft: 6 });
  });

  it('9.5 the pay schedule is a setting', () => {
    // Every 15 days from Sep 25: Oct 10, Oct 25, Nov 9, Nov 24, Dec 9, Dec 24,
    // then Jan 8, after the Jan 5 end. Every 14 days, Jan 1 still counts.
    expect(payoffCountdown(withPromo('2027-01-05', 300_000, { payScheduleDays: 15 }), '2026-10-06')).toMatchObject({ paydaysLeft: 6, perPayday: 50_000 });
    expect(payoffCountdown(withPromo('2027-01-05'), '2026-10-06')).toMatchObject({ paydaysLeft: 7 });
  });

  it('9.5 with no paydays left before the promo ends, all of it is due now', () => {
    // The next payday, Oct 9, is the end date itself.
    expect(payoffCountdown(withPromo('2026-10-09'), '2026-10-06')).toEqual({ on: true, owed: 300_000, promoEndDate: '2026-10-09', paydaysLeft: 0, perPayday: 300_000 });
    // The promo already ended.
    expect(payoffCountdown(withPromo('2026-09-30'), '2026-10-06')).toMatchObject({ paydaysLeft: 0, perPayday: 300_000 });
  });

  it('9.5 with nothing owed, $0 per payday; a credit is not paid out', () => {
    expect(payoffCountdown(withPromo('2027-01-10', 0), '2026-10-06')).toMatchObject({ owed: 0, paydaysLeft: 7, perPayday: 0 });
    expect(payoffCountdown(withPromo('2027-01-10', -500), '2026-10-06')).toMatchObject({ owed: -500, perPayday: 0 });
    expect(payoffCountdown(withPromo('2026-09-30', -500), '2026-10-06')).toMatchObject({ paydaysLeft: 0, perPayday: 0 });
  });

  it('9.5 one cent owed is one cent per payday, not nothing', () => {
    expect(payoffCountdown(withPromo('2027-01-10', 1), '2026-10-06')).toMatchObject({ paydaysLeft: 7, perPayday: 1 });
  });

  it('9.5 it uses what the app shows as owed: new charges and interest raise it, payments lower it (5.4, 5.5)', () => {
    const b = withPromo('2027-01-10');
    b.receive(purchase('o1', '2026-10-02', 7_000, 'MADE UP CAFE', { account: 'old-card' }));
    b.receive(cardCharge('o2', '2026-10-03', 3_000, 'interest', 'old-card'));
    // 3,100.00 / 7 = 442.857..., rounded up to 442.86.
    expect(payoffCountdown(b, '2026-10-06')).toMatchObject({ owed: 310_000, perPayday: 44_286 });
    b.receive(transfer('o3', '2026-10-06', 30_000, 'checking', 'old-card'));
    expect(payoffCountdown(b, '2026-10-06')).toMatchObject({ owed: 280_000, perPayday: 40_000 });
  });

  it('9.5 very large amounts stay exact', () => {
    const book = { settings: () => changeSettings(DEFAULT_SETTINGS, { oldCardPromoEndDate: '2027-01-10' }), oldCardDebt: () => Number.MAX_SAFE_INTEGER, lastPaycheckDate: () => '2026-09-25' };
    // 9,007,199,254,740,991 / 7 = 1,286,742,750,677,284 rest 3, so rounded up.
    expect(payoffCountdown(book, '2026-10-06')).toMatchObject({ paydaysLeft: 7, perPayday: 1_286_742_750_677_285 });
  });
});

describe('9.3 a card payment in two halves (12.5)', () => {
  it('9.3 a payment counts on the day it left checking, and only once after it lands', () => {
    const b = openTestBook({ oldCardDebt: 300_000 });
    b.receive(sent('s1', '2026-10-10', 9_000, 'checking', 'old-card'));
    expect(b.cardPayments('old-card')).toEqual([{ date: '2026-10-10', amount: 9_000, landedOn: null }]);
    b.receive(arrived('a1', '2026-10-12', 9_000, 'checking', 'old-card', 's1'));
    expect(b.cardPayments('old-card')).toEqual([{ date: '2026-10-10', amount: 9_000, landedOn: '2026-10-12' }]);
  });

  it('9.3 seen landing first, it counts from the day it landed until it is seen leaving', () => {
    const b = openTestBook();
    b.receive(arrived('a1', '2026-10-12', 9_000, 'checking', 'everyday-card'));
    expect(b.cardPayments('everyday-card')).toEqual([{ date: '2026-10-12', amount: 9_000, landedOn: '2026-10-12' }]);
    b.receive(sent('s1', '2026-10-10', 9_000, 'checking', 'everyday-card'));
    expect(b.cardPayments('everyday-card')).toEqual([{ date: '2026-10-10', amount: 9_000, landedOn: '2026-10-12' }]);
  });
});

describe('9.3 a payment counts toward the statement by the day it reached the card (found in review)', () => {
  // EVERYDAY's statement date is Oct 1, due Oct 26, 1,234.56 owed.
  it('9.3 left before the statement date, reached the card after it: it counts toward this statement', () => {
    const paid = [{ date: '2026-09-30', amount: 123_456, landedOn: '2026-10-02' }];
    expect(cardNotices('2026-10-19', EVERYDAY, paid, DEFAULT_SETTINGS)).toEqual([]);
    expect(cardNotices('2026-10-19', OLD, [{ date: '2026-09-30', amount: 9_000, landedOn: '2026-10-02' }], DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.3 still on its way on the statement date: it counts toward this statement', () => {
    expect(cardNotices('2026-10-19', EVERYDAY, [{ date: '2026-09-30', amount: 123_456, landedOn: null }], DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.3 left and reached the card on or before the statement date: it belongs to the last statement', () => {
    expect(cardNotices('2026-10-19', EVERYDAY, [{ date: '2026-09-29', amount: 123_456, landedOn: '2026-10-01' }], DEFAULT_SETTINGS)).toHaveLength(1);
  });

  it('9.4 a full payment in transit across the statement date means it is not overdue', () => {
    expect(cardNotices('2026-10-27', EVERYDAY, [{ date: '2026-09-30', amount: 123_456, landedOn: '2026-10-02' }], DEFAULT_SETTINGS)).toEqual([]);
  });

  it('9.3 the answer does not change with the order the two halves arrive in', () => {
    for (const order of ['left first', 'landed first']) {
      const b = openTestBook();
      const halves = [sent('s1', '2026-09-30', 123_456, 'checking', 'everyday-card'), arrived('a1', '2026-10-02', 123_456, 'checking', 'everyday-card')];
      for (const half of order === 'left first' ? halves : [...halves].reverse()) b.receive(half);
      expect(b.cardPayments('everyday-card'), order).toEqual([{ date: '2026-09-30', amount: 123_456, landedOn: '2026-10-02' }]);
      expect(cardNotices('2026-10-19', EVERYDAY, b.cardPayments('everyday-card'), DEFAULT_SETTINGS), order).toEqual([]);
      expect(cardNotices('2026-10-27', EVERYDAY, b.cardPayments('everyday-card'), DEFAULT_SETTINGS), order).toEqual([]);
    }
  });

  it('9.3 a landing date that is not a real date is refused', () => {
    expect(codeOf(() => cardNotices('2026-10-19', EVERYDAY, [{ date: '2026-09-30', amount: 1, landedOn: '2026-02-30' }], DEFAULT_SETTINGS))).toBe('not-a-date');
  });
});
