import { describe, expect, it } from 'vitest';
import { stillToSetText } from '../src/screens/home-text.js';
import { answerText, bankRuleText, effectLead, halfText, lookBackText, missingText, readDays, stepCount } from '../src/screens/setup-text.js';

// The words on Setup day and on Home after it. Every amount comes from the
// server; these only name things. Made-up names.

const half = (over: object) =>
  ({ id: 'h', kind: 'left', from: 'checking', to: 'everyday-card', date: '2026-10-06', description: 'Online payment to CRD 3333', amount: 30_000, effect: 30_000, rule: null, onItsWay: null, ...over }) as Parameters<typeof halfText>[0];

describe('14 section 2 the words for what is still to set after setup day', () => {
  it('14 both rules', () => {
    expect(stillToSetText(['paycheckRule', 'momRule'])).toEqual({
      title: 'Still to set: the paycheck rule and the mom rule',
      detail: 'Until then your paycheck and payments to mom wait in Review. Set them in Settings.',
    });
  });

  it('14 only the paycheck rule', () => {
    expect(stillToSetText(['paycheckRule'])).toEqual({ title: 'Still to set: the paycheck rule', detail: 'Until then your paycheck waits in Review. Set it in Settings.' });
  });

  it('14 only the mom rule', () => {
    expect(stillToSetText(['momRule'])).toEqual({ title: 'Still to set: the mom rule', detail: 'Until then payments to mom wait in Review. Set it in Settings.' });
  });
});

describe('B48 the words for a transfer with one side showing', () => {
  it('B48 money that left and has not arrived', () => {
    expect(halfText(half({}))).toBe('Left checking on Tue, Oct 6 for the everyday card. It does not show arriving yet.');
    expect(effectLead(half({}))).toBe('It left checking and has not arrived, so no balance shows it.');
  });

  it('B48 money that arrived before it shows leaving', () => {
    const arrived = half({ kind: 'arrived', from: 'checking', to: 'savings', effect: -15_000 });
    expect(halfText(arrived)).toBe('Arrived in savings on Tue, Oct 6 from checking. Checking does not show it leaving yet.');
    expect(effectLead(arrived)).toBe('Checking still holds it, and it shows arrived too.');
  });

  it('12.4 a half of a payment to the old card changes nothing', () => {
    expect(effectLead(half({ to: 'old-card', effect: 0 }))).toBe("Either way it doesn't change the starting money: the old card is not part of it.");
  });

  it('B126 his answer, in words', () => {
    expect([answerText(null), answerText(true), answerText(false)]).toEqual(['Not answered yet', 'Your answer: on its way', 'Your answer: not on its way']);
  });
});

describe('section 2 14.3 the bank rules, what is missing, and the steps', () => {
  it('section 2 each kind of bank rule in a sentence', () => {
    expect(bankRuleText({ id: 'a', account: 'checking', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' })).toBe('“payment to CRD 3333” on checking: a transfer between checking and the everyday card');
    expect(bankRuleText({ id: 'e', account: 'everyday-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' })).toBe('“PAYMENT - THANK YOU” on the everyday card: a transfer between the everyday card and checking');
    expect(bankRuleText({ id: 'f', account: 'savings', contains: 'transfer from CHK', means: 'transfer', other: 'checking' })).toBe('“transfer from CHK” on savings: a transfer between savings and checking');
    expect(bankRuleText({ id: 'g', account: 'checking', contains: 'transfer to SAV', means: 'transfer', other: 'savings' })).toBe('“transfer to SAV” on checking: a transfer between checking and savings');
    expect(bankRuleText({ id: 'b', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' })).toBe('“Zelle payment to” on checking: a payment to a person');
    expect(bankRuleText({ id: 'c', account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' })).toBe('“LATE FEE” on the everyday card: a card fee');
    expect(bankRuleText({ id: 'd', account: 'old-card', contains: 'INTEREST CHARGE', means: 'card-interest' })).toBe('“INTEREST CHARGE” on the old card: card interest');
  });

  it('A25 how far back setup day looks, in words, and the days as typed', () => {
    expect([lookBackText(0), lookBackText(1), lookBackText(10), lookBackText(365)]).toEqual(['Today only', 'The last day', 'The last 10 days', 'The last 365 days']);
    expect([readDays('0'), readDays(' 10 '), readDays('999999')]).toEqual([0, 10, 999_999]);
    expect([readDays(''), readDays('-1'), readDays('1.5'), readDays('ten'), readDays('1000000')]).toEqual([null, null, null, null, null]);
  });

  it('14.3 what still stops tracking from starting', () => {
    expect(missingText('halves', 1)).toBe('Say whether the transfer is on its way.');
    expect(missingText('halves', 3)).toBe('Say whether each of 3 transfers is on its way.');
    expect(missingText('last-paycheck', 0)).toBe('Enter the date of your last paycheck.');
    expect(missingText('assignment', 0)).toBe('Hand out the starting money to the cent.');
  });

  it('the step count', () => {
    expect(stepCount(0, 5)).toBe('Step 1 of 5');
    expect(stepCount(4, 5)).toBe('Step 5 of 5');
  });
});
