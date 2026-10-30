import { ACCOUNTS, type AccountId } from './accounts.js';
import type { LeftoverAnswer, MoneyInReason, SpendingKind } from './book.js';
import type { Cents } from './cents.js';

// What can be done with an item waiting in review: the choices the rulebook
// gives for that kind of item. The screens show exactly these and never
// decide what a rule allows. review-options-agree.test.ts checks that the
// book accepts every choice offered here and refuses every other one.

// One tap. For money in, needs/wants/savings/momReserve mean "payback into
// that bucket" (6.1); for spending they mean "take it from that bucket".
export type PickTo = 'paycheck' | 'other-income' | 'savings' | 'needs' | 'wants' | 'momReserve' | 'not-mine' | 'mom';

export interface ReviewPick {
  readonly to: PickTo;
  // Final choices ask first ("this is my paycheck", B52).
  readonly final: boolean;
}

// What marking an item as a transfer with an account does: nothing to any
// bucket (5.1, 5.3); a payment to the old card from checking comes out of
// needs (5.2); one from savings waits for you to pick savings or needs (A4).
export type TransferOutcome = 'no-bucket-change' | 'out-of-needs' | 'savings-or-needs';

// A choice that exists for this kind of item but cannot be made right now.
export interface Unavailable {
  readonly what: 'paycheck' | 'transfer';
  readonly why: string;
}

export type ReviewOptions =
  | {
      readonly type: 'sort';
      // In the order to show them.
      readonly picks: readonly ReviewPick[];
      // Which buckets it can be split across (4.4, 7.6); null when it cannot be split.
      readonly split: readonly ('needs' | 'wants' | 'not-mine')[] | null;
      // Which of your accounts it can be marked a transfer with (5.6).
      readonly transfer: readonly AccountId[];
      // Which picks "always do this" can make a rule for (13.6); empty when none.
      readonly always: readonly PickTo[];
      readonly unavailable: readonly Unavailable[];
      // A18: the purchases a refund can be matched to (its likely purchases, 20d),
      // and A29: money in to checking too, which can be a store's refund to the
      // debit card. Matching is final.
      readonly match: readonly string[];
      // What marking it a transfer with each account does (5.6 with 5.1 to 5.3).
      readonly transferOutcome: Readonly<Partial<Record<AccountId, TransferOutcome>>>;
      // QUESTIONS.md A21: "It was not a payment to the old card", for a payment
      // you marked as going to the old card from savings. It brings back what
      // the bank sent. Its own choice: "needs" keeps meaning "out of needs" (A4).
      readonly unmark: boolean;
    }
  // 3.4
  | { readonly type: 'leftover'; readonly answers: readonly LeftoverAnswer[] }
  // 5.4: a flag to see, not money to sort.
  | { readonly type: 'acknowledge' };

// What the book knows about an item, without any rule applied to it yet.
export type ReviewFacts =
  | {
      readonly type: 'money-in';
      readonly reason: MoneyInReason;
      readonly account: 'checking' | 'savings' | 'everyday-card' | 'old-card';
      // B54: older than the last paycheck, so it cannot start a pay period.
      readonly olderThanLastPaycheck: boolean;
      // 20d: for a refund, or money in to checking (A29), the purchases it
      // likely belongs to.
      readonly likely: readonly string[];
    }
  | {
      readonly type: 'spending';
      readonly kind: SpendingKind;
      readonly fromSavings: boolean;
      // Where the money left from: a card, checking, or savings.
      readonly account: AccountId;
      readonly leavesAnAccount: boolean;
      readonly pending: boolean;
      readonly partlyRefunded: boolean;
      readonly countedAtSetup: boolean;
      readonly gone: boolean;
      readonly canBeForMom: boolean;
      // A21: a payment to the old card from savings that you marked by hand (5.6).
      readonly markedFromSavings: boolean;
      // What is left to sort (4.4 needs a part of at least a cent each).
      readonly net: Cents;
    }
  | { readonly type: 'leftover' }
  | { readonly type: 'old-card-purchase' };

const BUCKET_PAYBACKS: readonly PickTo[] = ['savings', 'needs', 'wants', 'momReserve'];

export function reviewOptions(facts: ReviewFacts): ReviewOptions {
  switch (facts.type) {
    case 'leftover':
      return { type: 'leftover', answers: ['roll-over', 'move-to-savings'] };
    case 'old-card-purchase':
      return { type: 'acknowledge' };
    case 'money-in':
      return moneyInOptions(facts);
    case 'spending':
      return spendingOptions(facts);
  }
}

const plain = (to: PickTo): ReviewPick => ({ to, final: false });

