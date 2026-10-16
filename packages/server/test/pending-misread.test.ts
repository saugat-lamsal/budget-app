import type { AccountId, Cents } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { suggestBankRules, wordingOf, type BankLine } from '../src/bank-rules.js';
import type { BankRule } from '../src/bank/reading.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk } from './keeper-harness.js';

// QUESTIONS.md B226 (found on connection day): the bank words a card payment
// still pending differently from the posted one ("PAYMENT TO ACCT #nnnn ON
// mm/dd VIA WEB" against "Mobile Banking payment to CRD nnnn
// Confirmation#"), so no bank rule fitted it, it was read as a purchase, and
// the starting money came out low by its amount. Setup day now points out a
// pending item the bank labels as a card payment or a transfer that is being
// read as a purchase, and offers a rule for its wording: the words before the
// first one that changes from payment to payment (a number, a date, an
// account's digits). Every name and number is made up.

let n = 0;
function line(account: AccountId, amount: Cents, description: string, label: string | null, more: Partial<BankLine> = {}): BankLine {
  n += 1;
  return { id: `l${n}`, account, amount, date: '2026-10-12', description, pending: false, label: label === null ? null : { primary: label.split('_').slice(0, 2).join('_'), detailed: label }, ...more };
}

const PENDING_PAYMENT = 'PAYMENT TO ACCT #4321 ON 10/12 VIA WEB';
const ARRIVING = 'PAYMENT FROM CHK 1234';

