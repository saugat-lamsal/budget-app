import type { AccountId, Cents, IsoDate } from '@budget-app/money';
import type { BankRule } from '../bank/reading.js';
import type { RefusalCode } from './choice.js';

// Bank rules (rulebook section 2, 20a, 24c), as the phone sees them and sends
// changes to them. Types only, so the phone can share them with the server:
// every count and every match is worked out on the server (bank-rules.ts).

export type BankMeaning = BankRule['means'];

// A bank rule as he types it or as it is suggested, without its id. Whether
// it can be (a transfer between two accounts, a fee on a card) is
// bankRuleProblem's to say, in words.
export interface BankRuleSpec {
  readonly account: AccountId;
  readonly contains: string;
  readonly means: BankMeaning;
  // The other account, for a transfer.
  readonly other?: AccountId | undefined;
}

// What a rule would match (bank-rules.ts, matchesOf).
export interface MatchExample {
  readonly id: string;
  readonly date: IsoDate;
  readonly account: AccountId;
  readonly description: string;
  // How much moved, and which way.
  readonly amount: Cents;
  readonly direction: 'out' | 'in';
  readonly pending: boolean;
  // The id of a rule before it in the list that reads this item first, or null.
  readonly readFirstBy: string | null;
}

export interface RuleMatches {
  // Items on its account whose description contains its text and whose money
  // went a way it fits.
  readonly count: number;
  // Up to three of them, newest first.
  readonly examples: readonly MatchExample[];
  // Of them, how many a rule before it reads first (the first that matches wins).
  readonly readFirstByEarlier: number;
  // Of them, how many a rule after it read before, which it now reads.
  readonly takenFromLater: number;
}

// A change to the list: a rule added at the end, one changed in its place, one
// removed, or one moved a place up or down among the rules on its account
// (A27: only they can match the same item, and the first that fits wins).
export type BankRuleChange =
  | { readonly add: BankRuleSpec }
  | { readonly change: BankRuleSpec & { readonly id: string } }
  | { readonly remove: string }
  | { readonly move: { readonly id: string; readonly direction: 'up' | 'down' } };

// What a change would do, shown before he says yes: the rule as it would be,
// and what it would have matched in the last recentDays days (or, for a
// removal, what it matched).
export interface BankRulePreview {
  readonly action: 'add' | 'change' | 'remove' | 'move';
  readonly rule: BankRuleSpec;
  // For a change, the rule as it is now.
  readonly before: BankRule | null;
  // For a move (A27): the rule it would pass, and how many of the recent
  // items a different one of the two would read first (only items both fit
  // can change). Moving up, it would read them; moving down, the rule it
  // passes would.
  readonly move?: { readonly direction: 'up' | 'down'; readonly past: BankRule; readonly switching: number };
  // For a move, what it would match in its new place.
  readonly matches: RuleMatches;
  readonly recentDays: number;
  // Names exactly this preview. His yes carries it.
  readonly key: string;
}

export interface BankRuleRequest {
  // As for a choice: made once on the phone, sent again, the same, on a retry.
  readonly id: string;
  readonly bankRule: BankRuleChange;
  // His yes, with the key of the preview he saw.
  readonly confirmed?: boolean;
  readonly seen?: string;
}

export interface BankRuleDone {
  readonly action: 'added' | 'changed' | 'removed' | 'moved-up' | 'moved-down';
  // The rule as it is now; for a removal, as it was.
  readonly rule: BankRule;
}

export type BankRuleResponse =
  | { readonly ok: true; readonly replayed: boolean; readonly done: BankRuleDone }
  // Nothing was changed. With needs-confirmation, preview says what it would do.
  | { readonly ok: false; readonly code: RefusalCode; readonly why: string; readonly preview?: BankRulePreview };

// One change to the bank rules in the change log (13.5).
export type BankRuleLogLine =
  | {
      readonly date: IsoDate;
      readonly action: 'added' | 'changed' | 'removed';
      // The rule as it became; for a removal, as it was.
      readonly rule: BankRule;
      // For a change, the rule as it was.
      readonly before: BankRule | null;
      // How many lines the book's change log had when it was made (0 before
      // setup day), so the two read as one list, in the order things happened.
      readonly afterBookLines: number;
    }
  // A27: moved one place among the rules on its account, past another;
  // position is its place in the whole list now, from 1.
  | {
      readonly date: IsoDate;
      readonly action: 'moved-up' | 'moved-down';
      readonly rule: BankRule;
      readonly before: null;
      readonly past: BankRule;
      readonly position: number;
      readonly afterBookLines: number;
    };

// One suggestion on Setup day (20a), with his answer.
export interface SuggestionLine {
  readonly id: string;
  readonly label: string;
  readonly account: AccountId;
  readonly contains: string;
  readonly means: BankRule['means'];
  readonly other: AccountId | null;
  // What it matches in the whole history.
  readonly matches: RuleMatches;
  // open: not answered yet. added: added as suggested; changed: added as he
  // changed it (ruleId names the rule either way). skipped. covered: his bank
  // rules already read every item it matches this way, so nothing is asked.
  readonly status: 'open' | 'added' | 'changed' | 'skipped' | 'covered';
  readonly ruleId: string | null;
}
