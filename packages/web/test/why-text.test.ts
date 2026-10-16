import { describe, expect, it } from 'vitest';
import { whyText } from '../src/screens/why-text.js';

// Rule 12.6 (QUESTIONS.md A57): the words for each line of why the totals do
// not match, in the rulebook's words. The amount beside each is its part of
// the difference (the screens show it signed). Every name and number is made up.
describe('12.6 why it does not match, in words', () => {
  it('12.6 a card charge the bank posted while Plaid still says pending is counted twice for now; money in there is counted once Plaid says it posted', () => {
    expect(whyText({ kind: 'posted-still-pending', account: 'everyday-card', description: 'COFFEE CART MADE UP', charge: true, amount: -2_500 })).toEqual({
      title: 'Everyday card: “COFFEE CART MADE UP”',
      detail: 'Posted at the bank, Plaid still says pending: counted twice for now.',
    });
    expect(whyText({ kind: 'posted-still-pending', account: 'everyday-card', description: 'MADE UP SHOE STORE', charge: false, amount: 3_000 })).toEqual({
      title: 'Everyday card: “MADE UP SHOE STORE”',
      detail: 'Posted at the bank, Plaid still says pending: counted once Plaid says it posted.',
    });
    expect(whyText({ kind: 'posted-still-pending', account: 'checking', description: 'MADE UP GAS', charge: true, amount: -1_200 }).title).toBe('Checking: “MADE UP GAS”');
  });

  it('12.6 checking or savings: not in the available balance yet, a new amount, and posted with the pending one still listed', () => {
    expect(whyText({ kind: 'not-in-available-yet', account: 'checking', description: 'MADE UP DELI', amount: 1_999 })).toEqual({
      title: 'Checking: “MADE UP DELI”',
      detail: 'Plaid lists it as pending; the available balance does not show it yet.',
    });
    expect(whyText({ kind: 'amount-changed', account: 'savings', description: 'MADE UP BISTRO', was: 4_000, now: 4_800, amount: 800 })).toEqual({
      title: 'Savings: “MADE UP BISTRO”',
      detail: 'Plaid changed its amount from $40.00 to $48.00; the available balance still has the old one.',
    });
    expect(whyText({ kind: 'posted-and-pending', account: 'checking', description: 'MADE UP PAYROLL', amount: -90_000 })).toEqual({
      title: 'Checking: “MADE UP PAYROLL”',
      detail: 'Posted, and Plaid still lists the pending one too.',
    });
  });

  it('12.6 what is left of an account\'s move is one line: its balance went up or down with no transaction from the bank yet', () => {
    expect(whyText({ kind: 'balance-moved', account: 'checking', balance: 'available', went: 'up', by: 2_750, amount: 2_750 })).toEqual({
      title: "Checking's available balance went up $27.50 with no transaction from the bank yet.",
    });
    expect(whyText({ kind: 'balance-moved', account: 'savings', balance: 'posted', went: 'down', by: 1, amount: -1 }).title).toBe("Savings' balance went down $0.01 with no transaction from the bank yet.");
    expect(whyText({ kind: 'balance-moved', account: 'everyday-card', balance: 'posted', went: 'up', by: 123_456_789, amount: -123_456_789 }).title).toBe(
      "The everyday card's balance went up $1,234,567.89 with no transaction from the bank yet.",
    );
  });

  it('12.6 the rest, and no earlier read that matched', () => {
    expect(whyText({ kind: 'rest', amount: 1_234 })).toEqual({ title: "The rest, which the bank's balances and transactions do not account for." });
    expect(whyText({ kind: 'no-match-kept', amount: -4_210 })).toEqual({ title: 'No earlier read of the bank that matched is kept to compare with.' });
  });

  it('12.6 an item whose words could not be read is still named by its account', () => {
    expect(whyText({ kind: 'not-in-available-yet', account: 'checking', description: '', amount: 1 }).title).toBe('Checking: a pending item');
  });
});
