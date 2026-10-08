import type { AccountId, Cents, ConfirmReason, LeftoverAnswer, PickTo, Pot } from '@budget-app/money';

// How a tap reaches the books. The screen sends the choice it was offered;
// the server hands it to the money math, which decides. Types only, so the
// phone can share them with the server.

// A part of a split (4.4, 7.6). 'rest' is whatever the other parts leave: the
// money math works it out, so the screen never subtracts.
export interface ChoicePart {
  readonly bucket: 'needs' | 'wants' | 'not-mine';
  readonly amount: Cents | 'rest';
}

export type ChoiceOf =
  // One tap: a bucket, other income, my paycheck, not mine, for mom.
  | { readonly to: PickTo }
  | { readonly split: readonly ChoicePart[] }
  // "Transfer between my accounts" (5.6), with that account.
  | { readonly transfer: AccountId }
  // The leftover question at payday (3.4).
  | { readonly leftover: LeftoverAnswer }
  // Seen the flag for a new purchase on the old card (5.4).
  | { readonly acknowledge: true }
  // "This refund is for this one" (4.5, QUESTIONS.md A18): one of the likely
  // purchases offered for a refund.
  | { readonly refundOf: string };

export interface ChoiceRequest {
  // Made once on the phone for this decision, and sent again, the same, on a
  // retry. The server answers a repeat with the first answer and changes
  // nothing.
  readonly id: string;
  // The item waiting in review, or, with resort, an item sorted already.
  readonly item: string;
  readonly choice: ChoiceOf;
  // "Always do this" (13.6): a rule that makes this the answer for anything
  // whose description contains this text.
  readonly always?: { readonly contains: string };
  // He said yes to "are you sure". Needed for anything final.
  readonly confirmed?: boolean;
  // Sorting something again from the list of what went in and out of a
  // bucket (4.7, QUESTIONS.md B100): the item may be one that is not waiting
  // in review. Without it, only an item waiting in review can be sorted.
  readonly resort?: true;
}

// What was done.
export interface Done {
  readonly item: string;
  // The choice, with a split's "rest" filled in.
  readonly choice: ChoiceOf;
  // With "always do this": other waiting items the new rule sorted too (13.2).
  readonly alsoSorted: number;
  // With "always do this": waiting items the rule matched but could not sort,
  // left exactly as they were (13.2, QUESTIONS.md A19). Empty otherwise.
  readonly stillWaiting: readonly { readonly item: string; readonly name: string }[];
  // With "always do this": whether the next one arriving the same way will go
  // here by itself (13.6, B49). Null without "always do this".
  readonly sticks: boolean | null;
}

export type RefusalCode =
  // Final choices need his OK first.
  | 'needs-confirmation'
  // The item is not waiting any more: it was dealt with already.
  | 'not-waiting'
  // The decision number was used for a different choice.
  | 'id-reused'
  // The money math refused it.
  | 'refused';

export type ChoiceResponse =
  | { readonly ok: true; readonly replayed: boolean; readonly done: Done }
  // Nothing was changed. why is for him to read.
  | { readonly ok: false; readonly code: RefusalCode; readonly why: string };

// ----- Moving money between buckets by hand (13.3, 13.4; B103) -----

export interface Moved {
  readonly from: Pot;
  readonly to: Pot;
  readonly amount: Cents;
}

export interface MoveRequest {
  // As for a choice: made once, sent again, the same, on a retry.
  readonly id: string;
  readonly move: Moved;
  // He said yes to "are you sure" (13.4): money out of savings or the mom
  // reserve, or a move that would leave a bucket below zero.
  readonly confirmed?: boolean;
}

export type MoveResponse =
  | { readonly ok: true; readonly replayed: boolean; readonly moved: Moved }
  // Nothing was changed. With needs-confirmation, reasons says why it asks
  // (the money math's, 13.4).
  | { readonly ok: false; readonly code: RefusalCode; readonly why: string; readonly reasons?: readonly ConfirmReason[] };