describe('B226 a pending card payment or transfer read as a purchase is pointed out on Setup day', () => {
  it('B226 the pending card payment, labeled as one and read as a purchase: a rule for its wording, the card from where the money lands, and the item named', () => {
    const lines = [
      line('checking', 3_500, PENDING_PAYMENT, 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', { pending: true }),
      line('everyday-card', -3_500, ARRIVING, 'TRANSFER_IN_OTHER_TRANSFER_IN', { date: '2026-10-13' }),
    ];
    const s = suggestBankRules(lines, []).find((x) => x.account === 'checking');
    expect(s).toMatchObject({ account: 'checking', contains: 'PAYMENT TO ACCT', means: 'transfer', other: 'everyday-card', pending: { description: PENDING_PAYMENT, amount: 3_500, date: '2026-10-12' } });
    // It matches the pending payment itself.
    expect(s?.matches.count).toBe(1);
  });

  it('B226 a pending transfer to savings, and a pending payment to a person, labeled so and read as purchases: pointed out too', () => {
    const lines = [
      line('checking', 20_000, 'ONLINE TRANSFER TO SAV 9876 REF 5551', 'TRANSFER_OUT_SAVINGS', { pending: true }),
      line('checking', 4_000, 'Zelle payment to MADE UP FRIEND Conf# a1b2', 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS', { pending: true }),
    ];
    const got = suggestBankRules(lines, []).map((s) => [s.contains, s.means, s.other, s.pending?.description ?? null]);
    expect(got).toEqual([
      ['ONLINE TRANSFER TO SAV', 'transfer', 'savings', 'ONLINE TRANSFER TO SAV 9876 REF 5551'],
      ['Zelle payment to MADE UP FRIEND', 'payment-to-person', null, 'Zelle payment to MADE UP FRIEND Conf# a1b2'],
    ]);
  });

  it('B226 two pending payments worded alike, with different numbers and dates, make one suggestion', () => {
    const lines = [
      line('checking', 3_500, 'PAYMENT TO ACCT #4321 ON 10/12 VIA WEB', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', { pending: true }),
      line('checking', 6_000, 'PAYMENT TO ACCT #8765 ON 10/13 VIA WEB', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', { pending: true, date: '2026-10-13' }),
    ];
    const got = suggestBankRules(lines, []);
    expect(got.map((s) => s.contains)).toEqual(['PAYMENT TO ACCT']);
    expect(got[0]?.matches.count).toBe(2);
    // The newest is the one named.
    expect(got[0]?.pending?.description).toBe('PAYMENT TO ACCT #8765 ON 10/13 VIA WEB');
  });

  it('B226 once his bank rules read it right, nothing is pointed out; posted items and items with no such label are as before', () => {
    const rule: BankRule = { id: 'r1', account: 'checking', contains: 'PAYMENT TO ACCT', means: 'transfer', other: 'everyday-card' };
    const pending = line('checking', 3_500, PENDING_PAYMENT, 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', { pending: true });
    expect(suggestBankRules([pending], [rule]).every((s) => s.pending === null)).toBe(true);
    // Posted: the usual suggestion, from what the descriptions share, not pointed out.
    const posted = line('checking', 3_500, 'Mobile Banking payment to CRD 4321 Confirmation# 77', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT');
    expect(suggestBankRules([posted], []).map((s) => [s.contains, s.pending])).toEqual([['Mobile Banking payment to CRD 4321 Confirmation# 77', null]]);
    // A pending purchase with a store's label: nothing.
    expect(suggestBankRules([line('checking', 1_200, 'MADE UP GROCER 0042', 'FOOD_AND_DRINK_GROCERIES', { pending: true })], [])).toEqual([]);
  });

  it('B226 the wording: the words before the first holding a digit or #; all of it when it starts with one', () => {
    expect(wordingOf('PAYMENT TO ACCT #4321 ON 10/12 VIA WEB')).toBe('PAYMENT TO ACCT');
    expect(wordingOf('Mobile Banking payment to CRD 4321 Confirmation#')).toBe('Mobile Banking payment to CRD');
    // Its own spacing kept: a rule's text must be in the description as it is.
    expect(wordingOf('  ONLINE   TRANSFER TO SAV 9876')).toBe('ONLINE   TRANSFER TO SAV');
    expect(wordingOf('4321 PAYMENT')).toBe('4321 PAYMENT');
    expect(wordingOf('PAYMENT THANK YOU')).toBe('PAYMENT THANK YOU');
  });
});

describe('B226 in Review: a pending item waiting there, labeled as a card payment or transfer and read as a purchase', () => {
  it('B226 each such pending item gets the rule for its wording; once a rule reads it right, or once it posts, none', async () => {
    const { misreadHints } = await import('../src/bank-rules.js');
    const pending = line('checking', 3_500, PENDING_PAYMENT, 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT', { pending: true });
    const grocer = line('checking', 1_200, 'MADE UP GROCER 0042', 'FOOD_AND_DRINK_GROCERIES', { pending: true });
    const posted = line('checking', 3_500, 'Mobile Banking payment to CRD 4321 Confirmation# 77', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT');
    const hints = misreadHints([pending, grocer, posted], []);
    expect([...hints.entries()]).toEqual([[pending.id, { account: 'checking', contains: 'PAYMENT TO ACCT', means: 'transfer', other: null }]]);
    const rule: BankRule = { id: 'r1', account: 'checking', contains: 'PAYMENT TO ACCT', means: 'transfer', other: 'everyday-card' };
    expect(misreadHints([pending], [rule]).size).toBe(0);
  });
});

describe('B226 Review, with the real books and the made-up bank', () => {
  it('B226 the pending card payment waiting in Review carries the bank rule for its wording; a pending purchase labeled as one does not', async () => {
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life);
      life.now = noonInNewYork('2026-10-08');
      life.h.fake.addPending({ id: 'pay-pending', account: ACCOUNT_IDS.checking, amount: 6_000, date: '2026-10-08', description: 'PAYMENT TO ACCT #3333 ON 10/08 VIA WEB', label: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' });
      life.h.fake.addPending({ id: 'grocer-pending', account: ACCOUNT_IDS.checking, amount: 1_200, date: '2026-10-08', description: 'MADE UP GROCER 0042', label: 'FOOD_AND_DRINK_GROCERIES' });
      await life.sync();
      const view = life.keeper.review();
      if (view.state !== 'tracking') throw new Error('not tracking');
      const byId = new Map(view.items.map((d) => [d.item.id, d]));
      expect(byId.get('pay-pending')?.labeled).toEqual({ account: 'checking', contains: 'PAYMENT TO ACCT', means: 'transfer', other: null });
      expect(byId.get('grocer-pending')).toBeDefined();
      expect(byId.get('grocer-pending')?.labeled).toBeUndefined();
    } finally {
      life.done();
    }
  });
});

describe('B226 on Setup day, the demo life setup-pending-payment', () => {
  it('B226 Setup day\'s suggestions name the pending card payment they were made for, once', async () => {
    const { demoSetupDesk } = await import('../src/demo/demo-server.js');
    const { DEMO_TODAY, demoScenario } = await import('../src/demo/scenarios.js');
    const scenario = demoScenario('setup-pending-payment');
    if (scenario === undefined) throw new Error('no such life');
    const view = demoSetupDesk(scenario, DEMO_TODAY)?.view();
    if (view === undefined || view.state !== 'not-set-up' || !view.ready) throw new Error('not ready');
    expect(view.suggestions.filter((s) => s.pending !== null).map((s) => [s.contains, s.pending])).toEqual([
      ['PAYMENT TO ACCT', { description: 'PAYMENT TO ACCT #3333 ON 10/08 VIA WEB', amount: 6_000, date: '2026-10-08' }],
    ]);
  });
});
