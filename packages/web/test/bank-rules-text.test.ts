import { describe, expect, it } from 'vitest';
import { bankRuleDoneText, matchesText, meaningsOn, movesOf, moveText, othersOf, overlapText, statusText, suggestionText } from '../src/screens/bank-rules-text.js';

// The words for bank rules (rulebook section 2, 20a, 24c). Every count comes
// from the server; these only name things. Made-up names.

const matches = (count: number, readFirstByEarlier = 0, takenFromLater = 0) => ({ count, examples: [], readFirstByEarlier, takenFromLater });

describe('section 2 20a 24c the words for bank rules', () => {
  it('section 2 what a rule on each account can say, and which accounts a transfer can be with', () => {
    expect(meaningsOn('checking')).toEqual(['transfer', 'payment-to-person']);
    expect(meaningsOn('old-card')).toEqual(['transfer', 'card-fee', 'card-interest']);
    expect(othersOf('checking')).toEqual(['savings', 'everyday-card', 'old-card']);
    expect(othersOf('everyday-card')).toEqual(['checking', 'savings']);
  });

  it('20a a suggestion in a sentence, and one whose other account is to pick', () => {
    const base = { id: 's', label: 'X', matches: matches(1), status: 'open' as const, ruleId: null };
    expect(suggestionText({ ...base, account: 'checking', contains: 'Online payment to CRD 4444', means: 'transfer', other: null })).toBe(
      '“Online payment to CRD 4444” on checking: a transfer between checking and another of your accounts. Pick which.',
    );
    expect(suggestionText({ ...base, account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee', other: null })).toBe('“LATE FEE” on the everyday card: a card fee');
  });

  it('20a 24c how many it matches: zero, one, many; in the history or lately', () => {
    expect([matchesText(matches(0), null), matchesText(matches(1), null), matchesText(matches(12), null)]).toEqual([
      'It matches nothing in your history.',
      'It matches 1 item in your history.',
      'It matches 12 items in your history.',
    ]);
    expect([matchesText(matches(0), 90), matchesText(matches(2), 90)]).toEqual(['It would have matched nothing in the last 90 days.', 'It would have matched 2 items in the last 90 days.']);
  });

  it('A27 the first rule that fits wins: what that means for this one, in words', () => {
    expect(overlapText(matches(3))).toBeNull();
    expect(overlapText(matches(3, 1))).toBe('1 of them is read first by a bank rule before it, so this one changes nothing for it.');
    expect(overlapText(matches(3, 2, 1))).toBe('2 of them are read first by a bank rule before it, so this one changes nothing for them. It would read 1 item that a bank rule after it reads now.');
  });

  it('20a his answer, and what a change did', () => {
    expect((['open', 'added', 'changed', 'skipped', 'covered'] as const).map(statusText)).toEqual([
      'Not answered yet',
      'Your answer: added',
      'Your answer: added as you changed it',
      'Your answer: skipped',
      'Your bank rules already read these this way',
    ]);
    expect(bankRuleDoneText({ remove: 'x' })).toBe('Bank rule removed.');
    expect(bankRuleDoneText({ add: { account: 'checking', contains: 'x', means: 'payment-to-person' } })).toMatch(/^Bank rule added\./);
    expect(bankRuleDoneText({ move: { id: 'x', direction: 'up' } })).toBe('Bank rule moved up. It reads what the bank sends from now on, ahead of the rule it passed.');
    expect(bankRuleDoneText({ move: { id: 'x', direction: 'down' } })).toBe('Bank rule moved down. The rule it passed reads first from now on.');
  });

  it('A27 what a move would change, in words: none, one, many, moving up or down', () => {
    const past = { id: 'wide', account: 'checking' as const, contains: 'Zelle payment to', means: 'payment-to-person' as const };
    expect(moveText({ direction: 'up', past, switching: 0 }, 90)).toBe('Nothing from the last 90 days fits both this rule and “Zelle payment to” on checking: a payment to a person, so nothing read lately would change.');
    expect(moveText({ direction: 'up', past, switching: 1 }, 90)).toBe('It would read 1 item from the last 90 days that “Zelle payment to” on checking: a payment to a person reads now.');
    expect(moveText({ direction: 'down', past, switching: 3 }, 90)).toBe('“Zelle payment to” on checking: a payment to a person would read 3 items from the last 90 days that this rule reads now.');
  });

  it('A27 which way a rule can move: only past another rule on its account', () => {
    const rules = [
      { id: 'a', account: 'checking' as const, contains: 'A', means: 'payment-to-person' as const },
      { id: 'b', account: 'savings' as const, contains: 'B', means: 'payment-to-person' as const },
      { id: 'c', account: 'checking' as const, contains: 'C', means: 'payment-to-person' as const },
    ];
    expect(rules.map((r) => movesOf(r, rules))).toEqual([
      { up: false, down: true },
      { up: false, down: false },
      { up: true, down: false },
    ]);
  });
});
