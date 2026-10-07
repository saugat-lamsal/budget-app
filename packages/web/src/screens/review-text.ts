import type { AccountId, PickTo, ReviewDetail, SpendingSort } from '@budget-app/money';
import type { ChoiceOf, Done } from '@budget-app/server/views';
import { moneyText } from '../ui/money-format.js';

// Words on the Review screen: what each waiting item is, what each choice
// is called, and what was done. The screen shows what the money math offers;
// these are only its names.

export const ACCOUNT_NAMES: Readonly<Record<AccountId, string>> = {
  checking: 'Checking',
  savings: 'Savings',
  'everyday-card': 'Everyday card',
  'old-card': 'Old card',
};

export const BUCKET_NAMES: Readonly<Record<string, string>> = {
  savings: 'Savings',
  needs: 'Needs',
  wants: 'Wants',
  momReserve: 'Mom reserve',
  'not-mine': 'Not mine',
};

type Item = ReviewDetail['item'];

export function groupTitle(type: Item['type']): string {
  switch (type) {
    case 'leftover':
      return 'Payday questions';
    case 'money-in':
      return 'Money in';
    case 'spending':
      return 'Spending';
    case 'old-card-purchase':
      return 'Old card';
  }
}

// What the item is, and why it waits (4.2 to 4.9, 5.2, 5.4, 6.1, 3.7, 8.3, 14.2).
export function reasonText(item: Item): string {
  switch (item.type) {
    case 'leftover':
      return 'Left over at payday';
    case 'old-card-purchase':
      return 'New purchase on the old card';
    case 'money-in':
      return item.reason === 'refund' ? 'Refund the bank did not match to a purchase' : item.reason === 'early-paycheck' ? 'Looks like a paycheck, but it came early' : 'Deposit';
    case 'spending':
      switch (item.reason) {
        case 'no-rule':
          return 'No rule matched';
        case 'from-savings':
          return 'Money out of savings';
        case 'card-fee':
          return 'Card fee';
        case 'card-interest':
          return 'Card interest';
        case 'split-changed':
          return 'The split no longer adds up';
        case 'old-card-from-savings':
          return 'Payment to the old card from savings';
        case 'person-payment':
          return 'Payment to a person';
        case 'mom-difference':
          return 'Left over from a mom payment bigger than the reserve';
        case 'setup-difference':
          return 'Different from what was counted on setup day';
      }
  }
}

export function titleOf(item: Item): string {
  if (item.type === 'leftover') return `${BUCKET_NAMES[item.bucket] ?? item.bucket} leftover`;
  return item.description;
}

// A choice's name on a button or a row. For money in, a bucket is a payback
// into it (6.1); for spending it is the bucket the spending comes out of.
export function pickLabel(kind: 'money-in' | 'spending', to: PickTo, short = false): string {
  const bucket = BUCKET_NAMES[to] ?? to;
  if (to === 'paycheck') return 'This is my paycheck';
  if (to === 'other-income') return 'Other income';
  if (to === 'not-mine') return 'Not mine';
  if (to === 'mom') return 'For mom';
  if (kind === 'money-in') return short ? `Into ${bucket}` : `Payback into ${bucket}`;
  return bucket;
}

// Where a purchase went, for the likely purchases of a refund.
export function sortedWords(sorted: SpendingSort): string {
  if ('split' in sorted) return `Split: ${sorted.split.map((p) => `${BUCKET_NAMES[p.bucket] ?? p.bucket} ${moneyText(p.amount)}`).join(', ')}`;
  switch (sorted.to) {
    case 'unsorted':
      return 'Not sorted yet';
    case 'counted-at-setup':
      return 'Counted on setup day';
    default:
      return `In ${BUCKET_NAMES[sorted.to] ?? sorted.to}`;
  }
}

// What was done, said back to him (after "Done" from the server).
export function doneText(label: string, kind: 'money-in' | 'spending' | 'leftover' | 'old-card-purchase', done: Done): string {
  const c: ChoiceOf = done.choice;
  let text: string;
  if ('to' in c) {
    if (c.to === 'paycheck') text = `${label} is your paycheck. A new pay period started.`;
    else if (c.to === 'other-income') text = `${label} counted as other income.`;
    else if (c.to === 'not-mine') text = kind === 'money-in' ? `${label} is held for others.` : `${label} marked not mine.`;
    else if (c.to === 'mom') text = `${label} marked for mom.`;
    else if (kind === 'money-in') text = `${label} put back into ${BUCKET_NAMES[c.to] ?? c.to}.`;
    else if (c.to === 'savings') text = `${label} taken out of Savings.`;
    else text = `${label} sorted to ${BUCKET_NAMES[c.to] ?? c.to}.`;
  } else if ('split' in c) {
    text = `${label} split: ${c.split.map((p) => `${BUCKET_NAMES[p.bucket] ?? p.bucket} ${p.amount === 'rest' ? 'the rest' : moneyText(p.amount)}`).join(', ')}.`;
  } else if ('transfer' in c) {
    text = `${label} marked as a transfer with ${ACCOUNT_NAMES[c.transfer]}.`;
  } else if ('leftover' in c) {
    text = c.leftover === 'roll-over' ? `${label} kept for this pay period.` : `${label} moved to Savings.`;
  } else {
    text = `Seen: ${label}.`;
  }
  if (done.alsoSorted > 0) text += ` ${done.alsoSorted} other waiting ${done.alsoSorted === 1 ? 'item' : 'items'} matched and ${done.alsoSorted === 1 ? 'was' : 'were'} sorted too.`;
  if (done.sticks === true) text += ' From now on it goes there by itself.';
  if (done.sticks === false) text += ' The text only matches how it looked after it posted, so a new one may still wait while it is pending.';
  return text;
}
