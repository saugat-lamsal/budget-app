import type { AccountId } from '@budget-app/money';
import type { BankMeaning, BankRuleChange, MatchExample, RuleMatches, SuggestionLine } from '@budget-app/server/views';
import { shortDate } from '../ui/dates.js';
import { ACCOUNT_NAMES, accountPhrase, bankRuleText } from './setup-text.js';

// Words for bank rules (rulebook section 2, 20a, 24c), on Setup day and on
// Settings. Every count and every match comes from the server; these only
// name things.

export const MEANING_NAMES: Readonly<Record<BankMeaning, string>> = {
  transfer: 'A transfer between your accounts',
  'payment-to-person': 'A payment to a person',
  'card-fee': 'A card fee',
  'card-interest': 'Card interest',
};

const ACCOUNTS: readonly AccountId[] = ['checking', 'savings', 'everyday-card', 'old-card'];
const isCard = (account: AccountId): boolean => account === 'everyday-card' || account === 'old-card';

// What a rule on this account can say an item is (section 2): payments to
// people leave checking or savings; fees and interest are on a card.
export function meaningsOn(account: AccountId): readonly BankMeaning[] {
  return isCard(account) ? ['transfer', 'card-fee', 'card-interest'] : ['transfer', 'payment-to-person'];
}

// The accounts a transfer on this account can be with: money reaches a card
// from checking or savings.
export function othersOf(account: AccountId): readonly AccountId[] {
  return ACCOUNTS.filter((a) => a !== account && (!isCard(account) || !isCard(a)));
}

// A suggestion in a sentence. One whose other account is not known says so.
export function suggestionText(s: SuggestionLine): string {
  if (s.means === 'transfer' && s.other === null) return `“${s.contains}” on ${accountPhrase(s.account)}: a transfer between ${accountPhrase(s.account)} and another of your accounts. Pick which.`;
  return bankRuleText({ account: s.account, contains: s.contains, means: s.means, ...(s.other === null ? {} : { other: s.other }) });
}

export function statusText(status: SuggestionLine['status']): string {
  switch (status) {
    case 'open':
      return 'Not answered yet';
    case 'added':
      return 'Your answer: added';
    case 'changed':
      return 'Your answer: added as you changed it';
    case 'skipped':
      return 'Your answer: skipped';
    case 'covered':
      return 'Your bank rules already read these this way';
  }
}

const items = (n: number): string => (n === 1 ? '1 item' : `${n} items`);

// How many items it matches: in the whole history (Setup day), or lately (Settings).
export function matchesText(m: RuleMatches, recentDays: number | null): string {
  if (m.count === 0) return recentDays === null ? 'It matches nothing in your history.' : `It would have matched nothing in the last ${recentDays} days.`;
  return recentDays === null ? `It matches ${items(m.count)} in your history.` : `It would have matched ${items(m.count)} in the last ${recentDays} days.`;
}

// A27: the first bank rule that fits wins. What that means for this one.
export function overlapText(m: RuleMatches): string | null {
  const parts: string[] = [];
  if (m.readFirstByEarlier > 0) parts.push(`${m.readFirstByEarlier === 1 ? '1 of them is' : `${m.readFirstByEarlier} of them are`} read first by a bank rule before it, so this one changes nothing for ${m.readFirstByEarlier === 1 ? 'it' : 'them'}.`);
  if (m.takenFromLater > 0) parts.push(`It would read ${items(m.takenFromLater)} that a bank rule after it reads now.`);
  return parts.length === 0 ? null : parts.join(' ');
}

export function exampleDetail(e: MatchExample): string {
  return `${shortDate(e.date)} · ${ACCOUNT_NAMES[e.account]}${e.direction === 'in' ? ' · money in' : ''}${e.pending ? ' · pending' : ''}${e.readFirstBy === null ? '' : ' · read first by another rule'}`;
}

// What a change did, once the server said done.
export function bankRuleDoneText(change: BankRuleChange): string {
  if ('add' in change) return 'Bank rule added. It reads what the bank sends from now on.';
  if ('change' in change) return 'Bank rule changed. It reads what the bank sends from now on; what was already read stays as it was.';
  return 'Bank rule removed.';
}
