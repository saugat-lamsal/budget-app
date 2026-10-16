import { describe, expect, it } from 'vitest';
import { RULE_WHAT, labeledText, offerText, ruleSentenceText } from '../src/screens/review-text.js';

// B226: what Review says about a pending item the bank labels as a transfer
// or a payment to a person, which no bank rule reads as one. Made-up words.

describe('B226 the bank rule for a pending item read as a purchase, in words', () => {
  it('B226 a transfer (a card payment is one): the rule for its wording, and how to fix this one once it posts', () => {
    expect(labeledText({ account: 'checking', contains: 'PAYMENT TO ACCT', means: 'transfer', other: 'everyday-card' })).toBe(
      'Your bank labels this a transfer between your accounts (a card payment is one), but no bank rule reads it as one, so it counts as spending while it is pending. A bank rule for “PAYMENT TO ACCT” on checking reads the next ones right: add it on Settings, Bank rules. This one you can mark “Transfer between my accounts” once it posts.',
    );
  });

  it('B226 a payment to a person, from savings', () => {
    expect(labeledText({ account: 'savings', contains: 'Zelle payment to MADE UP FRIEND', means: 'payment-to-person', other: null })).toBe(
      'Your bank labels this a payment to a person, but no bank rule reads it as one, so it counts as a purchase. A bank rule for “Zelle payment to MADE UP FRIEND” on savings reads the next ones right: add it on Settings, Bank rules.',
    );
  });
});

// Rule 13.8 (QUESTIONS.md A55): the rule offered the second time a place is
// sorted the same way by hand, and what any rule made from an item would do.
describe('13.8 the rule offered, in words', () => {
  it('13.8 the notice says it was sorted the same way before, by the place\'s name', () => {
    expect(offerText({ for: 'purchase', contains: 'SUNRISE BAKERY', to: 'wants' })).toBe('You sorted “SUNRISE BAKERY” the same way before. Make it a rule so the next one sorts itself?');
  });

  it('13.6 13.8 what the rule would do: purchases, payments to people, or deposits, whose description contains the text, sorted as the pick', () => {
    expect(ruleSentenceText('purchases', 'SUNRISE BAKERY', 'Wants')).toBe('From now on, purchases whose description contains “SUNRISE BAKERY” are sorted as: Wants. Anything waiting that matches is sorted now too, if it can be.');
    expect(RULE_WHAT).toEqual({ purchase: 'purchases', person: 'payments to people', deposit: 'deposits' });
  });
});
