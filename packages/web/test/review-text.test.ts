import { describe, expect, it } from 'vitest';
import { labeledText } from '../src/screens/review-text.js';

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
