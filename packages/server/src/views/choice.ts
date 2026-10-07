import type { AccountId, Cents, LeftoverAnswer, PickTo } from '@budget-app/money';

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
  | { readonly acknowledge: true };

export interface ChoiceRequest {
  // Made once on the phone for this decision, and sent again, the same, on a
  // retry. The server answers a repeat with the first answer and changes
  // nothing.
  readonly id: string;
  // The item waiting in review.
  readonly item: string;
  readonly choice: ChoiceOf;
  // "Always do this" (13.6): a rule that makes this the answer for anything
  // whose description contains this text.
  readonly always?: { readonly contains: string };
  // He said yes to "are you sure". Needed for anything final.
  readonly confirmed?: boolean;
}

// What was done.
export interface Done {
  readonly item: string;
  // The choice, with a split's "rest" filled in.
  readonly choice: ChoiceOf;
  // With "always do this": other waiting items the new rule sorted too (13.2).
  readonly alsoSorted: number;
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
