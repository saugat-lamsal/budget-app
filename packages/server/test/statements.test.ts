import { cardNotices } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { cardStatement } from '../src/bank/statements.js';
import type { PlaidCreditCard } from '../src/plaid/types.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { SETTINGS, book, status, tracking } from './harness.js';

// Section 9: what the card reminders need, from Plaid's Liabilities answer.
// Every number is made up.
const card: PlaidCreditCard = {
  account_id: ACCOUNT_IDS.everyday,
  is_overdue: false,
  last_payment_amount: 120.5,
  last_payment_date: '2026-09-10',
  last_statement_issue_date: '2026-09-28',
  last_statement_balance: 450.25,
  minimum_payment_amount: 35,
  next_payment_due_date: '2026-10-23',
};

describe('9 card statements from the bank', () => {
  it('9.1 and 9.2 the statement balance, the minimum, the due date, and the statement date', () => {
    expect(cardStatement('everyday-card', card)).toEqual({
      ok: true,
      statement: { card: 'everyday-card', closingDate: '2026-09-28', dueDate: '2026-10-23', statementBalance: 45_025, minimumPayment: 3_500 },
    });
  });

  it('9.1 a missing or odd detail means no statement, and says why', () => {
    expect(cardStatement('old-card', { ...card, next_payment_due_date: null })).toEqual({ ok: false, why: 'the bank did not give the due date' });
    expect(cardStatement('old-card', { ...card, minimum_payment_amount: null })).toEqual({ ok: false, why: 'the bank did not give the minimum payment' });
    expect(cardStatement('old-card', { ...card, last_statement_balance: null })).toEqual({ ok: false, why: 'the bank did not give the statement balance' });
    expect(cardStatement('old-card', { ...card, last_statement_issue_date: null })).toEqual({ ok: false, why: 'the bank did not give the statement date' });
    expect(cardStatement('old-card', { ...card, next_payment_due_date: '2026-09-01' })).toMatchObject({ ok: false, why: /before the statement date/ });
    expect(cardStatement('old-card', { ...card, minimum_payment_amount: -1 })).toMatchObject({ ok: false, why: /below zero/ });
    expect(cardStatement('old-card', { ...card, minimum_payment_amount: 0.001 })).toMatchObject({ ok: false, why: /whole number of cents/ });
  });

  it('9.3 the statements come in with each sync, and a payment since the statement stops the reminders', async () => {
    const h = await tracking();
    h.fake.setStatement(ACCOUNT_IDS.everyday, { ...card });
    h.fake.setStatement(ACCOUNT_IDS.old, { ...card, last_statement_balance: 3000, minimum_payment_amount: 60 });
    await h.sync('2026-10-16');
    const everyday = status(h).statements.find((s) => s.card === 'everyday-card')?.result;
    if (everyday?.ok !== true) throw new Error('no everyday card statement');
    // Seven days before the due date, nothing paid yet: a reminder (9.1).
    expect(cardNotices('2026-10-16', everyday.statement, book(h).cardPayments('everyday-card'), SETTINGS)).toMatchObject([{ kind: 'reminder', daysBefore: 7, statementBalance: 45_025 }]);
    // Paid in full, leaving checking and landing on the card.
    h.fake.addPosted({ id: 'pay', account: ACCOUNT_IDS.checking, amount: 45_025, date: '2026-10-17', description: 'Online payment to CRD 3333' });
    h.fake.addPosted({ id: 'paid', account: ACCOUNT_IDS.everyday, amount: -45_025, date: '2026-10-18', description: 'PAYMENT - THANK YOU' });
    await h.sync('2026-10-21');
    expect(cardNotices('2026-10-21', everyday.statement, book(h).cardPayments('everyday-card'), SETTINGS)).toEqual([]);
    expect(status(h).statements.map((s) => [s.card, s.result.ok])).toEqual([
      ['everyday-card', true],
      ['old-card', true],
    ]);
  });
});
