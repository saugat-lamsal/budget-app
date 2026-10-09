import type { AccountId } from '@budget-app/money';
import type { BankRule, HalfLine, SetupMissing } from '@budget-app/server/views';
import { shortDate } from '../ui/dates.js';

// Words on the Setup day screens (rulebook section 14). Every amount comes
// from the money math on the server; these only name things.

export const ACCOUNT_NAMES: Readonly<Record<AccountId, string>> = {
  checking: 'Checking',
  savings: 'Savings',
  'everyday-card': 'Everyday card',
  'old-card': 'Old card',
};

// B48: what the bank shows of a transfer with one half showing.
export function halfText(half: HalfLine): string {
  if (half.kind === 'left') return `Left ${ACCOUNT_NAMES[half.from].toLowerCase()} on ${shortDate(half.date)} for the ${ACCOUNT_NAMES[half.to].toLowerCase()}. It does not show arriving yet.`;
  return `Arrived in ${ACCOUNT_NAMES[half.to].toLowerCase()} on ${shortDate(half.date)} from ${ACCOUNT_NAMES[half.from].toLowerCase()}. ${ACCOUNT_NAMES[half.from]} does not show it leaving yet.`;
}

// Why saying it is on its way changes the starting money as it does (B48).
export function effectLead(half: HalfLine): string {
  if (half.effect > 0) return `It left ${ACCOUNT_NAMES[half.from].toLowerCase()} and has not arrived, so no balance shows it.`;
  if (half.effect < 0) return `${ACCOUNT_NAMES[half.from]} still holds it, and it shows arrived too.`;
  return "Either way it doesn't change the starting money: the old card is not part of it.";
}

export function answerText(onItsWay: boolean | null): string {
  if (onItsWay === null) return 'Not answered yet';
  return onItsWay ? 'Your answer: on its way' : 'Your answer: not on its way';
}

// Section 2: a bank rule, in a sentence.
export function bankRuleText(rule: BankRule): string {
  const on = `“${rule.contains}” on ${ACCOUNT_NAMES[rule.account].toLowerCase()}`;
  switch (rule.means) {
    case 'transfer':
      return `${on}: a transfer with the ${ACCOUNT_NAMES[rule.other].toLowerCase()}`;
    case 'payment-to-person':
      return `${on}: a payment to a person`;
    case 'card-fee':
      return `${on}: a card fee`;
    case 'card-interest':
      return `${on}: card interest`;
  }
}

// 14.3: what still stops tracking from starting, in words.
export function missingText(missing: SetupMissing, unanswered: number): string {
  switch (missing) {
    case 'halves':
      return `Say whether ${unanswered === 1 ? 'the transfer is' : `each of ${unanswered} transfers is`} on its way.`;
    case 'last-paycheck':
      return 'Enter the date of your last paycheck.';
    case 'assignment':
      return 'Hand out the starting money to the cent.';
  }
}

export function stepCount(index: number, of: number): string {
  return `Step ${index + 1} of ${of}`;
}
