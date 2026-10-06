import { addCents, assertCents, assertCentsAtLeastZero, type Cents } from './cents.js';
import { assertIsoDate, daysBetween, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import type { Settings } from './settings.js';

// Rulebook section 9: what the card reminders say, and when. Sending them
// to the phone is Phase 5; this only works out what is due on a given day.

export interface CardStatement {
  readonly card: 'everyday-card' | 'old-card';
  // The statement date. Payments after it count toward this statement.
  readonly closingDate: IsoDate;
  readonly dueDate: IsoDate;
  readonly statementBalance: Cents;
  readonly minimumPayment: Cents;
}

export interface CardPayment {
  readonly date: IsoDate;
  readonly amount: Cents;
}

export type CardNotice =
  | {
      readonly kind: 'reminder';
      readonly card: 'everyday-card';
      readonly daysBefore: number;
      readonly dueDate: IsoDate;
      readonly statementBalance: Cents;
      readonly minimumPayment: Cents;
    }
  | {
      readonly kind: 'reminder';
      readonly card: 'old-card';
      readonly daysBefore: number;
      readonly dueDate: IsoDate;
      readonly minimumPayment: Cents;
    }
  | {
      readonly kind: 'overdue';
      readonly card: 'everyday-card' | 'old-card';
      readonly dueDate: IsoDate;
      readonly minimumPayment: Cents;
    };

export function cardNotices(today: IsoDate, statement: CardStatement, payments: readonly CardPayment[], settings: Settings): CardNotice[] {
  assertIsoDate(today, 'today');
  checkStatement(statement);
  const { card, closingDate, dueDate, statementBalance, minimumPayment } = statement;
  // 9.3: what has to be paid for the reminders to stop. On the everyday card
  // that is the full statement balance (paying less means interest on the
  // rest); on the old card it is the minimum.
  const toPay = card === 'everyday-card' ? statementBalance : minimumPayment;
  if (toPay <= 0) return [];
  // Payments the app has seen for this statement: after its date, up to today.
  const seen = payments.filter((p) => {
    assertIsoDate(p.date, 'payment date');
    assertCents(p.amount, 'payment amount');
    return daysBetween(closingDate, p.date) > 0 && daysBetween(p.date, today) >= 0;
  });
  const daysLeft = daysBetween(today, dueDate);
  if (daysLeft < 0) {
    // 9.4: the due date passed with no payment seen, and something was due.
    return seen.length === 0 && minimumPayment > 0 ? [{ kind: 'overdue', card, dueDate, minimumPayment }] : [];
  }
  const paidInFull =
    card === 'everyday-card'
      ? addCents(0, ...seen.map((p) => p.amount)) >= statementBalance
      : seen.some((p) => p.amount >= minimumPayment);
  if (paidInFull) return [];
  if (!settings.cardReminderDaysBefore.includes(daysLeft)) return [];
  // 9.1 and 9.2: the everyday card shows its statement balance; the old card does not.
  return card === 'everyday-card'
    ? [{ kind: 'reminder', card, daysBefore: daysLeft, dueDate, statementBalance, minimumPayment }]
    : [{ kind: 'reminder', card, daysBefore: daysLeft, dueDate, minimumPayment }];
}

function checkStatement(statement: CardStatement): void {
  if (statement.card !== 'everyday-card' && statement.card !== 'old-card') {
    throw new MoneyError('bad-statement', `reminders are for the everyday card or the old card, not ${String(statement.card)}`);
  }
  assertIsoDate(statement.closingDate, 'statement date');
  assertIsoDate(statement.dueDate, 'due date');
  if (daysBetween(statement.closingDate, statement.dueDate) < 0) throw new MoneyError('bad-statement', 'the due date is before the statement date');
  assertCents(statement.statementBalance, 'statement balance');
  assertCentsAtLeastZero(statement.minimumPayment, 'minimum payment');
}

// Rule 9.5. The promo end date is not known yet (rulebook section 16), and
// how to count the paychecks left and round the amount is an open question
// (QUESTIONS.md A7), so the countdown stays off either way for now.
export type PayoffCountdown = { readonly on: false; readonly reason: 'no-promo-end-date' | 'waiting-on-rule' };

export function payoffCountdown(book: { settings(): Settings }, today: IsoDate): PayoffCountdown {
  assertIsoDate(today, 'today');
  if (book.settings().oldCardPromoEndDate === null) return { on: false, reason: 'no-promo-end-date' };
  return { on: false, reason: 'waiting-on-rule' };
}
