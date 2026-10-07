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
  return {
    type: 'sort',
    picks,
    split: null,
    // 5.6: money arrives from checking or savings.
    transfer: (['checking', 'savings'] as const).filter((a) => a !== f.account),
    // 6.2, B17, B55: a deposit rule can pick anything but my paycheck, and an
    // early paycheck or a refund never gets a rule.
    always: f.reason === 'deposit' ? ['other-income', ...BUCKET_PAYBACKS, 'not-mine'] : [],
    unavailable,
  };
}

function spendingOptions(f: Extract<ReviewFacts, { type: 'spending' }>): ReviewOptions {
  // 5.2, A4: a payment to the old card from savings comes out of savings or needs.
  if (f.kind === 'debt-payoff') return { type: 'sort', picks: [plain('savings'), plain('needs')], split: null, transfer: [], always: [], unavailable: [] };

  const person = f.kind === 'person-payment';
  const picks: ReviewPick[] = [plain('needs'), plain('wants')];
  if (person) {
    picks.push(plain('not-mine'));
    if (f.canBeForMom) picks.push(plain('mom'));
  }
  // 4.4: parts of at least a cent each. 8.3, B23: the difference on a mom payment goes to one bucket.
  const canSplit = f.kind !== 'mom-difference' && f.net >= 2;
  const split = canSplit ? (person ? (['needs', 'wants', 'not-mine'] as const) : (['needs', 'wants'] as const)) : null;

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

  return { type: 'sort', picks, split, transfer, always, unavailable };
}
