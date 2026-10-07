import { describe, expect, it } from 'vitest';
import { checkBankRules, readBankItem, type BankRule } from '../src/bank/reading.js';

// How the bank connection tells kinds of bank activity apart before the money
// math sees them. Plaid gives each item an account and a signed amount
// (positive: money left the account; negative: money came in). Rules in
// settings, matched like the rulebook's own (B9: the description contains the
// text, ignoring case), say which items are transfers between his accounts,
// payments to people, and card fees or interest. Everything else is read by
// its account and sign. Descriptions and rules here are made up.
const rules: readonly BankRule[] = checkBankRules([
  { id: 'to-savings', account: 'checking', contains: 'transfer to SAV 2222', means: 'transfer', other: 'savings' },
  { id: 'from-checking', account: 'savings', contains: 'transfer from CHK 1111', means: 'transfer', other: 'checking' },
  { id: 'to-checking', account: 'savings', contains: 'transfer to CHK 1111', means: 'transfer', other: 'checking' },
  { id: 'savings-in-checking', account: 'checking', contains: 'transfer from SAV 2222', means: 'transfer', other: 'savings' },
  { id: 'pay-everyday', account: 'checking', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' },
  { id: 'pay-old', account: 'checking', contains: 'payment to CRD 4444', means: 'transfer', other: 'old-card' },
  { id: 'everyday-paid', account: 'everyday-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
  { id: 'old-paid', account: 'old-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
  { id: 'zelle', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' },
  { id: 'interest', account: 'everyday-card', contains: 'INTEREST CHARGE', means: 'card-interest' },
  { id: 'old-interest', account: 'old-card', contains: 'INTEREST CHARGE', means: 'card-interest' },
  { id: 'late-fee', account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' },
]);

describe('reading bank activity', () => {
  it('4.1 money out of checking or a card is a purchase, unless a rule says otherwise', () => {
    expect(readBankItem('checking', 4210, 'COFFEE SHOP 123', rules)).toEqual({ kind: 'purchase' });
    expect(readBankItem('everyday-card', 1, 'GROCERY', rules)).toEqual({ kind: 'purchase' });
    // A coffee shop is not a fee, even though "COFFEE" has "FEE" in it.
    expect(readBankItem('everyday-card', 450, 'COFFEE', rules)).toEqual({ kind: 'purchase' });
  });

  it('5.4 money out of the old card is a purchase there (flagged by the money math)', () => {
    expect(readBankItem('old-card', 2500, 'HARDWARE STORE', rules)).toEqual({ kind: 'purchase' });
  });

  it('3.1 and 6.1 money into checking or savings is a deposit, unless it is a transfer', () => {
    expect(readBankItem('checking', -250000, 'PAYROLL DEPOSIT', rules)).toEqual({ kind: 'deposit' });
    expect(readBankItem('savings', -12, 'INTEREST EARNED', rules)).toEqual({ kind: 'deposit' });
  });

  it('4.5 money back on a card is a refund, unless it is a payment', () => {
    expect(readBankItem('everyday-card', -1999, 'STORE RETURN', rules)).toEqual({ kind: 'refund' });
    expect(readBankItem('old-card', -500, 'RETURN', rules)).toEqual({ kind: 'refund' });
  });

  it('5.3 a transfer between checking and savings is read as its two halves', () => {
    expect(readBankItem('checking', 50000, 'Online Banking transfer to SAV 2222', rules)).toEqual({ kind: 'transfer-sent', to: 'savings' });
    expect(readBankItem('savings', -50000, 'Online Banking transfer from CHK 1111', rules)).toEqual({ kind: 'transfer-arrived', from: 'checking' });
    expect(readBankItem('savings', 20000, 'Online Banking transfer to CHK 1111', rules)).toEqual({ kind: 'transfer-sent', to: 'checking' });
    expect(readBankItem('checking', -20000, 'Online Banking transfer from SAV 2222', rules)).toEqual({ kind: 'transfer-arrived', from: 'savings' });
  });

  it('5.1 and 5.2 card payments are read as their two halves', () => {
    expect(readBankItem('checking', 30000, 'Online payment to CRD 3333', rules)).toEqual({ kind: 'transfer-sent', to: 'everyday-card' });
    expect(readBankItem('everyday-card', -30000, 'PAYMENT - THANK YOU', rules)).toEqual({ kind: 'transfer-arrived', from: 'checking' });
    expect(readBankItem('checking', 10000, 'Online payment to CRD 4444', rules)).toEqual({ kind: 'transfer-sent', to: 'old-card' });
    expect(readBankItem('old-card', -10000, 'payment - thank you', rules)).toEqual({ kind: 'transfer-arrived', from: 'checking' });
  });

  it('5.3 a transfer rule only fits money going the way a transfer can', () => {
    // Money coming into checking from a card is not a transfer the money math knows.
    const odd = checkBankRules([{ id: 'odd', account: 'checking', contains: 'CRD 3333', means: 'transfer', other: 'everyday-card' }]);
    expect(readBankItem('checking', -500, 'refund from CRD 3333', odd)).toEqual({ kind: 'deposit' });
    // Money leaving a card is never a transfer.
    expect(readBankItem('everyday-card', 3000, 'PAYMENT - THANK YOU REVERSAL', rules)).toEqual({ kind: 'purchase' });
  });

  it('7.4 and 8.1 a payment to a person comes out of checking', () => {
    expect(readBankItem('checking', 40000, 'Zelle payment to MOM MADEUP Conf# 1', rules)).toEqual({ kind: 'payment-to-person' });
    // Money coming in by Zelle is a deposit (7.5: a payback, when sorted).
    expect(readBankItem('checking', -4000, 'Zelle payment from FRIEND MADEUP', rules)).toEqual({ kind: 'deposit' });
  });

  it('4.8 and 5.5 fees and interest on a card', () => {
    expect(readBankItem('everyday-card', 1234, 'INTEREST CHARGE ON PURCHASES', rules)).toEqual({ kind: 'card-charge', charge: 'interest' });
    expect(readBankItem('everyday-card', 2900, 'LATE FEE', rules)).toEqual({ kind: 'card-charge', charge: 'fee' });
    expect(readBankItem('old-card', 4321, 'interest charge on purchases', rules)).toEqual({ kind: 'card-charge', charge: 'interest' });
    // A rule only counts on the account it is for: no late-fee rule on the old card.
    expect(readBankItem('old-card', 2900, 'LATE FEE', rules)).toEqual({ kind: 'purchase' });
  });

  it('money leaving savings with no rule saying where it went is not understood', () => {
    expect(readBankItem('savings', 7500, 'WITHDRAWAL', rules)).toMatchObject({ kind: 'not-understood' });
  });

  it('the first matching rule wins (B9)', () => {
    const both = checkBankRules([
      { id: 'a', account: 'checking', contains: 'payment to', means: 'payment-to-person' },
      { id: 'b', account: 'checking', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' },
    ]);
    expect(readBankItem('checking', 100, 'Online payment to CRD 3333', both)).toEqual({ kind: 'payment-to-person' });
  });

  it('zero is not read as anything', () => {
    expect(readBankItem('checking', 0, 'CARD CHECK', rules)).toEqual({ kind: 'nothing' });
  });
});

describe('0.2 bank rules are settings, checked when set', () => {
  const ok = { id: 'r', account: 'checking', contains: 'x', means: 'payment-to-person' } as const;

  it('0.2 a good list is kept as it is, in order', () => {
    expect(checkBankRules([ok])).toEqual([ok]);
    expect(checkBankRules([])).toEqual([]);
  });

  it('0.2 a rule needs an id, text to match, one of his accounts, and a meaning that fits that account', () => {
    const bad: unknown[] = [
      { ...ok, id: '' },
      { ...ok, contains: '  ' },
      { ...ok, account: 'brokerage' },
      { ...ok, means: 'paycheck' },
      { ...ok, account: 'savings' },
      { id: 'f', account: 'checking', contains: 'x', means: 'card-fee' },
      { id: 'i', account: 'savings', contains: 'x', means: 'card-interest' },
      { id: 't', account: 'checking', contains: 'x', means: 'transfer', other: 'checking' },
      { id: 't', account: 'checking', contains: 'x', means: 'transfer' },
      { id: 't', account: 'everyday-card', contains: 'x', means: 'transfer', other: 'old-card' },
      null,
      'zelle',
    ];
    for (const rule of bad) expect(() => checkBankRules([rule]), JSON.stringify(rule)).toThrow(/bank rule/);
    expect(() => checkBankRules([ok, ok])).toThrow(/same id/);
    expect(() => checkBankRules('nope')).toThrow(/bank rule/);
  });
});