function moneyInOptions(f: Extract<ReviewFacts, { type: 'money-in' }>): ReviewOptions {
  const unavailable: Unavailable[] = [];
  const picks: ReviewPick[] = [];
  // 6.1: a refund the app could not match is payback or not mine, never income (B16).
  if (f.reason !== 'refund') {
    if (f.olderThanLastPaycheck) {
      unavailable.push({ what: 'paycheck', why: 'This deposit is older than your last paycheck, so it cannot start a new pay period. It can still be other income.' });
    } else {
      picks.push({ to: 'paycheck', final: true });
    }
    picks.push(plain('other-income'));
  }
  picks.push(...BUCKET_PAYBACKS.map(plain), plain('not-mine'));
  // 5.6: money arrives from checking or savings.
  const transfer = (['checking', 'savings'] as const).filter((a) => a !== f.account);
  return {
    type: 'sort',
    picks,
    split: null,
    transfer,
    transferOutcome: Object.fromEntries(transfer.map((a) => [a, 'no-bucket-change'])),
    // A18: a refund can be matched to a purchase it likely belongs to (4.5);
    // A29: so can money in to checking.
    match: [...f.likely],
    // 6.2, B17, B55: a deposit rule can pick anything but my paycheck, and an
    // early paycheck or a refund never gets a rule.
    always: f.reason === 'deposit' ? ['other-income', ...BUCKET_PAYBACKS, 'not-mine'] : [],
    unavailable,
    unmark: false,
  };
}

function spendingOptions(f: Extract<ReviewFacts, { type: 'spending' }>): ReviewOptions {
  // 5.2, A4: a payment to the old card from savings comes out of savings or needs.
  // A21: one you marked from savings can also be unmarked.
  if (f.kind === 'debt-payoff') return { type: 'sort', picks: [plain('savings'), plain('needs')], split: null, transfer: [], transferOutcome: {}, always: [], unavailable: [], match: [], unmark: f.markedFromSavings };

  const person = f.kind === 'person-payment';
  // 7.6, 7.7: a payment to a person, or money leaving checking or savings read
  // as a purchase. Not the difference on one counted on setup day (14.2), or
  // the money back on one the bank took back (4.10): those did not leave now.
  const notMine = person || (f.kind === 'purchase' && f.leavesAnAccount && !f.countedAtSetup && !f.gone);
  const picks: ReviewPick[] = [plain('needs'), plain('wants')];
  if (notMine) picks.push(plain('not-mine'));
  if (person && f.canBeForMom) picks.push(plain('mom'));
  // 4.4: parts of at least a cent each. 8.3, B23: the difference on a mom payment goes to one bucket.
  const canSplit = f.kind !== 'mom-difference' && f.net >= 2;
  // The last one gets the rest on the screen: on a purchase (7.7) it stays Wants, as before Not mine was offered.
  const parts = person ? (['needs', 'wants', 'not-mine'] as const) : notMine ? (['needs', 'not-mine', 'wants'] as const) : (['needs', 'wants'] as const);
  const split = canSplit ? parts : null;

  // 5.6, B74: only a purchase or a payment to a person, that left checking or
  // savings, once it has posted and nothing of it was refunded or counted on setup day.
  let transfer: AccountId[] = [];
  const unavailable: Unavailable[] = [];
  if (f.leavesAnAccount && (f.kind === 'purchase' || person)) {
    if (f.pending) unavailable.push({ what: 'transfer', why: 'It is still pending. Mark it as a transfer once it posts.' });
    else if (f.gone) unavailable.push({ what: 'transfer', why: 'The bank took it back, so it cannot be marked a transfer.' });
    else if (f.countedAtSetup) unavailable.push({ what: 'transfer', why: 'Part of it was counted on setup day, so it cannot be marked a transfer.' });
    else if (f.partlyRefunded) unavailable.push({ what: 'transfer', why: 'Part of it was refunded, so it cannot be marked a transfer.' });
    else transfer = ACCOUNTS.filter((a) => a !== f.account);
  }

  // 13.6, 4.9: a purchase rule picks needs or wants; a person rule picks any
  // of its choices; fees, mom differences, and money out of savings get none.
  let always: PickTo[] = [];
  if (f.kind === 'purchase' && !f.fromSavings) always = ['needs', 'wants'];
  if (person) always = picks.map((p) => p.to);

  // 5.6: as the half of a transfer that left: to the old card it is a payment
  // to the old card (5.2); anywhere else no bucket changes (5.1, 5.3).
  const outcome = (to: AccountId): TransferOutcome => (to !== 'old-card' ? 'no-bucket-change' : f.account === 'checking' ? 'out-of-needs' : 'savings-or-needs');
  const transferOutcome = Object.fromEntries(transfer.map((a) => [a, outcome(a)]));
  return { type: 'sort', picks, split, transfer, transferOutcome, always, unavailable, match: [], unmark: false };
}
