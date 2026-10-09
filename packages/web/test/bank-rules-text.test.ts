import { describe, expect, it } from 'vitest';
import { bankRuleDoneText, matchesText, meaningsOn, othersOf, overlapText, statusText, suggestionText } from '../src/screens/bank-rules-text.js';

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
  });
});
