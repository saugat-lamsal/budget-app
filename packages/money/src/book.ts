import type { Alert, AlertInput } from './alerts.js';
import { isSpendingBucket, type SplitBucket } from './buckets.js';
import type { CardPayment } from './reminders.js';
import { addCents, assertCents, assertPositiveCents, subtractCents, type Cents } from './cents.js';
import { addDays, assertIsoDate, daysBetween, monthOf, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import { splitPaycheck, type PaycheckSplit, type SplitSettings } from './payday.js';
import { bankSide, type BankBalances } from './self-check.js';
import { checkRules, findRule, isDepositRuleChoice, isMoneyInChoice, isPersonPaymentChoice, type DepositRuleChoice, type MoneyInChoice, type SortingRule } from './rules.js';
import { changeSettings as applySettingsChange, matchesTextRule, validateSettings, type Settings } from './settings.js';
import {
  checkTransaction,
  sameTransaction,
  type BankTransaction,
  type CardCharge,
  type Deposit,
  type PersonPayment,
  type Purchase,
  type Refund,
  type Transfer,
  type TransferArrived,
  type TransferSent,
} from './transactions.js';

// The book: every bucket and everything waiting in review. Bank activity and
// your answers are applied one at a time, in the order they happen. Each
// entry remembers exactly what it did to the buckets (its effect), so a
// change to an entry undoes the old effect and applies the new one, and the
// buckets can always be added up again from scratch (recountPots).

export interface StartingPots {
  readonly savings: Cents;
  readonly needs: Cents;
  readonly wants: Cents;
  readonly momReserve: Cents;
  readonly heldForOthers: Cents;
}

export interface Pots extends StartingPots {
  // Deposits and refunds waiting in review (rule 12.2).
  readonly unsortedIn: Cents;
  // Spending waiting in review (rule 4.3).
  readonly unsortedOut: Cents;
}

type PotName = keyof Pots;
// What an entry does to the totals: the pots, plus the old card debt, which
// is tracked on its own and is not part of the self-check (12.4), plus the
// money in transit between checking, savings, and the everyday card (12.5).
type TotalName = PotName | 'oldCardDebt' | 'inTransit';
type Effect = Partial<Record<TotalName, Cents>>;

const POT_NAMES: readonly PotName[] = ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers', 'unsortedIn', 'unsortedOut'];
const TOTAL_NAMES: readonly TotalName[] = [...POT_NAMES, 'oldCardDebt', 'inTransit'];

export interface OpenBookInput {
  // The day tracking starts.
  readonly date: IsoDate;
  readonly pots: StartingPots;
  readonly oldCardDebt: Cents;
  // The pay schedule counts from this date until the first paycheck arrives.
  readonly lastPaycheckDate: IsoDate;
  readonly settings: Settings;
  readonly rules?: readonly SortingRule[];
  // Charges pending on setup day. They are already in the starting money,
  // so they start out counted (see startTracking).
  readonly countedAtSetup?: readonly Purchase[];
  // Transfers with only one half showing on setup day (12.5): money that had
  // left and not arrived, or arrived before it was seen leaving. The
  // starting money allows for them.
  readonly inTransitAtSetup?: readonly (TransferSent | TransferArrived)[];
}

export type ReceiveOutcome = 'paycheck' | 'sorted' | 'posted' | 'review' | 'duplicate';

export interface Received {
  readonly id: string;
  readonly outcome: ReceiveOutcome;
}

export type LeftoverAnswer = 'roll-over' | 'move-to-savings';

export interface SplitPart {
  readonly bucket: SplitBucket;
  readonly amount: Cents;
}

// How you sort something in review, or re-sort it later (4.7).
export type SortChoice = MoneyInChoice | { readonly split: readonly SplitPart[] };

export type SpendingSort =
  | { readonly to: 'unsorted' }
  | { readonly to: SplitBucket }
  | { readonly split: readonly SplitPart[] }
  // A payment to a person that was not your spending (7.2).
  | { readonly to: 'not-mine' }
  // A charge pending on setup day, already counted in the starting money.
  | { readonly to: 'counted-at-setup' };

// debt-payoff is a payment to the old card (5.2). mom-difference is the part
// of a mom payment the reserve could not cover (8.3).
export type SpendingKind = 'purchase' | 'card-fee' | 'card-interest' | 'debt-payoff' | 'person-payment' | 'mom-difference';

export type ReviewItem =
  | {
      readonly type: 'money-in';
      readonly id: string;
      readonly date: IsoDate;
      readonly amount: Cents;
      readonly description: string;
      readonly reason: MoneyInReason;
    }
  | {
      readonly type: 'spending';
      readonly id: string;
      readonly date: IsoDate;
      readonly amount: Cents;
      readonly description: string;
      readonly reason:
        | 'no-rule'
        | 'card-fee'
        | 'card-interest'
        | 'split-changed'
        | 'old-card-from-savings'
        | 'person-payment'
        | 'mom-difference'
        | 'setup-difference';
      readonly suggestion: SplitBucket | null;
    }
  | {
      // A new purchase on the old card (5.4): a flag to see, not money to sort.
      readonly type: 'old-card-purchase';
      readonly id: string;
      readonly date: IsoDate;
      readonly amount: Cents;
      readonly description: string;
    }
  | {
      readonly type: 'leftover';
      readonly id: string;
      readonly date: IsoDate;
      readonly bucket: SplitBucket;
      readonly amount: Cents;
    };

export type MoneyInReason = 'deposit' | 'early-paycheck' | 'refund';

export interface PurchaseView {
  readonly id: string;
  // The day of the purchase, even after it posts (4.1).
  readonly date: IsoDate;
  readonly description: string;
  readonly amount: Cents;
  readonly refunded: Cents;
  // The part already counted in the starting money on setup day.
  readonly countedAtSetup: Cents;
  readonly pending: boolean;
  readonly kind: SpendingKind;
  readonly sortedTo: SpendingSort;
}

export interface PaycheckRecord {
  readonly id: string;
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly split: PaycheckSplit;
}

export interface Period {
  // 0 is the stretch from setup day to the first paycheck.
  readonly number: number;
  readonly startDate: IsoDate;
}

// Rule 7.3: held for others should come back to zero. Negative means
// someone owes you.
export interface OthersMoney {
  readonly heldForOthers: Cents;
  readonly meaning: 'settled' | 'holding-for-others' | 'owed-to-you';
}

export interface MomMonth {
  readonly month: string;
  readonly sent: Cents;
  readonly target: { readonly low: Cents; readonly high: Cents };
}

export interface SafeToSpend {
  readonly amount: Cents;
  readonly nextPayday: IsoDate;
  // Negative when the expected paycheck is late.
  readonly daysToPayday: number;
}

// Rule 12.3: the bank side, plus money in transit (12.5), must equal the
// app side.
export interface SelfCheck {
  readonly bankSide: Cents;
  // Money that left checking or savings for checking, savings, or the
  // everyday card and has not arrived yet. Negative when the arriving half
  // was seen before the leaving half.
  readonly inTransit: Cents;
  readonly appSide: Cents;
  // Bank side plus in transit, minus app side. Zero when they match.
  readonly difference: Cents;
  readonly ok: boolean;
}

// Rule 12.5: transfers with only one half seen so far.
export interface InTransitItem {
  readonly id: string;
  readonly date: IsoDate;
  readonly from: 'checking' | 'savings';
  readonly to: 'checking' | 'savings' | 'everyday-card' | 'old-card';
  readonly amount: Cents;
  // Which half the app has seen.
  readonly seen: 'left' | 'arrived';
}

export interface InTransit {
  // The amount the self-check counts. Money on its way to the old card is
  // listed but not counted (12.4).
  readonly total: Cents;
  readonly items: readonly InTransitItem[];
}

// Rule 0.5: safe to spend only when the totals match the bank.
export type CheckedSafeToSpend =
  | { readonly ok: true; readonly safeToSpend: SafeToSpend }
  | { readonly ok: false; readonly difference: Cents; readonly nextPayday: IsoDate; readonly daysToPayday: number };

// The buckets you can move money between by hand (13.3).
export type Pot = 'savings' | 'needs' | 'wants' | 'momReserve' | 'heldForOthers';

const MOVABLE: readonly Pot[] = ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers'];

export interface MoneyMove {
  readonly from: Pot;
  readonly to: Pot;
  readonly amount: Cents;
  // Needed to move money out of savings or the mom reserve (13.4).
  readonly confirmed?: boolean;
}

// Why a hand move asks you to confirm first (13.4).
export type ConfirmReason = 'out-of-savings' | 'out-of-mom-reserve' | 'below-zero';

export type MoveResult =
  | { readonly moved: true }
  | { readonly moved: false; readonly needsConfirmation: true; readonly reasons: readonly ConfirmReason[] };

// Rule 13.5: every change and every manual move, with its date.
export type ChangeLogEntry =
  | { readonly date: IsoDate; readonly kind: 'settings-changed'; readonly changes: Partial<Settings> }
  | { readonly date: IsoDate; readonly kind: 'rule-added'; readonly rule: SortingRule }
  // 13.6: added by correcting an item, ahead of the rule it corrects (null
  // when no rule had sorted that item).
  | {
      readonly date: IsoDate;
      readonly kind: 'rule-added-from-correction';
      readonly rule: SortingRule;
      readonly correcting: string;
      readonly aheadOf: string | null;
    }
  | { readonly date: IsoDate; readonly kind: 'rule-changed'; readonly before: SortingRule; readonly after: SortingRule }
  | { readonly date: IsoDate; readonly kind: 'rule-removed'; readonly rule: SortingRule }
  | { readonly date: IsoDate; readonly kind: 'money-moved'; readonly from: Pot; readonly to: Pot; readonly amount: Cents };

export interface SavingsTransfer {
  readonly shouldBeInSavings: Cents;
  readonly savingsAccountBalance: Cents;
  // What still needs to go into the savings account; $0 when it holds enough.
  readonly stillToMove: Cents;
  // Only when the account holds more than it should: by how much (3.8).
  readonly extraInSavings?: Cents;
}

interface PaycheckEntry {
  readonly kind: 'paycheck';
  readonly id: string;
  readonly txn: Deposit;
  readonly split: PaycheckSplit;
  effect: Effect;
}

interface MoneyInEntry {
  readonly kind: 'money-in';
  readonly id: string;
  readonly txn: Deposit | Refund;
  readonly reason: MoneyInReason;
  // A deposit you call your paycheck becomes a paycheck entry instead.
  sortedTo: 'unsorted' | DepositRuleChoice['to'];
  // How it was split, when sorted as other income.
  incomeSplit: PaycheckSplit | null;
  effect: Effect;
}

interface SpendEntry {
  readonly kind: 'spend';
  readonly id: string;
  readonly txn: Purchase | CardCharge | Transfer | TransferSent | PersonPayment;
  readonly spendingKind: SpendingKind;
  postedTxn: Purchase | null;
  pending: boolean;
  amount: Cents;
  refunded: Cents;
  // The part already taken out of the starting money on setup day.
  readonly countedAtSetup: Cents;
  sortedTo: SpendingSort;
  // True when a split stopped adding up and was sent back to review.
  splitChanged: boolean;
  effect: Effect;
}

// A refund matched to its purchase. Its money is counted on the purchase.
interface RefundEntry {
  readonly kind: 'refund';
  readonly id: string;
  readonly txn: Refund;
  readonly of: string;
  effect: Effect;
}

// A payment to mom (8.1). It takes what it can from the mom reserve; any
// difference is a separate spending entry waiting in review (8.3).
interface MomEntry {
  readonly kind: 'mom';
  readonly id: string;
  readonly txn: PersonPayment;
  readonly fromReserve: Cents;
  effect: Effect;
}

// One half of a transfer (12.5). The leaving half of a payment to the old
// card is a spending entry instead (5.2), except on setup day.
interface LegEntry {
  readonly kind: 'leg';
  readonly id: string;
  readonly txn: TransferSent | TransferArrived;
  effect: Effect;
}

// Money you moved by hand (13.3).
interface MoveEntry {
  readonly kind: 'move';
  readonly id: string;
  readonly date: IsoDate;
  effect: Effect;
}

// A transfer that changes no bucket (5.1, 5.3), kept so it counts once.
interface TransferEntry {
  readonly kind: 'transfer';
  readonly id: string;
  readonly txn: Transfer;
  effect: Effect;
}

// Old card activity that changes only the debt (5.4, 5.5).
interface OldCardEntry {
  readonly kind: 'old-card';
  readonly id: string;
  readonly txn: Purchase | CardCharge | Refund;
  postedTxn: Purchase | null;
  pending: boolean;
  amount: Cents;
  // The part already in the old card balance on setup day.
  readonly countedAtSetup: Cents;
  effect: Effect;
}

interface LeftoverEntry {
  readonly kind: 'leftover';
  readonly id: string;
  readonly date: IsoDate;
  readonly bucket: SplitBucket;
  readonly amount: Cents;
  answer: 'open' | LeftoverAnswer;
  effect: Effect;
}

type Entry =
  | PaycheckEntry
  | MoneyInEntry
  | SpendEntry
  | RefundEntry
  | MomEntry
  | TransferEntry
  | LegEntry
  | OldCardEntry
  | LeftoverEntry
  | MoveEntry;

// Why spending of each kind is waiting in review.
function spendingReason(kind: SpendingKind): 'no-rule' | 'card-fee' | 'card-interest' | 'old-card-from-savings' | 'person-payment' | 'mom-difference' {
  switch (kind) {
    case 'purchase':
      return 'no-rule';
    case 'debt-payoff':
      return 'old-card-from-savings';
    default:
      return kind;
  }
}

// What a spending entry takes from the buckets: its amount, less refunds,
// less any part already counted on setup day.
function netOf(entry: SpendEntry): Cents {
  return entry.amount - entry.refunded - entry.countedAtSetup;
}

// Two halves of a transfer fit together when they go between the same
// accounts for the same amount.
function sameRoute(a: TransferSent | TransferArrived, b: TransferSent | TransferArrived): boolean {
  return a.from === b.from && a.to === b.to && a.amount === b.amount;
}

function splitSettingsOf(settings: Settings): SplitSettings {
  const { split, momReservePerPaycheck, momReserveCap } = settings;
  return { split, momReservePerPaycheck, momReserveCap };
}

function potsOf(totals: Record<TotalName, Cents>): Pots {
  const { savings, needs, wants, momReserve, heldForOthers, unsortedIn, unsortedOut } = totals;
  return Object.freeze({ savings, needs, wants, momReserve, heldForOthers, unsortedIn, unsortedOut });
}

export function openBook(input: OpenBookInput): Book {
  return new Book(input);
}

export class Book {
  readonly #opening: StartingPots & { readonly oldCardDebt: Cents };
  readonly #totals: Record<TotalName, Cents>;
  readonly #entries = new Map<string, Entry>();
  // Posted transaction id -> the entry of the pending purchase it replaced.
  readonly #aliases = new Map<string, string>();
  // The two halves of a transfer, paired both ways (12.5).
  readonly #pairs = new Map<string, string>();
  // Ids of entries waiting for you, in the order they arrived.
  readonly #review = new Set<string>();
  readonly #paychecks: PaycheckRecord[] = [];
  readonly #log: ChangeLogEntry[] = [];
  // Numbers hand moves, so each one has its own id.
  #moveCount = 0;
  // The pay period in which each bucket's low and empty alerts were last
  // given (10.1, 10.2).
  readonly #lowAlerted: Record<SplitBucket, number | null> = { needs: null, wants: null };
  readonly #emptyAlerted: Record<SplitBucket, number | null> = { needs: null, wants: null };
  // What needs and wants started this pay period with (10.1): what payday
  // left in them, rollover and overspending included, less a leftover you
  // then moved to savings. Before the first paycheck, what setup day gave.
  readonly #periodStart: Record<SplitBucket, Cents>;
  #settings: Settings;
  // The split and mom reserve settings in force for this pay period. A
  // change to them waits for the next paycheck (13.1).
  #periodSplit: SplitSettings;
  #rules: readonly SortingRule[];
  #lastPaycheckDate: IsoDate;
  #period: Period;

  constructor(input: OpenBookInput) {
    assertIsoDate(input.date, 'start date');
    assertIsoDate(input.lastPaycheckDate, 'last paycheck date');
    assertCents(input.oldCardDebt, 'old card debt');
    const { savings, needs, wants, momReserve, heldForOthers } = input.pots;
    this.#opening = Object.freeze({ savings, needs, wants, momReserve, heldForOthers, oldCardDebt: input.oldCardDebt });
    for (const [name, value] of Object.entries(this.#opening)) assertCents(value, name);
    this.#totals = { ...this.#opening, unsortedIn: 0, unsortedOut: 0, inTransit: 0 };
    addCents(savings, needs, wants, momReserve, heldForOthers);
    this.#settings = validateSettings(input.settings);
    this.#periodSplit = splitSettingsOf(this.#settings);
    this.#rules = checkRules(input.rules ?? []);
    this.#lastPaycheckDate = input.lastPaycheckDate;
    this.#period = { number: 0, startDate: input.date };
    this.#periodStart = { needs, wants };
    for (const txn of input.countedAtSetup ?? []) this.#countAtSetup(txn);
    for (const txn of input.inTransitAtSetup ?? []) this.#inTransitAtSetup(txn);
  }

  // Half of a transfer showing on setup day. Its money is already in the
  // starting money (or the old card balance), so it changes no bucket and no
  // debt here; it only waits, in transit, for its other half. Even a payment
  // to the old card that left before setup day is not spending in the
  // tracked time; it lowers the debt when it lands.
  #inTransitAtSetup(txn: TransferSent | TransferArrived): void {
    checkTransaction(txn);
    if (txn.kind !== 'transfer-sent' && txn.kind !== 'transfer-arrived') {
      throw new MoneyError('bad-transaction', `${String((txn as { id?: unknown }).id)} is not half of a transfer`);
    }
    const copy = Object.freeze({ ...txn });
    const partner = copy.kind === 'transfer-sent' ? this.#arrivalFor(copy) : this.#oldestUnpairedSent(copy);
    const travelling = copy.kind === 'transfer-sent' ? copy.amount : -copy.amount;
    this.#add({ kind: 'leg', id: copy.id, txn: copy, effect: {} }, copy.to === 'old-card' ? {} : { inTransit: travelling });
    if (partner !== undefined) this.#pair(copy.kind === 'transfer-sent' ? copy.id : partner, copy.kind === 'transfer-sent' ? partner : copy.id);
  }

  // A charge pending on setup day changes nothing now: it is already in the
  // starting money (or the old card balance). It is kept so that, when it
  // posts, only the difference counts (QUESTIONS.md A10).
  #countAtSetup(txn: Purchase): void {
    checkTransaction(txn);
    if (!txn.pending) throw new MoneyError('bad-transaction', `${txn.id} was not pending on setup day`);
    const copy = Object.freeze({ ...txn });
    if (copy.account === 'old-card') {
      this.#add({ kind: 'old-card', id: copy.id, txn: copy, postedTxn: null, pending: true, amount: copy.amount, countedAtSetup: copy.amount, effect: {} }, {});
      return;
    }
    const entry: SpendEntry = {
      kind: 'spend',
      id: copy.id,
      txn: copy,
      spendingKind: 'purchase',
      postedTxn: null,
      pending: true,
      amount: copy.amount,
      refunded: 0,
      countedAtSetup: copy.amount,
      sortedTo: { to: 'counted-at-setup' },
      splitChanged: false,
      effect: {},
    };
    this.#addSpendingEntry(entry);
  }

  // ----- Reading -----

  pots(): Pots {
    return potsOf(this.#totals);
  }

  // The old card balance, tracked separately as debt (12.4).
  oldCardDebt(): Cents {
    return this.#totals.oldCardDebt;
  }

  // Adds every bucket up again from the starting amounts and every entry.
  // Must always equal pots(); a difference means the book is broken.
  recountPots(): Pots {
    return potsOf(this.#recount());
  }

  recountOldCardDebt(): Cents {
    return this.#recount().oldCardDebt;
  }

  #recount(): Record<TotalName, Cents> {
    const totals: Record<TotalName, Cents> = { ...this.#opening, unsortedIn: 0, unsortedOut: 0, inTransit: 0 };
    for (const entry of this.#entries.values()) {
      for (const name of TOTAL_NAMES) totals[name] = addCents(totals[name], entry.effect[name] ?? 0);
    }
    return totals;
  }

  settings(): Settings {
    return this.#settings;
  }

  rules(): readonly SortingRule[] {
    return this.#rules;
  }

  period(): Period {
    return this.#period;
  }

  // Rule 10.1: what needs and wants started this pay period with.
  startedPeriodWith(): { readonly needs: Cents; readonly wants: Cents } {
    return Object.freeze({ ...this.#periodStart });
  }

  lastPaycheckDate(): IsoDate {
    return this.#lastPaycheckDate;
  }

  paychecks(): readonly PaycheckRecord[] {
    return [...this.#paychecks];
  }

  purchases(): PurchaseView[] {
    const views: PurchaseView[] = [];
    for (const e of this.#entries.values()) {
      if (e.kind !== 'spend') continue;
      const description = (e.postedTxn ?? e.txn).description;
      views.push({
        id: e.id,
        date: e.txn.date,
        description,
        amount: e.amount,
        refunded: e.refunded,
        countedAtSetup: e.countedAtSetup,
        pending: e.pending,
        kind: e.spendingKind,
        sortedTo: e.sortedTo,
      });
    }
    return views;
  }

  reviewItems(): ReviewItem[] {
    return [...this.#review].map((id) => this.#reviewView(this.#entry(id)));
  }

  // Rules 11.1 to 11.3: wants left, minus unsorted spending. Savings, the
  // mom reserve, held for others, and unsorted money in never count. Shown
  // with the days to the next payday from the pay schedule.
  safeToSpend(today: IsoDate): SafeToSpend {
    assertIsoDate(today, 'today');
    const nextPayday = addDays(this.#lastPaycheckDate, this.#settings.payScheduleDays);
    return {
      amount: subtractCents(this.#totals.wants, this.#totals.unsortedOut),
      nextPayday,
      daysToPayday: daysBetween(today, nextPayday),
    };
  }

  // Rules 12.1 to 12.5. The bank balances must include pending charges
  // (withPendingCharges). The old card is not part of the check.
  selfCheck(bank: BankBalances): SelfCheck {
    const bankTotal = bankSide(bank);
    const t = this.#totals;
    // 12.2: savings + needs + wants + mom reserve + held for others
    //       + unsorted money in - unsorted spending
    const appTotal = subtractCents(addCents(t.savings, t.needs, t.wants, t.momReserve, t.heldForOthers, t.unsortedIn), t.unsortedOut);
    const difference = subtractCents(addCents(bankTotal, t.inTransit), appTotal);
    return { bankSide: bankTotal, inTransit: t.inTransit, appSide: appTotal, difference, ok: difference === 0 };
  }

  // Rule 12.5: transfers with only one half seen so far, oldest first.
  inTransit(): InTransit {
    const items: InTransitItem[] = [];
    for (const entry of this.#entries.values()) {
      const txn = 'txn' in entry ? entry.txn : null;
      if (txn === null || (txn.kind !== 'transfer-sent' && txn.kind !== 'transfer-arrived') || this.#pairs.has(entry.id)) continue;
      const { id, date, from, to, amount } = txn;
      items.push({ id, date, from, to, amount, seen: txn.kind === 'transfer-sent' ? 'left' : 'arrived' });
    }
    return { total: this.#totals.inTransit, items };
  }

  // Rule 0.5: when the totals do not match the bank, say so instead of
  // showing a safe-to-spend number the app cannot back up.
  checkedSafeToSpend(today: IsoDate, bank: BankBalances): CheckedSafeToSpend {
    const safeToSpend = this.safeToSpend(today);
    const check = this.selfCheck(bank);
    if (check.ok) return { ok: true, safeToSpend };
    return { ok: false, difference: check.difference, nextPayday: safeToSpend.nextPayday, daysToPayday: safeToSpend.daysToPayday };
  }

  // Rule 3.8: what should be sitting in the savings account (savings plus
  // the mom reserve), and how much still needs to be moved there. Negative
  // means the account holds more than the buckets say.
  savingsTransfer(savingsAccountBalance: Cents): SavingsTransfer {
    assertCents(savingsAccountBalance, 'savings account balance');
    const shouldBeInSavings = addCents(this.#totals.savings, this.#totals.momReserve);
    // Money already on its way to savings counts as moved (12.5).
    const onItsWay = this.inTransit()
      .items.filter((item) => item.to === 'savings' && item.seen === 'left')
      .map((item) => item.amount);
    const gap = subtractCents(shouldBeInSavings, addCents(savingsAccountBalance, ...onItsWay));
    // 3.8: nothing to move when the account already holds enough; anything
    // over is shown on its own.
    if (gap >= 0) return { shouldBeInSavings, savingsAccountBalance, stillToMove: gap };
    return { shouldBeInSavings, savingsAccountBalance, stillToMove: 0, extraInSavings: -gap };
  }

  // Section 10: the alerts due now. The low and empty bucket alerts come
  // once per bucket per pay period (10.1, 10.2), so taking one marks it as
  // given until the next paycheck. The others come every time they are due.
  takeAlerts(input: AlertInput): Alert[] {
    const alerts: Alert[] = [];
    const newlyLow: SplitBucket[] = [];
    const newlyEmpty: SplitBucket[] = [];
    // 10.1: needs or wants below the alert level, a percent of what the
    // bucket started the pay period with, compared to the exact cent. At
    // zero or below the empty alert covers it, and a bucket that started at
    // zero or below has no level above zero to fall under.
    const percent = BigInt(this.#settings.lowBucketAlertPercent);
    for (const bucket of ['needs', 'wants'] as const) {
      const amount = this.#totals[bucket];
      const startedWith = this.#periodStart[bucket];
      const low = amount > 0 && BigInt(amount) * 100n < BigInt(startedWith) * percent;
      if (low && this.#lowAlerted[bucket] !== this.#period.number) {
        alerts.push({ kind: 'low-bucket', bucket, amount, startedWith });
        newlyLow.push(bucket);
      }
    }
    // 10.2: needs or wants at zero or below.
    for (const bucket of ['needs', 'wants'] as const) {
      const amount = this.#totals[bucket];
      if (amount <= 0 && this.#emptyAlerted[bucket] !== this.#period.number) {
        alerts.push({ kind: 'empty-bucket', bucket, amount });
        newlyEmpty.push(bucket);
      }
    }
    // 10.3: at the review time, only if something is waiting.
    const waiting = this.#review.size;
    if (waiting > 0) alerts.push({ kind: 'daily-review', at: this.#settings.dailyReviewTime, waiting });
    // 10.4: the totals do not match the bank (section 12).
    const check = this.selfCheck(input.bankBalances);
    if (!check.ok) alerts.push({ kind: 'totals-mismatch', difference: check.difference });
    // 10.5
    if (input.bankConnection === 'needs-login') alerts.push({ kind: 'bank-login' });
    // Marked only once everything above worked, so a refused call gives nothing.
    for (const bucket of newlyLow) this.#lowAlerted[bucket] = this.#period.number;
    for (const bucket of newlyEmpty) this.#emptyAlerted[bucket] = this.#period.number;
    return alerts;
  }

  // Rule 8.2: everything sent to mom in a calendar month ("YYYY-MM").
  momSentInMonth(month: string): MomMonth {
    assertIsoDate(`${month}-01`, 'month');
    if (month.length !== 7) throw new MoneyError('not-a-date', `month must be YYYY-MM, got ${month}`);
    let sent = 0;
    for (const entry of this.#entries.values()) {
      if (entry.kind === 'mom' && monthOf(entry.txn.date) === month) sent = addCents(sent, entry.txn.amount);
    }
    return { month, sent, target: this.#settings.momMonthlyTarget };
  }

  // Payments the app has seen to a card, oldest first, for the reminders
  // (9.3, 9.4): the day each left and the day it reached the card (12.5).
  // A transfer seen in two halves is one payment.
  cardPayments(card: 'everyday-card' | 'old-card'): CardPayment[] {
    const payments: CardPayment[] = [];
    for (const entry of this.#entries.values()) {
      const txn = 'txn' in entry ? entry.txn : null;
      if (txn === null || !('to' in txn) || txn.to !== card) continue;
      const partner = this.#pairs.get(entry.id);
      if (txn.kind === 'transfer') {
        payments.push({ date: txn.date, amount: txn.amount, landedOn: txn.date });
      } else if (txn.kind === 'transfer-sent') {
        payments.push({ date: txn.date, amount: txn.amount, landedOn: partner === undefined ? null : this.#legTxn(partner).date });
      } else if (txn.kind === 'transfer-arrived' && partner === undefined) {
        // Seen landing, not yet seen leaving.
        payments.push({ date: txn.date, amount: txn.amount, landedOn: txn.date });
      }
    }
    return payments.sort((a, b) => daysBetween(b.date, a.date));
  }

  othersMoney(): OthersMoney {
    const heldForOthers = this.#totals.heldForOthers;
    const meaning = heldForOthers === 0 ? 'settled' : heldForOthers > 0 ? 'holding-for-others' : 'owed-to-you';
    return { heldForOthers, meaning };
  }

  // ----- Bank activity -----

  receive(txn: BankTransaction): Received {
    checkTransaction(txn);
    const known = this.#knownTransaction(txn.id);
    if (known !== undefined) {
      if (sameTransaction(known, txn)) return { id: txn.id, outcome: 'duplicate' };
      throw new MoneyError('conflicting-id', `a different transaction already has id ${txn.id}`);
    }
    const copy = Object.freeze({ ...txn });
    switch (copy.kind) {
      case 'deposit':
        return this.#receiveDeposit(copy);
      case 'purchase':
        return this.#receivePurchase(copy);
      case 'refund':
        return copy.account === 'old-card' ? this.#addOldCard(copy) : this.#receiveRefund(copy);
      case 'card-charge':
        if (copy.account === 'old-card') return this.#addOldCard(copy);
        return this.#addSpending(copy, copy.charge === 'fee' ? 'card-fee' : 'card-interest', { to: 'unsorted' });
      case 'transfer':
        return this.#receiveTransfer(copy);
      case 'transfer-sent':
        return this.#receiveSent(copy);
      case 'transfer-arrived':
        return this.#receiveArrived(copy);
      case 'payment-to-person':
        return this.#receivePersonPayment(copy);
    }
  }

  // Rule 12.5: the half of a transfer that left checking or savings. Buckets
  // change the same way as for a whole transfer (section 5): none, or needs
  // for a payment to the old card (5.2). The old card debt waits for the
  // money to land.
  #receiveSent(txn: TransferSent): Received {
    // Check for the arriving half first, so a mismatch changes nothing.
    const partner = this.#arrivalFor(txn);
    let received: Received;
    if (txn.to === 'old-card') {
      received = this.#addSpending(txn, 'debt-payoff', txn.from === 'checking' ? { to: 'needs' } : { to: 'unsorted' });
    } else {
      this.#add({ kind: 'leg', id: txn.id, txn, effect: {} }, { inTransit: txn.amount });
      received = { id: txn.id, outcome: 'sorted' };
    }
    if (partner !== undefined) this.#pair(txn.id, partner);
    return received;
  }

  // The arriving half that belongs to this leaving half: one that names it,
  // or else the oldest unpaired one between the same accounts for the same
  // amount that names no other.
  #arrivalFor(sent: TransferSent): string | undefined {
    let fallback: string | undefined;
    for (const entry of this.#entries.values()) {
      if (entry.kind !== 'leg' || entry.txn.kind !== 'transfer-arrived' || this.#pairs.has(entry.id)) continue;
      const a = entry.txn;
      if (a.sentId === sent.id) {
        if (!sameRoute(a, sent)) throw new MoneyError('bad-transaction', `${a.id} names ${sent.id} but does not match it`);
        return entry.id;
      }
      if (a.sentId === undefined && fallback === undefined && sameRoute(a, sent)) fallback = entry.id;
    }
    return fallback;
  }

  // Rule 12.5: the half of a transfer that arrived. Money landing on the old
  // card lowers the debt (5.2); anywhere else it ends its time in transit.
  #receiveArrived(txn: TransferArrived): Received {
    let partner: string | undefined;
    // An arrival paired with the named half only by guess, which gives way.
    let displaced: string | undefined;
    if (txn.sentId !== undefined) {
      const named = this.#entries.get(txn.sentId);
      if (named !== undefined) {
        const namedTxn = 'txn' in named ? named.txn : null;
        if (namedTxn === null || namedTxn.kind !== 'transfer-sent' || !sameRoute(namedTxn, txn)) {
          throw new MoneyError('bad-transaction', `${txn.id} names ${txn.sentId}, which is not the same transfer`);
        }
        const current = this.#pairs.get(named.id);
        if (current !== undefined) {
          const currentTxn = this.#legTxn(current);
          if (currentTxn.kind !== 'transfer-arrived' || currentTxn.sentId !== undefined) {
            throw new MoneyError('already-arrived', `${txn.sentId} has already arrived`);
          }
          displaced = current;
        }
        partner = named.id;
      } else if (this.#waitingFor(txn.sentId)) {
        throw new MoneyError('already-arrived', `another arrival is already waiting for ${txn.sentId}`);
      }
    } else {
      partner = this.#oldestUnpairedSent(txn);
    }
    this.#add({ kind: 'leg', id: txn.id, txn, effect: {} }, txn.to === 'old-card' ? { oldCardDebt: -txn.amount } : { inTransit: -txn.amount });
    if (displaced !== undefined && partner !== undefined) this.#unpair(partner, displaced);
    if (partner !== undefined) this.#pair(partner, txn.id);
    if (displaced !== undefined) {
      // The arrival that was paired by guess looks again for a leaving half.
      const other = this.#oldestUnpairedSent(this.#legTxn(displaced) as TransferArrived);
      if (other !== undefined) this.#pair(other, displaced);
    }
    return { id: txn.id, outcome: 'sorted' };
  }

  #legTxn(id: string): TransferSent | TransferArrived {
    const entry = this.#entry(id);
    const txn = 'txn' in entry ? entry.txn : null;
    if (txn === null || (txn.kind !== 'transfer-sent' && txn.kind !== 'transfer-arrived')) {
      throw new MoneyError('broken-book', `${id} is not half of a transfer`);
    }
    return txn;
  }

  #unpair(a: string, b: string): void {
    this.#pairs.delete(a);
    this.#pairs.delete(b);
  }

  #oldestUnpairedSent(arrival: TransferArrived): string | undefined {
    for (const entry of this.#entries.values()) {
      const txn = 'txn' in entry ? entry.txn : null;
      if (txn?.kind === 'transfer-sent' && !this.#pairs.has(entry.id) && sameRoute(txn, arrival)) return entry.id;
    }
    return undefined;
  }

  #waitingFor(sentId: string): boolean {
    for (const entry of this.#entries.values()) {
      if (entry.kind === 'leg' && entry.txn.kind === 'transfer-arrived' && entry.txn.sentId === sentId && !this.#pairs.has(entry.id)) return true;
    }
    return false;
  }

  #pair(sentId: string, arrivedId: string): void {
    this.#pairs.set(sentId, arrivedId);
    this.#pairs.set(arrivedId, sentId);
  }

  // Rule 7.4: a payment to a person waits in review unless a rule covers
  // that person.
  #receivePersonPayment(txn: PersonPayment): Received {
    if (matchesTextRule(this.#settings.momRule, txn.description)) return this.#payMom(txn);
    const rule = findRule(this.#rules, 'person', txn.description);
    return this.#addSpending(txn, 'person-payment', rule === undefined ? { to: 'unsorted' } : { to: rule.choice.to });
  }

  #knownTransaction(id: string): BankTransaction | undefined {
    const postedFor = this.#aliases.get(id);
    if (postedFor !== undefined) {
      const entry = this.#entry(postedFor);
      return 'postedTxn' in entry ? (entry.postedTxn ?? undefined) : undefined;
    }
    const entry = this.#entries.get(id);
    return entry !== undefined && 'txn' in entry ? entry.txn : undefined;
  }

  // Rules 8.1 and 8.3: a mom payment comes out of the reserve, whatever the
  // day or amount. If the reserve cannot cover it all, the difference waits
  // in review for you to pick a bucket.
  #payMom(txn: PersonPayment): Received {
    const fromReserve = Math.min(txn.amount, Math.max(0, this.#totals.momReserve));
    const mom: MomEntry = { kind: 'mom', id: txn.id, txn, fromReserve, effect: {} };
    this.#add(mom, { momReserve: -fromReserve });
    const difference = txn.amount - fromReserve;
    if (difference === 0) return { id: txn.id, outcome: 'sorted' };
    const entry: SpendEntry = {
      kind: 'spend',
      id: `${txn.id}:difference`,
      txn,
      spendingKind: 'mom-difference',
      postedTxn: null,
      pending: false,
      amount: difference,
      refunded: 0,
      countedAtSetup: 0,
      sortedTo: { to: 'unsorted' },
      splitChanged: false,
      effect: {},
    };
    try {
      this.#addSpendingEntry(entry);
    } catch (error) {
      this.#remove(mom);
      throw error;
    }
    return { id: txn.id, outcome: 'review' };
  }

  // Section 5.
  #receiveTransfer(txn: Transfer): Received {
    if (txn.to !== 'old-card') {
      // 5.1 and 5.3: between your own accounts, so no bucket changes. A
      // move to or from savings only changes what is left to move (3.8).
      this.#add({ kind: 'transfer', id: txn.id, txn, effect: {} }, {});
      return { id: txn.id, outcome: 'sorted' };
    }
    // 5.2: a payment to the old card is spending from needs. From savings
    // the rulebook does not say, so it waits in review (QUESTIONS.md).
    return this.#addSpending(txn, 'debt-payoff', txn.from === 'checking' ? { to: 'needs' } : { to: 'unsorted' });
  }

  // 5.4 and 5.5: old card activity changes the debt shown and no bucket. A
  // new purchase is flagged in review.
  #addOldCard(txn: Purchase | CardCharge | Refund): Received {
    const pending = txn.kind === 'purchase' && txn.pending;
    const entry: OldCardEntry = { kind: 'old-card', id: txn.id, txn, postedTxn: null, pending, amount: txn.amount, countedAtSetup: 0, effect: {} };
    this.#add(entry, { oldCardDebt: txn.kind === 'refund' ? -txn.amount : txn.amount });
    if (txn.kind !== 'purchase') return { id: txn.id, outcome: 'sorted' };
    this.#review.add(entry.id);
    return { id: txn.id, outcome: 'review' };
  }

  #receiveDeposit(txn: Deposit): Received {
    const s = this.#settings;
    if (!matchesTextRule(s.paycheckRule, txn.description)) {
      const rule = findRule(this.#rules, 'deposit', txn.description);
      const result = this.#holdMoneyIn(txn, 'deposit');
      if (rule === undefined) return result;
      // 6.2: a rule for a known source makes the choice automatically.
      const entry = this.#moneyInEntry(txn.id);
      try {
        this.#sortMoneyIn(entry, rule.choice);
      } catch (error) {
        this.#remove(entry);
        throw error;
      }
      return { id: txn.id, outcome: 'sorted' };
    }
    // Rule 3.7: too soon after the last paycheck to split automatically.
    if (daysBetween(this.#lastPaycheckDate, txn.date) < s.earlyPaycheckDays) return this.#holdMoneyIn(txn, 'early-paycheck');
    this.#payday(txn);
    return { id: txn.id, outcome: 'paycheck' };
  }

  #holdMoneyIn(txn: Deposit | Refund, reason: MoneyInReason): Received {
    const entry: MoneyInEntry = { kind: 'money-in', id: txn.id, txn, reason, sortedTo: 'unsorted', incomeSplit: null, effect: {} };
    this.#add(entry, { unsortedIn: txn.amount });
    this.#review.add(entry.id);
    return { id: txn.id, outcome: 'review' };
  }

  // Rules 4.1, 4.2, 4.6.
  #receivePurchase(txn: Purchase): Received {
    if (txn.pendingId !== undefined) {
      const target = this.#entries.get(this.#aliases.get(txn.pendingId) ?? txn.pendingId);
      if (target !== undefined) {
        if ((target.kind !== 'spend' && target.kind !== 'old-card') || !target.pending) {
          throw new MoneyError('already-posted', `${txn.pendingId} is not a pending purchase`);
        }
        if (target.txn.kind !== 'purchase' || target.txn.account !== txn.account) {
          throw new MoneyError('bad-transaction', `${txn.id} is on a different account from the pending charge it replaces`);
        }
        return this.#post(target, txn);
      }
      // The app never saw the pending charge, so this is simply a new purchase.
    }
    if (txn.account === 'old-card') return this.#addOldCard(txn);
    const rule = findRule(this.#rules, 'purchase', txn.description);
    return this.#addSpending(txn, 'purchase', rule === undefined ? { to: 'unsorted' } : { to: rule.bucket });
  }

  #addSpending(txn: Purchase | CardCharge | Transfer | TransferSent | PersonPayment, spendingKind: SpendingKind, sortedTo: SpendingSort): Received {
    const pending = txn.kind === 'purchase' && txn.pending;
    const entry: SpendEntry = {
      kind: 'spend',
      id: txn.id,
      txn,
      spendingKind,
      postedTxn: null,
      pending,
      amount: txn.amount,
      refunded: 0,
      countedAtSetup: 0,
      sortedTo,
      splitChanged: false,
      effect: {},
    };
    this.#addSpendingEntry(entry);
    return { id: txn.id, outcome: this.#review.has(entry.id) ? 'review' : 'sorted' };
  }

  // Rule 4.6: the posted charge replaces the pending one, even at a new amount.
  #post(entry: SpendEntry | OldCardEntry, txn: Purchase): Received {
    const before = { postedTxn: entry.postedTxn, pending: entry.pending, amount: entry.amount };
    const sortedBefore = entry.kind === 'spend' ? { sortedTo: entry.sortedTo, splitChanged: entry.splitChanged } : null;
    entry.postedTxn = txn;
    entry.pending = false;
    entry.amount = txn.amount;
    try {
      if (entry.kind === 'spend') this.#refreshSpending(entry);
      else this.#setEffect(entry, { oldCardDebt: txn.amount - entry.countedAtSetup });
    } catch (error) {
      // Too large to stay exact (0.1): the pending charge stays as it was.
      Object.assign(entry, before, sortedBefore ?? {});
      throw error;
    }
    this.#aliases.set(txn.id, entry.id);
    return { id: txn.id, outcome: 'posted' };
  }

  // Rule 4.5.
  #receiveRefund(txn: Refund): Received {
    const target = txn.refundOf === undefined ? undefined : this.#entries.get(this.#aliases.get(txn.refundOf) ?? txn.refundOf);
    if (target?.kind !== 'spend' || target.spendingKind === 'debt-payoff' || txn.amount > target.amount - target.refunded) {
      return this.#holdMoneyIn(txn, 'refund');
    }
    const refunded = addCents(target.refunded, txn.amount);
    const before = { refunded: target.refunded, sortedTo: target.sortedTo, splitChanged: target.splitChanged };
    const entry: RefundEntry = { kind: 'refund', id: txn.id, txn, of: target.id, effect: {} };
    this.#add(entry, {});
    target.refunded = refunded;
    try {
      this.#refreshSpending(target);
    } catch (error) {
      // Too large to stay exact (0.1): the purchase stays as it was.
      Object.assign(target, before);
      this.#forget(entry.id);
      throw error;
    }
    return { id: txn.id, outcome: 'sorted' };
  }

  // Works out what a purchase does to the buckets now. A split that no
  // longer adds up (after a partial refund, or posting at a new amount) goes
  // back to review to be split again. A full refund of a split purchase
  // gives each bucket its part back (4.5): the split stays, and nothing waits.
  #refreshSpending(entry: SpendEntry): void {
    const net = netOf(entry);
    const sorted = entry.sortedTo;
    if ('split' in sorted && net !== 0 && sorted.split.reduce((sum, part) => sum + part.amount, 0) !== net) {
      entry.sortedTo = { to: 'unsorted' };
      entry.splitChanged = true;
    }
    // A charge counted at setup that posted at a new amount, or was
    // refunded: the difference waits in review.
    if ('to' in sorted && sorted.to === 'counted-at-setup' && net !== 0) entry.sortedTo = { to: 'unsorted' };
    const now = entry.sortedTo;
    let effect: Effect;
    if ('split' in now) {
      effect = {};
      if (net !== 0) for (const part of now.split) effect[part.bucket] = subtractCents(effect[part.bucket] ?? 0, part.amount);
    } else if (now.to === 'unsorted') {
      effect = { unsortedOut: net };
    } else if (now.to === 'not-mine') {
      effect = { heldForOthers: -net };
    } else if (now.to === 'counted-at-setup') {
      effect = {};
    } else {
      effect = { [now.to]: -net };
    }
    // A payment to the old card also lowers the debt, however it is sorted.
    // When only the leaving half has been seen, the debt waits for it to
    // land (12.5).
    if (entry.spendingKind === 'debt-payoff' && entry.txn.kind === 'transfer') effect.oldCardDebt = -entry.amount;
    this.#setEffect(entry, effect);
    if ('to' in now && now.to === 'unsorted') this.#review.add(entry.id);
    else this.#review.delete(entry.id);
  }

  // Rules 3.1 to 3.5. A paycheck too large to stay exact (0.1) is refused
  // whole: no leftover moves, no question, no new pay period.
  #payday(txn: Deposit): void {
    this.#atomically(() => {
      this.#closePeriod('needs', txn);
      this.#closePeriod('wants', txn);
      // 13.1: a change to the split or the reserve applies from this paycheck.
      this.#periodSplit = splitSettingsOf(this.#settings);
      const split = splitPaycheck(txn.amount, this.#totals.momReserve, this.#periodSplit);
      const entry: PaycheckEntry = { kind: 'paycheck', id: txn.id, txn, split, effect: {} };
      this.#add(entry, { momReserve: split.momReserve, savings: split.savings, needs: split.needs, wants: split.wants });
      this.#paychecks.push({ id: txn.id, date: txn.date, amount: txn.amount, split });
      this.#period = { number: this.#period.number + 1, startDate: txn.date };
      this.#periodStart.needs = this.#totals.needs;
      this.#periodStart.wants = this.#totals.wants;
      this.#lastPaycheckDate = txn.date;
    });
  }

  // Rule 3.4: unspent money in a bucket at payday either rolls over or moves
  // to savings. A negative balance just carries over (3.5).
  #closePeriod(bucket: SplitBucket, txn: Deposit): void {
    // An unanswered question from an earlier payday is replaced by this one,
    // which covers everything now in the bucket, so nothing can move twice.
    for (const id of this.#review) {
      const old = this.#entry(id);
      if (old.kind === 'leftover' && old.bucket === bucket) {
        this.#review.delete(id);
        this.#entries.delete(id);
      }
    }
    const amount = this.#totals[bucket];
    const choice = this.#settings.leftoverAtPayday[bucket];
    if (amount <= 0 || choice === 'roll-over') return;
    const entry: LeftoverEntry = { kind: 'leftover', id: `leftover:${txn.id}:${bucket}`, date: txn.date, bucket, amount, answer: 'open', effect: {} };
    this.#add(entry, {});
    if (choice === 'ask') this.#review.add(entry.id);
    else this.#answerLeftover(entry, 'move-to-savings');
  }

  // ----- Your answers -----

  // An open question is always about the payday that started this pay
  // period (an older one is replaced at the next payday). Moving the
  // leftover to savings also takes it out of what the bucket started this
  // pay period with (10.1).
  answerLeftover(id: string, answer: LeftoverAnswer, date: IsoDate): void {
    assertIsoDate(date);
    if (answer !== 'roll-over' && answer !== 'move-to-savings') throw new MoneyError('bad-choice', `not a leftover choice: ${String(answer)}`);
    const entry = this.#entries.get(id);
    if (entry?.kind !== 'leftover' || !this.#review.has(id)) throw new MoneyError('unknown-item', `no open leftover question ${id}`);
    const start = answer === 'move-to-savings' ? subtractCents(this.#periodStart[entry.bucket], entry.amount) : this.#periodStart[entry.bucket];
    this.#answerLeftover(entry, answer);
    this.#periodStart[entry.bucket] = start;
    this.#review.delete(id);
  }

  #answerLeftover(entry: LeftoverEntry, answer: LeftoverAnswer): void {
    if (answer === 'move-to-savings') this.#setEffect(entry, { [entry.bucket]: -entry.amount, savings: entry.amount });
    entry.answer = answer;
  }

  // Sorts something waiting in review, or re-sorts it later (4.7).
  sort(id: string, choice: SortChoice, date: IsoDate): void {
    assertIsoDate(date);
    const entry = this.#entries.get(this.#aliases.get(id) ?? id);
    if (entry === undefined) throw new MoneyError('unknown-item', `no item ${id}`);
    switch (entry.kind) {
      case 'spend':
        if ((entry.txn.kind === 'transfer' || entry.txn.kind === 'transfer-sent') && entry.txn.from === 'checking') {
          throw new MoneyError('not-sortable', `${id} is a payment to the old card, which always comes out of needs (5.2)`);
        }
        return this.#sortSpending(entry, choice);
      case 'money-in':
        return this.#sortMoneyIn(entry, choice);
      default:
        throw new MoneyError('not-sortable', `${id} is a ${entry.kind} and cannot be sorted`);
    }
  }

  // Clears a flag in review that has no money to sort (5.4).
  acknowledge(id: string, date: IsoDate): void {
    assertIsoDate(date);
    const entry = this.#entries.get(id);
    if (entry?.kind !== 'old-card' || !this.#review.has(id)) throw new MoneyError('unknown-item', `no flag ${id} waiting in review`);
    this.#review.delete(id);
  }

  // Rules 4.3, 4.4, 4.7, 4.8, 7.2.
  #sortSpending(entry: SpendEntry, choice: SortChoice): void {
    const before = { sortedTo: entry.sortedTo, splitChanged: entry.splitChanged };
    if (entry.spendingKind === 'person-payment') {
      if (!isPersonPaymentChoice(choice)) throw new MoneyError('bad-choice', 'a payment to a person goes to needs, wants, or not mine');
      entry.sortedTo = Object.freeze({ to: choice.to });
    } else if (entry.spendingKind === 'mom-difference' && 'split' in choice) {
      throw new MoneyError('bad-choice', 'the difference on a mom payment goes to needs or wants');
    } else if ('split' in choice) {
      if (!Array.isArray(choice.split)) throw new MoneyError('bad-choice', 'a split needs a list of parts');
      const parts = choice.split.map((part) => {
        if (!isSpendingBucket(part.bucket)) throw new MoneyError('bad-choice', `spending can go to needs or wants, not ${String(part.bucket)}`);
        assertPositiveCents(part.amount, 'each part of a split');
        return Object.freeze({ bucket: part.bucket, amount: part.amount });
      });
      const total = addCents(0, ...parts.map((part) => part.amount));
      const net = netOf(entry);
      if (total !== net) throw new MoneyError('split-does-not-add-up', `the parts add up to ${total}, the purchase is ${net}`);
      entry.sortedTo = Object.freeze({ split: Object.freeze(parts) });
    } else if (isSpendingBucket(choice.to)) {
      entry.sortedTo = Object.freeze({ to: choice.to });
    } else {
      throw new MoneyError('bad-choice', `spending can go to needs or wants, not ${String(choice.to)}`);
    }
    entry.splitChanged = false;
    try {
      this.#refreshSpending(entry);
    } catch (error) {
      // Too large to stay exact (0.1): it stays sorted the way it was.
      Object.assign(entry, before);
      throw error;
    }
  }

  // Rule 6.1: this is my paycheck, other income, payback, or not mine. A
  // store refund the app could not match can be payback or not mine, but
  // neither kind of income.
  #sortMoneyIn(entry: MoneyInEntry, choice: SortChoice): void {
    if (!isMoneyInChoice(choice)) throw new MoneyError('bad-choice', 'money in is your paycheck, other income, payback into one bucket, or not mine');
    const txn = entry.txn;
    if (choice.to === 'paycheck' || choice.to === 'other-income') {
      if (txn.kind === 'refund') throw new MoneyError('bad-choice', 'a store refund is not income');
      if (choice.to === 'paycheck') return this.#makePaycheck(entry, txn);
    }
    const amount = txn.amount;
    let effect: Effect;
    let incomeSplit: PaycheckSplit | null = null;
    if (choice.to === 'other-income') {
      // Split by this pay period's percentages (13.1), with no mom reserve:
      // the reserve comes only from paychecks.
      incomeSplit = splitPaycheck(amount, this.#totals.momReserve, { ...this.#periodSplit, momReservePerPaycheck: 0 });
      effect = { momReserve: incomeSplit.momReserve, savings: incomeSplit.savings, needs: incomeSplit.needs, wants: incomeSplit.wants };
    } else if (choice.to === 'not-mine') {
      effect = { heldForOthers: amount };
    } else {
      effect = { [choice.to]: amount };
    }
    this.#setEffect(entry, effect);
    entry.sortedTo = choice.to;
    entry.incomeSplit = incomeSplit;
    this.#review.delete(entry.id);
  }

  // 6.1 "this is my paycheck": it starts a new pay period exactly as if the
  // paycheck rule had matched it (3.1 to 3.5), and like any paycheck it is
  // final. Whatever it was sorted to before is taken back first. A deposit
  // older than the last paycheck cannot start a pay period; it can still be
  // other income.
  #makePaycheck(entry: MoneyInEntry, txn: Deposit): void {
    if (daysBetween(this.#lastPaycheckDate, txn.date) < 0) {
      throw new MoneyError('bad-choice', `${txn.id} is older than the last paycheck, so it cannot start a new pay period; it can be other income`);
    }
    this.#atomically(() => {
      this.#remove(entry);
      this.#payday(txn);
    });
  }

  #moneyInEntry(id: string): MoneyInEntry {
    const entry = this.#entry(id);
    if (entry.kind !== 'money-in') throw new MoneyError('broken-book', `${id} is not money in`);
    return entry;
  }

  // ----- Changes (section 13) -----

  // 13.1: a change to the split or the mom reserve applies from the next
  // paycheck; everything else applies right away. 0.3: nothing already
  // worked out is redone.
  changeSettings(patch: Partial<Settings>, date: IsoDate): void {
    assertIsoDate(date);
    const next = applySettingsChange(this.#settings, patch);
    this.#settings = next;
    const changes = Object.fromEntries(Object.keys(patch).map((key) => [key, next[key as keyof Settings]]));
    this.#log.push(Object.freeze({ date, kind: 'settings-changed', changes }));
  }

  // 13.2: a new or changed rule applies to new transactions and to those
  // waiting in review. Anything already sorted stays put.
  addRule(rule: SortingRule, date: IsoDate): void {
    assertIsoDate(date);
    this.#atomically(() => {
      this.#rules = checkRules([...this.#rules, rule]);
      this.#log.push(Object.freeze({ date, kind: 'rule-added', rule: this.#ruleById(rule.id) }));
      this.#sortWaitingByRules(rule.id);
    });
  }

  // 13.6: re-sort an item and "always do this". The new rule goes just ahead
  // of the rule it corrects, so the correction sticks: the earliest rule that
  // matches the item, either as it first arrived (new purchases are sorted
  // on that, often a pending description) or as it posted. If no rule
  // matches it, the new rule goes at the end. The rule's text must match the
  // item one way or the other. sticks says whether the next item arriving
  // the way this one did will now go where you sorted this one.
  sortAlways(id: string, choice: SortChoice, rule: { readonly id: string; readonly contains: string }, date: IsoDate): { readonly sticks: boolean } {
    assertIsoDate(date);
    const entry = this.#entries.get(this.#aliases.get(id) ?? id);
    if (entry === undefined) throw new MoneyError('unknown-item', `no item ${id}`);
    let newRule: SortingRule;
    // How the item has appeared: as it arrived first, then as it posted.
    let descriptions: string[];
    if (entry.kind === 'spend' && entry.spendingKind === 'purchase') {
      if ('split' in choice || !isSpendingBucket(choice.to)) throw new MoneyError('bad-choice', 'a rule picks needs or wants; it cannot split');
      newRule = { id: rule.id, for: 'purchase', contains: rule.contains, bucket: choice.to };
      descriptions = [entry.txn.description, ...(entry.postedTxn === null ? [] : [entry.postedTxn.description])];
    } else if (entry.kind === 'spend' && entry.spendingKind === 'person-payment') {
      if (!isPersonPaymentChoice(choice)) throw new MoneyError('bad-choice', 'a payment to a person goes to needs, wants, or not mine');
      newRule = { id: rule.id, for: 'person', contains: rule.contains, choice: { to: choice.to } };
      descriptions = [entry.txn.description];
    } else if (entry.kind === 'money-in' && entry.reason === 'deposit') {
      if (!isDepositRuleChoice(choice)) {
        throw new MoneyError('bad-choice', 'a deposit rule picks other income, a bucket, or not mine; paychecks are found by the paycheck rule in settings');
      }
      newRule = { id: rule.id, for: 'deposit', contains: rule.contains, choice: { to: choice.to } };
      descriptions = [entry.txn.description];
    } else {
      throw new MoneyError('no-rule-for-this', `${id} is not something a sorting rule can cover`);
    }
    const covers = (r: SortingRule): boolean => r.for === newRule.for && descriptions.some((d) => matchesTextRule(r, d));
    if (!covers(newRule)) throw new MoneyError('bad-rule', `"${rule.contains}" does not match ${descriptions.map((d) => `"${d}"`).join(' or ')}`);
    const found = this.#rules.findIndex(covers);
    const at = found === -1 ? this.#rules.length : found;
    const corrected = this.#rules[at];
    return this.#atomically(() => {
      this.#rules = checkRules([...this.#rules.slice(0, at), newRule, ...this.#rules.slice(at)]);
      this.sort(entry.id, choice, date);
      const added = this.#ruleById(newRule.id);
      this.#log.push(Object.freeze({ date, kind: 'rule-added-from-correction', rule: added, correcting: entry.id, aheadOf: corrected?.id ?? null }));
      this.#sortWaitingByRules(added.id);
      return { sticks: findRule(this.#rules, newRule.for, descriptions[0] ?? '')?.id === added.id };
    });
  }

  changeRule(rule: SortingRule, date: IsoDate): void {
    assertIsoDate(date);
    const before = this.#ruleById(rule.id);
    this.#atomically(() => {
      this.#rules = checkRules(this.#rules.map((r) => (r.id === rule.id ? rule : r)));
      this.#log.push(Object.freeze({ date, kind: 'rule-changed', before, after: this.#ruleById(rule.id) }));
      this.#sortWaitingByRules(rule.id);
    });
  }

  removeRule(id: string, date: IsoDate): void {
    assertIsoDate(date);
    const rule = this.#ruleById(id);
    this.#rules = checkRules(this.#rules.filter((r) => r.id !== id));
    this.#log.push(Object.freeze({ date, kind: 'rule-removed', rule }));
  }

  #ruleById(id: string): SortingRule {
    const rule = this.#rules.find((r) => r.id === id);
    if (rule === undefined) throw new MoneyError('unknown-rule', `no rule ${id}`);
    return rule;
  }

  // 13.2: a new or changed rule sorts the items waiting in review that it is
  // now the first match for. It never lets another, older rule sort them:
  // an item an older rule matches is waiting for a reason (a split that
  // stopped adding up, a difference from setup day), and is yours to decide.
  #sortWaitingByRules(ruleId: string): void {
    for (const id of [...this.#review]) {
      const entry = this.#entry(id);
      const unsortedSpending = entry.kind === 'spend' && 'to' in entry.sortedTo && entry.sortedTo.to === 'unsorted';
      if (unsortedSpending && entry.spendingKind === 'purchase') {
        const rule = this.#firstMatchIfIt(ruleId, 'purchase', (entry.postedTxn ?? entry.txn).description);
        if (rule !== undefined) this.#sortSpending(entry, { to: rule.bucket });
      } else if (unsortedSpending && entry.spendingKind === 'person-payment') {
        const rule = this.#firstMatchIfIt(ruleId, 'person', entry.txn.description);
        if (rule !== undefined) this.#sortSpending(entry, rule.choice);
      } else if (entry.kind === 'money-in' && entry.reason === 'deposit' && entry.sortedTo === 'unsorted') {
        const rule = this.#firstMatchIfIt(ruleId, 'deposit', entry.txn.description);
        if (rule !== undefined) this.#sortMoneyIn(entry, rule.choice);
      }
    }
  }

  // The first rule of this kind that matches, but only if it is the rule
  // with this id.
  #firstMatchIfIt<K extends SortingRule['for']>(ruleId: string, kind: K, description: string): Extract<SortingRule, { for: K }> | undefined {
    const rule = findRule(this.#rules, kind, description);
    return rule?.id === ruleId ? rule : undefined;
  }

  // 13.3 and 13.4: move money between buckets by hand. Moving out of
  // savings or the mom reserve, or a move that would leave the bucket it
  // comes out of below zero (usually a typo), needs your confirmation first.
  moveMoney(move: MoneyMove, date: IsoDate): MoveResult {
    assertIsoDate(date);
    const { from, to, amount } = move;
    if (!MOVABLE.includes(from) || !MOVABLE.includes(to) || from === to) {
      throw new MoneyError('bad-move', `cannot move money from ${String(from)} to ${String(to)}`);
    }
    assertPositiveCents(amount, 'amount to move');
    const reasons: ConfirmReason[] = [];
    if (from === 'savings') reasons.push('out-of-savings');
    if (from === 'momReserve') reasons.push('out-of-mom-reserve');
    if (subtractCents(this.#totals[from], amount) < 0) reasons.push('below-zero');
    if (reasons.length > 0 && move.confirmed !== true) return { moved: false, needsConfirmation: true, reasons };
    this.#moveCount += 1;
    const entry: MoveEntry = { kind: 'move', id: `move:${this.#moveCount}`, date, effect: {} };
    this.#add(entry, { [from]: -amount, [to]: amount });
    this.#log.push(Object.freeze({ date, kind: 'money-moved', from, to, amount }));
    return { moved: true };
  }

  changeLog(): readonly ChangeLogEntry[] {
    return [...this.#log];
  }

  // ----- Bookkeeping -----

  // Runs a change made of several steps (a payday, a rule sorting what is
  // waiting) all or nothing: if any step is refused, the whole book goes
  // back exactly as it was (0.1). Each step can then assume the ones before
  // it stand, with no check of its own done in advance.
  #atomically<T>(change: () => T): T {
    const saved = {
      totals: { ...this.#totals },
      entries: [...this.#entries.values()].map((entry): Entry => ({ ...entry })),
      aliases: [...this.#aliases],
      pairs: [...this.#pairs],
      review: [...this.#review],
      paychecks: this.#paychecks.length,
      log: this.#log.length,
      moveCount: this.#moveCount,
      lowAlerted: { ...this.#lowAlerted },
      emptyAlerted: { ...this.#emptyAlerted },
      periodStart: { ...this.#periodStart },
      periodSplit: this.#periodSplit,
      rules: this.#rules,
      lastPaycheckDate: this.#lastPaycheckDate,
      period: this.#period,
    };
    try {
      return change();
    } catch (error) {
      Object.assign(this.#totals, saved.totals);
      this.#entries.clear();
      for (const entry of saved.entries) this.#entries.set(entry.id, entry);
      this.#aliases.clear();
      for (const [k, v] of saved.aliases) this.#aliases.set(k, v);
      this.#pairs.clear();
      for (const [k, v] of saved.pairs) this.#pairs.set(k, v);
      this.#review.clear();
      for (const id of saved.review) this.#review.add(id);
      this.#paychecks.length = saved.paychecks;
      this.#log.length = saved.log;
      this.#moveCount = saved.moveCount;
      Object.assign(this.#lowAlerted, saved.lowAlerted);
      Object.assign(this.#emptyAlerted, saved.emptyAlerted);
      Object.assign(this.#periodStart, saved.periodStart);
      this.#periodSplit = saved.periodSplit;
      this.#rules = saved.rules;
      this.#lastPaycheckDate = saved.lastPaycheckDate;
      this.#period = saved.period;
      throw error;
    }
  }

  #entry(id: string): Entry {
    const entry = this.#entries.get(id);
    if (entry === undefined) throw new MoneyError('unknown-item', `no item ${id}`);
    return entry;
  }

  // Adds an entry and what it does. If its totals would be too large to
  // stay exact (0.1), the entry is not kept, so nothing changes and the same
  // transaction can be tried again.
  #add(entry: Entry, effect: Effect): void {
    this.#register(entry);
    try {
      this.#setEffect(entry, effect);
    } catch (error) {
      this.#forget(entry.id);
      throw error;
    }
  }

  // The same for spending, whose effect follows from how it is sorted.
  #addSpendingEntry(entry: SpendEntry): void {
    this.#register(entry);
    try {
      this.#refreshSpending(entry);
    } catch (error) {
      this.#forget(entry.id);
      throw error;
    }
  }

  // Takes back an entry whose effect is already undone (or never applied).
  #forget(id: string): void {
    this.#entries.delete(id);
    this.#review.delete(id);
  }

  // Undoes an entry completely.
  #remove(entry: Entry): void {
    this.#setEffect(entry, {});
    this.#forget(entry.id);
  }

  // Two entries can never share an id: the second would silently replace
  // the first and its money would vanish from the recount.
  #register(entry: Entry): void {
    if (this.#entries.has(entry.id)) throw new MoneyError('broken-book', `two entries would share the id ${entry.id}`);
    this.#entries.set(entry.id, entry);
  }

  // Replaces what an entry does to the buckets. Works out every new total
  // first, so a total too large to stay exact changes nothing.
  #setEffect(entry: Entry, next: Effect): void {
    const updated = { ...this.#totals };
    for (const name of TOTAL_NAMES) {
      const change = subtractCents(next[name] ?? 0, entry.effect[name] ?? 0);
      updated[name] = addCents(updated[name], change);
    }
    Object.assign(this.#totals, updated);
    entry.effect = { ...next };
  }

  #reviewView(entry: Entry): ReviewItem {
    switch (entry.kind) {
      case 'money-in': {
        const { id, date, amount, description } = entry.txn;
        return { type: 'money-in', id, date, amount, description, reason: entry.reason };
      }
      case 'spend': {
        const reason = entry.countedAtSetup > 0 ? 'setup-difference' : entry.splitChanged ? 'split-changed' : spendingReason(entry.spendingKind);
        const description = (entry.postedTxn ?? entry.txn).description;
        // Fees, interest, and old card payments suggest needs (4.8, 5.2).
        const suggestion = ['purchase', 'person-payment', 'mom-difference'].includes(entry.spendingKind) ? null : 'needs';
        return { type: 'spending', id: entry.id, date: entry.txn.date, amount: netOf(entry), description, reason, suggestion };
      }
      case 'leftover':
        return { type: 'leftover', id: entry.id, date: entry.date, bucket: entry.bucket, amount: entry.amount };
      case 'old-card':
        return { type: 'old-card-purchase', id: entry.id, date: entry.txn.date, amount: entry.amount, description: (entry.postedTxn ?? entry.txn).description };
      case 'paycheck':
      case 'refund':
      case 'mom':
      case 'move':
      case 'leg':
      case 'transfer':
        throw new MoneyError('broken-book', `${entry.kind} ${entry.id} should never be in review`);
    }
  }
}
