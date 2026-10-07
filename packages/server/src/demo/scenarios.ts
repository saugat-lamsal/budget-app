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
}

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
  book.receive({ kind: 'deposit', id: 'demo-pay', account: 'checking', date: PAYDAY, amount: x(420_000), description: `${EMPLOYER} DIR DEP` });
  for (const item of book.reviewItems()) {
    if (item.type === 'leftover') book.answerLeftover(item.id, 'roll-over', PAYDAY);
  }
  book.receive({ kind: 'payment-to-person', id: 'demo-mom', account: 'checking', date: '2026-10-03', amount: x(50_000), description: `ZELLE TO ${MOM}` });
  buy('2026-10-03', 8_643, 'GROCERY OUTLET #12', 'checking');
  buy('2026-10-04', 4_120, 'CORNER GAS STATION');
  buy('2026-10-05', 3_890, 'MAIN ST RESTAURANT');
  buy('2026-10-05', 1_599, 'STREAMING SERVICE');
  if (s.eatingOut !== undefined) buy('2026-10-06', s.eatingOut, 'HARBOR RESTAURANT');
  const unsorted = [buy('2026-10-06', 2_317, 'ONLINE MARKETPLACE'), buy('2026-10-06', 1_150, 'CORNER STORE')];
  buy('2026-10-07', 625, 'BLUE DOOR COFFEE', 'everyday-card', true);

  let statements = s.statements ?? [EVERYDAY_STATEMENT, OLD_CARD_STATEMENT];
  let everydayCardOwes = x(61_248 + 575 + 4_120 + 3_890 + 1_599 + 2_317 + 1_150 + 625) + (s.eatingOut === undefined ? 0 : x(s.eatingOut));
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
  const savings = s.allDone === true ? shouldBeInSavings : subtractCents(shouldBeInSavings, x(135_000));
  const appSide = subtractCents(addCents(pots.savings, pots.needs, pots.wants, pots.momReserve, pots.heldForOthers, pots.unsortedIn), pots.unsortedOut);
  const checking = addCents(subtractCents(subtractCents(appSide, book.inTransit().total), savings), everydayCardOwes, s.bankOff ?? 0);
  const bank: BankBalances = { checking, savings, everydayCard: everydayCardOwes };

  return {
    today: s.today ?? DEMO_TODAY,
    book,
    bank,
    needsLogin: s.needsLogin ?? false,
    statements: statements.map((st) => ({ ...st, statementBalance: x(st.statementBalance), minimumPayment: x(st.minimumPayment) })),
    madeUpData: true,
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
  { name: 'big', title: 'Very large numbers', input: () => story({ scale: 100_000 }) },
  { name: 'not-set-up', title: 'Before setup day', input: () => ({ today: DEMO_TODAY, book: null, bank: null, needsLogin: false, statements: [], madeUpData: true }) },
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
