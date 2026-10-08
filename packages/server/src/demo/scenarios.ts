import {
  DEFAULT_SETTINGS,
  addCents,
  changeSettings,
  openBook,
  subtractCents,
  type BankBalances,
  type Book,
  type CardStatement,
  type Cents,
  type IsoDate,
  type Purchase,
  type SortingRule,
} from '@budget-app/money';
import type { HomeInput } from '../views/home.js';

// Made-up lives for the demo (npm run demo) and the browser tests. Every
// name, amount, and date here is invented. Each one is played through the
// real money math: setup day, a paycheck, purchases, a payment to mom. The
// demo never reads the database or talks to the bank (a test checks).

const EMPLOYER = 'MADE UP EMPLOYER PAYROLL';
const MOM = 'MADE UP MOM';

const SETTINGS = changeSettings(DEFAULT_SETTINGS, { paycheckRule: { contains: EMPLOYER }, momRule: { contains: MOM } });

const RULES: readonly SortingRule[] = [
  { id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
  { id: 'gas', for: 'purchase', contains: 'GAS STATION', bucket: 'needs' },
  { id: 'coffee', for: 'purchase', contains: 'COFFEE', bucket: 'wants' },
  { id: 'restaurant', for: 'purchase', contains: 'RESTAURANT', bucket: 'wants' },
  { id: 'streaming', for: 'purchase', contains: 'STREAMING', bucket: 'wants' },
];

const SETUP_DAY: IsoDate = '2026-09-19';
const PAYDAY: IsoDate = '2026-10-02';
// The demo's today: Wednesday, Oct 7, 2026. The next payday is Oct 16.
export const DEMO_TODAY: IsoDate = '2026-10-07';

// The everyday card's statement, due a week from the demo's today (9.1).
const EVERYDAY_STATEMENT: CardStatement = {
  card: 'everyday-card',
  closingDate: '2026-09-16',
  dueDate: '2026-10-14',
  statementBalance: 61_248,
  minimumPayment: 3_500,
};
const OLD_CARD_STATEMENT: CardStatement = {
  card: 'old-card',
  closingDate: '2026-09-25',
  dueDate: '2026-10-22',
  statementBalance: 298_000,
  minimumPayment: 4_000,
};
// An old card statement whose due date has passed unpaid (9.4).
const OLD_CARD_OVERDUE: CardStatement = { ...OLD_CARD_STATEMENT, closingDate: '2026-09-05', dueDate: '2026-10-03' };

interface Story {
  readonly today?: IsoDate;
  // Every amount times this, for the very large numbers.
  readonly scale?: number;
  // More eating out after payday, to bring wants down.
  readonly eatingOut?: Cents;
  // Sort what waits in review, pay the card in full, and move the money to savings.
  readonly allDone?: boolean;
  // The bank shows this much more (or, negative, less) than the app (0.5).
  readonly bankOff?: Cents;
  readonly needsLogin?: boolean;
  readonly statements?: readonly CardStatement[];
  // A restaurant charge the bank shows twice, then takes the copy back (4.10).
  readonly chargedTwice?: boolean;
  // The bank cannot be read today; it was last checked this morning (0.5).
  readonly bankNotRead?: boolean;
  // One of every kind of thing waiting in Review, the payday questions
  // unanswered (for the Review screen).
  readonly reviewBusy?: boolean;
  // More to see on Buckets: money held for a roommate, and mom paid this
  // month within the target.
  readonly bucketsBusy?: boolean;
  // One of every kind of row on the lists of what went in and out of each
  // bucket (B97 to B100): a tip after payday, a purchase counted late, a
  // split, a refund, money in, a hand move, a leftover moved to savings.
  readonly activityBusy?: boolean;
  // The second paycheck has just come in (for the Payday screen): the
  // leftover questions are open and the new paycheck's share is not in the
  // savings account yet.
  readonly secondPaycheck?: boolean;
}

// When the bank was last read and matched, in the "bank-not-read" life:
// 7:15 in the morning, Central time.
const LAST_CHECKED_AT = '2026-10-07T07:15:00-05:00';

function story(s: Story): HomeInput {
  const x = (cents: Cents): Cents => cents * (s.scale ?? 1);
  const book = openBook({
    date: SETUP_DAY,
    pots: { savings: x(820_000), needs: x(31_250), wants: x(18_400), momReserve: x(120_000), heldForOthers: 0 },
    oldCardDebt: x(298_000),
    lastPaycheckDate: '2026-09-18',
    settings: SETTINGS,
    rules: RULES,
  });
  let n = 0;
  const buy = (date: IsoDate, amount: Cents, description: string, account: Purchase['account'] = 'everyday-card', pending = false): string => {
    const id = `demo-${(n += 1)}`;
    book.receive({ kind: 'purchase', id, account, date, amount: x(amount), description, pending });
    return id;
  };

  buy('2026-09-22', 6_412, 'GROCERY OUTLET #12', 'checking');
  buy('2026-09-26', 575, 'BLUE DOOR COFFEE');
  // A coffee still pending the day before payday, which posts after it with a tip.
  const pendingCoffee = s.activityBusy === true ? buy('2026-10-01', 450, 'BLUE DOOR COFFEE', 'everyday-card', true) : '';
  book.receive({ kind: 'deposit', id: 'demo-pay', account: 'checking', date: PAYDAY, amount: x(420_000), description: `${EMPLOYER} DIR DEP` });
  for (const item of book.reviewItems()) {
    // On the busy lists, needs' leftover is moved to savings, so that row is there to see.
    const answer = s.activityBusy === true && item.type === 'leftover' && item.bucket === 'needs' ? 'move-to-savings' : 'roll-over';
    if (item.type === 'leftover' && s.reviewBusy !== true) book.answerLeftover(item.id, answer, PAYDAY);
  }
  book.receive({ kind: 'payment-to-person', id: 'demo-mom', account: 'checking', date: '2026-10-03', amount: x(50_000), description: `ZELLE TO ${MOM}` });
  const groceryRun = buy('2026-10-03', 8_643, 'GROCERY OUTLET #12', 'checking');
  const gasRun = buy('2026-10-04', 4_120, 'CORNER GAS STATION');
  buy('2026-10-05', 3_890, 'MAIN ST RESTAURANT');
  if (s.chargedTwice === true) {
    const copy = buy('2026-10-05', 3_890, 'MAIN ST RESTAURANT');
    book.receive({ kind: 'taken-back', id: 'demo-correction', takenId: copy, date: '2026-10-06', description: 'CORRECTION' });
  }
  buy('2026-10-05', 1_599, 'STREAMING SERVICE');
  if (s.eatingOut !== undefined) buy('2026-10-06', s.eatingOut, 'HARBOR RESTAURANT');
  const unsorted = [buy('2026-10-06', 2_317, 'ONLINE MARKETPLACE'), buy('2026-10-06', 1_150, 'CORNER STORE')];
  // What the extras take out of the savings account and put on the everyday card.
  let savingsOut = 0;
  let cardExtra = 0;
  if (s.bucketsBusy === true) {
    // A roommate's share of the rent, held until he passes it on (7.1).
    book.receive({ kind: 'deposit', id: 'busy-roommate', account: 'checking', date: '2026-10-05', amount: x(12_000), description: 'ZELLE FROM MADE UP ROOMMATE' });
    book.sort('busy-roommate', { to: 'not-mine' }, DEMO_TODAY);
    // Mom again: 2,500.00 for the month so far, inside the 2,000.00 to 3,000.00 target (8.2).
    book.receive({ kind: 'payment-to-person', id: 'busy-mom', account: 'checking', date: '2026-10-06', amount: x(200_000), description: `ZELLE TO ${MOM}` });
  }
  if (s.activityBusy === true) {
    // The coffee posts after payday with a tip: 1.25 more than it showed, counted in this pay period (B97).
    book.receive({ kind: 'purchase', id: 'act-coffee-posted', account: 'everyday-card', date: '2026-10-03', amount: x(575), description: 'BLUE DOOR COFFEE', pending: false, pendingId: pendingCoffee });
    cardExtra += 575;
    // Something bought the day before payday that is first seen after it (B4).
    buy('2026-10-01', 2_150, 'GROCERY OUTLET #12', 'checking');
    // A split purchase, and part of a grocery run refunded (4.4, 4.5).
    book.receive({ kind: 'purchase', id: 'act-hardware', account: 'checking', date: '2026-10-04', amount: x(9_000), description: 'HARDWARE SUPERSTORE', pending: false });
    book.sort('act-hardware', { split: [{ bucket: 'needs', amount: x(6_000) }, { bucket: 'wants', amount: x(3_000) }] }, DEMO_TODAY);
    book.receive({ kind: 'refund', id: 'act-refund', account: 'checking', date: '2026-10-05', amount: x(1_500), description: 'GROCERY OUTLET #12 REFUND', refundOf: groceryRun });
    // The gas station run was really wants: sorted again by hand (4.7).
    book.sort(gasRun, { to: 'wants' }, DEMO_TODAY);
    // A card fee, sorted to needs (4.8).
    book.receive({ kind: 'card-charge', id: 'act-fee', account: 'everyday-card', date: '2026-10-04', amount: x(3_500), description: 'LATE FEE', charge: 'fee' });
    book.sort('act-fee', { to: 'needs' }, DEMO_TODAY);
    cardExtra += 3_500;
    // Money in: a friend paying back, a side job, and a roommate's share (6.1, 7.1).
    book.receive({ kind: 'deposit', id: 'act-payback', account: 'checking', date: '2026-10-05', amount: x(5_000), description: 'ZELLE FROM MADE UP FRIEND' });
    book.sort('act-payback', { to: 'wants' }, DEMO_TODAY);
    book.receive({ kind: 'deposit', id: 'act-side', account: 'checking', date: '2026-10-06', amount: x(25_000), description: 'MADE UP SIDE JOB' });
    book.sort('act-side', { to: 'other-income' }, DEMO_TODAY);
    book.receive({ kind: 'deposit', id: 'act-roommate', account: 'checking', date: '2026-10-05', amount: x(12_000), description: 'ZELLE FROM MADE UP ROOMMATE' });
    book.sort('act-roommate', { to: 'not-mine' }, DEMO_TODAY);
    // Paid for a friend, marked not mine (7.2).
    book.receive({ kind: 'payment-to-person', id: 'act-friend', account: 'checking', date: '2026-10-06', amount: x(4_000), description: 'ZELLE TO MADE UP FRIEND' });
    book.sort('act-friend', { to: 'not-mine' }, DEMO_TODAY);
    // A hand move (13.3).
    book.moveMoney({ from: 'wants', to: 'needs', amount: x(2_500) }, '2026-10-06');
  }
  if (s.reviewBusy === true) {
    const rid = (name: string): string => `busy-${name}`;
    // Money in: a deposit, and a paycheck-looking one only four days after the last (3.7).
    book.receive({ kind: 'deposit', id: rid('tax'), account: 'checking', date: '2026-10-05', amount: x(25_000), description: 'MADE UP TAX REFUND' });
    book.receive({ kind: 'deposit', id: rid('early'), account: 'checking', date: '2026-10-06', amount: x(30_000), description: `${EMPLOYER} BONUS` });
    // A refund the bank did not match to a purchase (4.5, A15).
    buy('2026-10-01', 5_400, 'ONLINE MARKETPLACE');
    book.receive({ kind: 'refund', id: rid('refund'), account: 'everyday-card', date: DEMO_TODAY, amount: x(2_317), description: 'ONLINE MARKETPLACE REFUND' });
    cardExtra += 5_400 - 2_317;
    // Fees and interest on the everyday card (4.8).
    book.receive({ kind: 'card-charge', id: rid('fee'), account: 'everyday-card', date: '2026-10-04', amount: x(3_500), description: 'LATE FEE', charge: 'fee' });
    book.receive({ kind: 'card-charge', id: rid('interest'), account: 'everyday-card', date: '2026-10-04', amount: x(1_842), description: 'PURCHASE INTEREST CHARGE', charge: 'interest' });
    cardExtra += 3_500 + 1_842;
    // Money out of savings (4.9, 5.2).
    book.receive({ kind: 'savings-withdrawal', id: rid('water'), account: 'savings', date: '2026-10-06', amount: x(6_410), description: 'BILL PAY WATER UTILITY', pending: false });
    book.receive({ kind: 'transfer', id: rid('old-card'), from: 'savings', to: 'old-card', date: '2026-10-06', amount: x(20_000), description: 'PAYMENT TO OLD CARD' });
    savingsOut += 6_410 + 20_000;
    // A new purchase on the old card (5.4).
    book.receive({ kind: 'purchase', id: rid('furniture'), account: 'old-card', date: '2026-10-05', amount: x(8_000), description: 'MADE UP FURNITURE', pending: false });
    // A friend (7.4), and a mom payment bigger than what the reserve holds (8.3).
    book.receive({ kind: 'payment-to-person', id: rid('friend'), account: 'checking', date: '2026-10-06', amount: x(4_000), description: 'ZELLE TO MADE UP FRIEND' });
    book.receive({ kind: 'payment-to-person', id: rid('mom'), account: 'checking', date: '2026-10-06', amount: x(250_000), description: `ZELLE TO ${MOM}` });
    // A split purchase that was partly refunded, so it needs splitting again (4.5).
    book.receive({ kind: 'purchase', id: rid('hardware'), account: 'checking', date: '2026-10-04', amount: x(9_000), description: 'HARDWARE SUPERSTORE', pending: false });
    book.sort(rid('hardware'), { split: [{ bucket: 'needs', amount: x(6_000) }, { bucket: 'wants', amount: x(3_000) }] }, DEMO_TODAY);
    book.receive({ kind: 'refund', id: rid('hardware-refund'), account: 'checking', date: '2026-10-06', amount: x(1_000), description: 'HARDWARE SUPERSTORE REFUND', refundOf: rid('hardware') });
    // Still pending: it counts now but cannot be marked a transfer yet (4.6).
    buy('2026-10-07', 980, 'CORNER DELI', 'everyday-card', true);
    cardExtra += 980;
  }

  // The last time the bank was read and matched was before the coffee.
  const checkedThisMorning = book.safeToSpend(s.today ?? DEMO_TODAY).amount;
  buy('2026-10-07', 625, 'BLUE DOOR COFFEE', 'everyday-card', true);
  // The second paycheck, on its day: a new pay period, with both leftover questions open.
  if (s.secondPaycheck === true) {
    book.receive({ kind: 'deposit', id: 'demo-pay-2', account: 'checking', date: '2026-10-16', amount: x(420_000), description: `${EMPLOYER} DIR DEP` });
  }

  let statements = s.statements ?? [EVERYDAY_STATEMENT, OLD_CARD_STATEMENT];
  let everydayCardOwes = x(61_248 + 575 + 4_120 + 3_890 + 1_599 + 2_317 + 1_150 + 625 + cardExtra) + (s.eatingOut === undefined ? 0 : x(s.eatingOut));
  if (s.allDone === true) {
    for (const id of unsorted) book.sort(id, { to: 'wants' }, DEMO_TODAY);
    // The everyday card paid in full (9.3): not spending (5.1).
    book.receive({ kind: 'transfer', id: 'demo-card-payment', from: 'checking', to: 'everyday-card', date: '2026-10-05', amount: x(61_248), description: 'PAYMENT TO EVERYDAY CARD' });
    everydayCardOwes = subtractCents(everydayCardOwes, x(61_248));
    statements = statements.filter((st) => st.card === 'everyday-card');
  }

  // The bank's balances, made up to agree with the book: the savings account
  // holds what it should, less this paycheck's savings share if it has not
  // been moved yet (3.8), and checking holds the rest.
  const pots = book.pots();
  const shouldBeInSavings = addCents(pots.savings, pots.momReserve);
  const lastSplit = book.paychecks().at(-1)?.split;
  // With a second paycheck, the first one's share has been moved and the new one's has not (3.8).
  const savings =
    s.secondPaycheck === true && lastSplit !== undefined
      ? subtractCents(shouldBeInSavings, addCents(lastSplit.savings, lastSplit.momReserve))
      : s.allDone === true
        ? shouldBeInSavings
        : subtractCents(subtractCents(shouldBeInSavings, x(135_000)), x(savingsOut));
  const appSide = subtractCents(addCents(pots.savings, pots.needs, pots.wants, pots.momReserve, pots.heldForOthers, pots.unsortedIn), pots.unsortedOut);
  const checking = addCents(subtractCents(subtractCents(appSide, book.inTransit().total), savings), everydayCardOwes, s.bankOff ?? 0);
  const bank: BankBalances = { checking, savings, everydayCard: everydayCardOwes };

  return {
    today: s.today ?? DEMO_TODAY,
    book,
    bank: s.bankNotRead === true ? null : bank,
    needsLogin: s.needsLogin ?? false,
    statements: statements.map((st) => ({ ...st, statementBalance: x(st.statementBalance), minimumPayment: x(st.minimumPayment) })),
    madeUpData: true,
    seenTakeBacks: new Set(),
    lastChecked: s.bankNotRead === true ? { amount: checkedThisMorning, at: LAST_CHECKED_AT } : null,
  };
}

export interface DemoScenario {
  readonly name: string;
  readonly title: string;
  // What Home is given; null for a scenario where loading fails.
  readonly input: (() => HomeInput) | null;
  // How long Home's numbers take to arrive, to see the loading state.
  readonly delayMs?: number;
}

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  { name: 'normal', title: 'A normal Wednesday: two to sort, savings to move, card due in a week', input: () => story({}) },
  { name: 'all-clear', title: 'Nothing needs you', input: () => story({ allDone: true }) },
  { name: 'low', title: 'Wants is low', input: () => story({ eatingOut: 52_000 }) },
  { name: 'overspent', title: 'Wants is overspent', input: () => story({ eatingOut: 70_000 }) },
  { name: 'mismatch', title: 'Totals do not match the bank', input: () => story({ bankOff: -1_234 }) },
  { name: 'payday', title: 'Payday is today', input: () => story({ today: '2026-10-16', allDone: true, statements: [] }) },
  { name: 'late', title: 'The paycheck is two days late', input: () => story({ today: '2026-10-18', allDone: true, statements: [] }) },
  { name: 'trouble', title: 'Bank needs a login, old card overdue', input: () => story({ needsLogin: true, statements: [OLD_CARD_OVERDUE] }) },
  { name: 'took-back', title: 'The bank took back a charge it showed twice', input: () => story({ chargedTwice: true }) },
  { name: 'bank-not-read', title: "The bank can't be read: safe to spend as of this morning", input: () => story({ bankNotRead: true }) },
  { name: 'big', title: 'Very large numbers', input: () => story({ scale: 100_000 }) },
  { name: 'review-busy', title: 'Review: one of everything waiting', input: () => story({ reviewBusy: true }) },
  { name: 'buckets-busy', title: 'Buckets: money held for a roommate, mom paid in the target', input: () => story({ bucketsBusy: true }) },
  { name: 'activity-busy', title: 'Activity: every kind of row on the lists of what went in and out', input: () => story({ activityBusy: true }) },
  { name: 'payday-paid', title: 'Payday: the second paycheck just came in, two leftover questions open', input: () => story({ today: '2026-10-16', secondPaycheck: true, allDone: true, statements: [] }) },
  {
    name: 'not-set-up',
    title: 'Before setup day',
    input: () => ({ today: DEMO_TODAY, book: null, bank: null, needsLogin: false, statements: [], madeUpData: true, seenTakeBacks: new Set(), lastChecked: null }),
  },
  { name: 'slow', title: 'Slow to load (3 seconds)', input: () => story({}), delayMs: 3_000 },
  { name: 'error', title: 'Cannot load', input: null },
];

export function demoScenario(name: string): DemoScenario | undefined {
  return DEMO_SCENARIOS.find((s) => s.name === name);
}

// For tests: the book a scenario's Home is worked out from.
export function demoBook(name: string): Book | null {
  return demoScenario(name)?.input?.().book ?? null;
}
