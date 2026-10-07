import { bucketLevel, cardNotices, type BankBalances, type Book, type BucketLevel, type CardStatement, type Cents, type IsoDate, type SelfCheck } from '@budget-app/money';

// What the Home screen shows, worked out on the server from the book. The
// screen only formats it: every number here comes from the money math, in
// whole cents, and is sent to the phone as JSON.

export interface HomeInput {
  readonly today: IsoDate;
  // Null before setup day (section 14).
  readonly book: Book | null;
  // Today's balances as the bank reports them, pending charges included
  // (12.1). Null when the bank could not be read.
  readonly bank: BankBalances | null;
  // 10.5: the bank connection needs him to log in again.
  readonly needsLogin: boolean;
  // The latest statement of each card, for the card reminders (section 9).
  readonly statements: readonly CardStatement[];
  // True only for the demo's made-up numbers, so the screen can say so.
  readonly madeUpData: boolean;
}

export type HomeView =
  | { readonly state: 'not-set-up'; readonly madeUpData: boolean }
  | {
      readonly state: 'tracking';
      readonly madeUpData: boolean;
      readonly today: IsoDate;
      readonly safeToSpend: SafeToSpendView;
      // 11.2: negative days when the paycheck is late (B35).
      readonly payday: { readonly next: IsoDate; readonly days: number };
      // Most urgent first.
      readonly attention: readonly Attention[];
      readonly buckets: { readonly needs: BucketBar; readonly wants: BucketBar };
      // Everything waiting in review (B32), for the Review tab's badge.
      readonly waitingInReview: number;
    };

export type SafeToSpendView =
  // 11.1: wants left, minus unsorted spending.
  | { readonly shown: true; readonly amount: Cents }
  // 0.5: the totals do not match the bank, so the number is held back and
  // the self-check is shown instead (12.3, B37).
  | { readonly shown: false; readonly why: 'totals-do-not-match'; readonly check: SelfCheck }
  // The bank could not be read, so the number cannot be checked.
  | { readonly shown: false; readonly why: 'bank-not-read' };

export interface BucketBar {
  readonly left: Cents;
  // 10.1: what the bucket started this pay period with.
  readonly startedWith: Cents;
  readonly level: BucketLevel;
}

export type Attention =
  // 10.5
  | { readonly kind: 'bank-login' }
  // 9.4: the due date passed with less than the minimum paid.
  | { readonly kind: 'card-overdue'; readonly card: 'everyday-card' | 'old-card'; readonly dueDate: IsoDate; readonly minimumPayment: Cents }
  // 10.3: something waits in review. heldBack is the unsorted spending kept
  // out of safe to spend (4.3).
  | { readonly kind: 'review'; readonly waiting: number; readonly heldBack: Cents }
  // 3.8: money still to move into the savings account.
  | {
      readonly kind: 'move-to-savings';
      readonly stillToMove: Cents;
      readonly shouldBeInSavings: Cents;
      readonly savingsAccountBalance: Cents;
    }
  // 9.1: a reminder day for the everyday card.
  | {
      readonly kind: 'card-due';
      readonly card: 'everyday-card';
      readonly dueDate: IsoDate;
      readonly daysLeft: number;
      readonly statementBalance: Cents;
      readonly minimumPayment: Cents;
    }
  // 9.2: a reminder day for the old card.
  | { readonly kind: 'card-due'; readonly card: 'old-card'; readonly dueDate: IsoDate; readonly daysLeft: number; readonly minimumPayment: Cents };

export function homeView(input: HomeInput): HomeView {
  const { today, book, bank, madeUpData } = input;
  if (book === null) return { state: 'not-set-up', madeUpData };

  const settings = book.settings();
  const pots = book.pots();
  const started = book.startedPeriodWith();
  const bar = (left: Cents, startedWith: Cents): BucketBar => ({ left, startedWith, level: bucketLevel(left, startedWith, settings.lowBucketAlertPercent) });

  const plain = book.safeToSpend(today);
  let safeToSpend: SafeToSpendView;
  if (bank === null) safeToSpend = { shown: false, why: 'bank-not-read' };
  else {
    // 0.5: only a number the self-check backs up is shown.
    const checked = book.checkedSafeToSpend(today, bank);
    safeToSpend = checked.ok ? { shown: true, amount: checked.safeToSpend.amount } : { shown: false, why: 'totals-do-not-match', check: book.selfCheck(bank) };
  }

  const notices = input.statements.flatMap((statement) => cardNotices(today, statement, book.cardPayments(statement.card), settings));
  const attention: Attention[] = [];
  if (input.needsLogin) attention.push({ kind: 'bank-login' });
  for (const n of notices) {
    if (n.kind === 'overdue') attention.push({ kind: 'card-overdue', card: n.card, dueDate: n.dueDate, minimumPayment: n.minimumPayment });
  }
  const waitingInReview = book.reviewItems().length;
  if (waitingInReview > 0) attention.push({ kind: 'review', waiting: waitingInReview, heldBack: pots.unsortedOut });
  if (bank !== null) {
    const move = book.savingsTransfer(bank.savings);
    if (move.stillToMove > 0) {
      attention.push({
        kind: 'move-to-savings',
        stillToMove: move.stillToMove,
        shouldBeInSavings: move.shouldBeInSavings,
        savingsAccountBalance: move.savingsAccountBalance,
      });
    }
  }
  for (const n of notices) {
    if (n.kind !== 'reminder') continue;
    attention.push(
      n.card === 'everyday-card'
        ? { kind: 'card-due', card: n.card, dueDate: n.dueDate, daysLeft: n.daysBefore, statementBalance: n.statementBalance, minimumPayment: n.minimumPayment }
        : { kind: 'card-due', card: n.card, dueDate: n.dueDate, daysLeft: n.daysBefore, minimumPayment: n.minimumPayment },
    );
  }

  return {
    state: 'tracking',
    madeUpData,
    today,
    safeToSpend,
    payday: { next: plain.nextPayday, days: plain.daysToPayday },
    attention,
    buckets: { needs: bar(pots.needs, started.needs), wants: bar(pots.wants, started.wants) },
    waitingInReview,
  };
}
