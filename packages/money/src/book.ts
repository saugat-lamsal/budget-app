import { ACCOUNTS, type AccountId } from './accounts.js';
import type { Alert, AlertInput } from './alerts.js';
import { isSpendingBucket, type SplitBucket } from './buckets.js';
import type { CardPayment } from './reminders.js';
import { addCents, assertCents, assertPositiveCents, subtractCents, type Cents } from './cents.js';
import { addDays, assertIsoDate, daysBetween, monthOf, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import { splitPaycheck, type PaycheckSplit, type SplitSettings } from './payday.js';
import { bankSide, type BankBalances } from './self-check.js';
import {
  checkRules,
  findRule,
  isDepositRuleChoice,
  isMoneyInChoice,
  isPersonPaymentChoice,
  type DepositRuleChoice,
  type MoneyInChoice,
  type PersonPaymentChoice,
  type SortingRule,
} from './rules.js';
import { changeSettings as applySettingsChange, matchesTextRule, validateSettings, type Settings } from './settings.js';
import {
  checkTransaction,
  sameTransaction,
  type BankTransaction,
  type CardCharge,
  type Deposit,
  type PendingChanged,
  type PendingDropped,
  type PersonPayment,
  type Purchase,
  type SavingsWithdrawal,
  type Refund,
  type TakenBack,
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
  readonly countedAtSetup?: readonly (Purchase | SavingsWithdrawal)[];
  // Transfers with only one half showing on setup day (12.5): money that had
  // left and not arrived, or arrived before it was seen leaving. The
  // starting money allows for them.
  readonly inTransitAtSetup?: readonly (TransferSent | TransferArrived)[];
}

export type ReceiveOutcome = 'paycheck' | 'sorted' | 'posted' | 'dropped' | 'changed' | 'taken-back' | 'review' | 'duplicate';

export interface Received {
  readonly id: string;
  readonly outcome: ReceiveOutcome;
}

export type LeftoverAnswer = 'roll-over' | 'move-to-savings';

// Part of a split (4.4). A payment to a person can also have a part that is
// not mine (7.6).
export interface SplitPart {
  readonly bucket: SplitBucket | 'not-mine';
  readonly amount: Cents;
}

// How you sort something in review, or re-sort it later (4.7). transfer
// names your other account, for spending or money in that was really a
// transfer between your accounts (5.6).
export type SortChoice = MoneyInChoice | PersonPaymentChoice | { readonly split: readonly SplitPart[] } | { readonly transfer: AccountId };

export type SpendingSort =
  | { readonly to: 'unsorted' }
  | { readonly to: SplitBucket }
  | { readonly split: readonly SplitPart[] }
  // A payment to a person that was not your spending (7.2).
  | { readonly to: 'not-mine' }
  // A payment to the old card from savings, taken from the savings bucket
  // once you confirm it (QUESTIONS.md A4).
  | { readonly to: 'savings' }
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
        // Money leaving savings always waits (4.9).
        | 'from-savings'
        | 'card-fee'
        | 'card-interest'
        | 'split-changed'
        | 'old-card-from-savings'
        | 'person-payment'
        | 'mom-difference'
        | 'setup-difference';
      // Savings only for a payment to the old card from savings (A4).
      readonly suggestion: SplitBucket | 'savings' | null;
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
  | { readonly date: IsoDate; readonly kind: 'money-moved'; readonly from: Pot; readonly to: Pot; readonly amount: Cents }
  // 4.10: the bank took back a transaction the app had counted.
  | { readonly date: IsoDate; readonly kind: 'bank-took-back'; readonly id: string; readonly description: string; readonly amount: Cents };

export interface SavingsTransfer {
  readonly shouldBeInSavings: Cents;
  readonly savingsAccountBalance: Cents;
  // What still needs to go into the savings account; $0 when it holds enough.
  readonly stillToMove: Cents;
  // Only when the account holds more than it should: by how much (3.8).
  readonly extraInSavings?: Cents;
}

// Every entry made from a bank transaction can be taken back by the bank
// (4.10). It then stays in the book, doing nothing, so the bank sending it
// again is still known.
interface FromTheBank {
  takenBack?: boolean;
}

interface PaycheckEntry extends FromTheBank {
  readonly kind: 'paycheck';
  readonly id: string;
  readonly txn: Deposit;
  readonly split: PaycheckSplit;
  effect: Effect;
}

interface MoneyInEntry extends FromTheBank {
  readonly kind: 'money-in';
  readonly id: string;
  readonly txn: Deposit | Refund;
  // A deposit waiting as a plain deposit becomes an early paycheck when a
  // new paycheck rule matches it (A9).
  reason: MoneyInReason;
  // A deposit you call your paycheck becomes a paycheck entry instead.
  sortedTo: 'unsorted' | DepositRuleChoice['to'];
  // How it was split, when sorted as other income.
  incomeSplit: PaycheckSplit | null;
  effect: Effect;
}

// Spending, or something you marked as a transfer (5.6): original is then
// what the bank sent, which sorting it some other way brings back.
interface SpendEntry extends FromTheBank {
  readonly kind: 'spend';
  readonly id: string;
  readonly txn: Purchase | SavingsWithdrawal | CardCharge | Transfer | TransferSent | PersonPayment;
  readonly spendingKind: SpendingKind;
  postedTxn: Purchase | SavingsWithdrawal | null;
  pending: boolean;
  amount: Cents;
  refunded: Cents;
  // The part already taken out of the starting money on setup day.
  readonly countedAtSetup: Cents;
  sortedTo: SpendingSort;
  // True when a split stopped adding up and was sent back to review.
  splitChanged: boolean;
  // True when the bank dropped it while pending (QUESTIONS.md A2).
  dropped?: boolean;
  original?: MarkedAsTransfer;
  // The posted version, when what you marked had been pending.
  originalPosted?: Purchase | SavingsWithdrawal;
  effect: Effect;
}

// What the bank sent that you can mark as a transfer between your accounts (5.6).
type MarkedAsTransfer = Purchase | SavingsWithdrawal | PersonPayment | Deposit | Refund;

// A refund matched to its purchase. Its money is counted on the purchase.
interface RefundEntry extends FromTheBank {
  readonly kind: 'refund';
  readonly id: string;
  readonly txn: Refund;
  readonly of: string;
  effect: Effect;
}

// A payment to mom (8.1). It takes what it can from the mom reserve; any
// difference is a separate spending entry waiting in review (8.3). how:
// the mom rule matched it (it always stays on the reserve), or a person
// rule or you picked "for mom" (7.6), which can be sorted again.
interface MomEntry extends FromTheBank {
  readonly kind: 'mom';
  readonly id: string;
  readonly txn: PersonPayment;
  readonly fromReserve: Cents;
  readonly how: 'mom-rule' | 'person-rule' | 'by-hand';
  effect: Effect;
}

// One half of a transfer (12.5). The leaving half of a payment to the old
// card is a spending entry instead (5.2), except on setup day.
interface LegEntry extends FromTheBank {
  readonly kind: 'leg';
  readonly id: string;
  readonly txn: TransferSent | TransferArrived;
  original?: MarkedAsTransfer;
  originalPosted?: Purchase | SavingsWithdrawal;
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
interface TransferEntry extends FromTheBank {
  readonly kind: 'transfer';
  readonly id: string;
  readonly txn: Transfer;
  effect: Effect;
}

// Old card activity that changes only the debt (5.4, 5.5).
interface OldCardEntry extends FromTheBank {
  readonly kind: 'old-card';
  readonly id: string;
  readonly txn: Purchase | CardCharge | Refund;
  postedTxn: Purchase | SavingsWithdrawal | null;
  pending: boolean;
  amount: Cents;
  // The part already in the old card balance on setup day.
  readonly countedAtSetup: Cents;
  effect: Effect;
}

// A leftover question at payday (3.4). amount is what was unspent at
// payday; spentBefore is what spending made before payday had taken from
// the bucket then. Spending made before payday that shows up or changes
// afterward lowers the question, while it is open (B4).
interface LeftoverEntry {
  readonly kind: 'leftover';
  readonly id: string;
  readonly date: IsoDate;
  readonly bucket: SplitBucket;
  readonly amount: Cents;
  readonly spentBefore: Cents;
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
  // Pending charges the bank dropped, by the id of the drop (QUESTIONS.md A2).
  readonly #drops = new Map<string, PendingDropped>();
  // Pending charges whose amount the bank changed, by the id of the change (A13).
  readonly #changes = new Map<string, PendingChanged>();
  // Transactions the bank took back, by the id of the take-back (A14).
  readonly #takenBacks = new Map<string, TakenBack>();
  // Alerts that come once, when something happens (10.6), not yet given.
  readonly #notices: Alert[] = [];
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
  #countAtSetup(txn: Purchase | SavingsWithdrawal): void {
    checkTransaction(txn);
    if (!txn.pending) throw new MoneyError('bad-transaction', `${txn.id} was not pending on setup day`);
    const copy = Object.freeze({ ...txn });
    if (copy.kind === 'purchase' && copy.account === 'old-card') {
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
      if (txn === null || (txn.kind !== 'transfer-sent' && txn.kind !== 'transfer-arrived') || this.#pairs.has(entry.id) || this.#gone(entry)) continue;
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
    // 10.6: what the bank took back since the alerts were last taken, in order.
    alerts.push(...this.#notices);
    // Marked only once everything above worked, so a refused call gives nothing.
    for (const bucket of newlyLow) this.#lowAlerted[bucket] = this.#period.number;
    for (const bucket of newlyEmpty) this.#emptyAlerted[bucket] = this.#period.number;
    this.#notices.length = 0;
    return alerts;
  }

  // Rule 8.2: everything sent to mom in a calendar month ("YYYY-MM").
  momSentInMonth(month: string): MomMonth {
    assertIsoDate(`${month}-01`, 'month');
    if (month.length !== 7) throw new MoneyError('not-a-date', `month must be YYYY-MM, got ${month}`);
    let sent = 0;
    for (const entry of this.#entries.values()) {
      if (entry.kind === 'mom' && !this.#gone(entry) && monthOf(entry.txn.date) === month) sent = addCents(sent, entry.txn.amount);
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
      if (txn === null || !('to' in txn) || txn.to !== card || this.#gone(entry)) continue;
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
    return this.#dispatch(Object.freeze({ ...txn }));
  }

  // Hands a checked transaction to whatever deals with its kind.
  #dispatch(copy: BankTransaction): Received {
    switch (copy.kind) {
      case 'deposit':
        return this.#receiveDeposit(copy);
      case 'purchase':
      case 'savings-withdrawal':
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
      case 'pending-dropped':
        return this.#receiveDropped(copy);
      case 'pending-changed':
        return this.#receivePendingChanged(copy);
      case 'taken-back':
        return this.#receiveTakenBack(copy);
    }
  }

  // QUESTIONS.md A13: the bank changed a pending charge's amount before it
  // posted. The new amount replaces the old right away, keeping its bucket,
  // the same way posting does (4.6): a split that no longer adds up goes back
  // to review (A1), and one counted on setup day leaves the difference in
  // review (A10).
  #receivePendingChanged(txn: PendingChanged): Received {
    const target = this.#entries.get(this.#aliases.get(txn.pendingId) ?? txn.pendingId);
    if ((target?.kind !== 'spend' && target?.kind !== 'old-card') || !target.pending) {
      throw new MoneyError('not-pending', `${txn.pendingId} is not a pending charge`);
    }
    const before = { amount: target.amount };
    const sortedBefore = target.kind === 'spend' ? { sortedTo: target.sortedTo, splitChanged: target.splitChanged } : null;
    target.amount = txn.amount;
    try {
      if (target.kind === 'spend') this.#refreshSpending(target);
      else this.#setEffect(target, { oldCardDebt: txn.amount - target.countedAtSetup });
    } catch (error) {
      Object.assign(target, before, sortedBefore ?? {});
      throw error;
    }
    this.#changes.set(txn.id, txn);
    return { id: txn.id, outcome: 'changed' };
  }

  // QUESTIONS.md A14 and rule 4.10: the bank took back a transaction the app
  // had counted. The app takes it back too: whatever it did to the buckets,
  // the mom reserve, the money in transit, or the old card debt is undone,
  // and its money goes back where it came from. The change is logged (13.5)
  // and you are told, once (10.6). A paycheck's pay period stays, since its
  // days have passed; only its money comes back out of the buckets. A
  // pending charge is not taken back but dropped (4.6).
  #receiveTakenBack(txn: TakenBack): Received {
    const target = this.#entries.get(this.#aliases.get(txn.takenId) ?? txn.takenId);
    if (target === undefined || !('txn' in target)) throw new MoneyError('unknown-item', `no transaction ${txn.takenId}`);
    if (target.takenBack === true) throw new MoneyError('already-taken-back', `${txn.takenId} was taken back already`);
    if ((target.kind === 'spend' || target.kind === 'old-card') && target.pending) {
      throw new MoneyError('still-pending', `${txn.takenId} is still pending: the bank drops a pending charge (4.6)`);
    }
    const shown = target.kind === 'spend' || target.kind === 'old-card' ? (target.postedTxn ?? target.txn) : target.txn;
    const amount = target.kind === 'spend' || target.kind === 'old-card' ? target.amount : target.txn.amount;
    this.#atomically(() => {
      this.#takeBack(target);
      this.#log.push(Object.freeze({ date: txn.date, kind: 'bank-took-back', id: target.id, description: shown.description, amount }));
      this.#notices.push(Object.freeze({ kind: 'bank-took-back', id: target.id, date: txn.date, description: shown.description, amount }));
    });
    this.#takenBacks.set(txn.id, txn);
    return { id: txn.id, outcome: 'taken-back' };
  }

  // Undoes one entry made from a bank transaction, keeping it in the book.
  #takeBack(entry: Entry): void {
    switch (entry.kind) {
      case 'spend':
        // Like a drop (A2): nothing left of it, so its money goes back. A
        // refund already counted on it keeps its money where it went.
        entry.amount = 0;
        entry.takenBack = true;
        this.#refreshSpending(entry);
        break;
      case 'old-card':
        // What was in the old card balance on setup day comes off the debt too.
        entry.amount = 0;
        entry.takenBack = true;
        this.#setEffect(entry, { oldCardDebt: -entry.countedAtSetup });
        this.#review.delete(entry.id);
        break;
      case 'refund': {
        // Its money was counted on the purchase it refunded.
        const purchase = this.#entry(entry.of);
        if (purchase.kind !== 'spend') throw new MoneyError('broken-book', `${entry.id} refunds ${entry.of}, which is not spending`);
        purchase.refunded = subtractCents(purchase.refunded, entry.txn.amount);
        entry.takenBack = true;
        this.#refreshSpending(purchase);
        break;
      }
      case 'mom': {
        entry.takenBack = true;
        this.#setEffect(entry, {});
        const difference = this.#entries.get(`${entry.id}:difference`);
        if (difference !== undefined) this.#takeBack(difference);
        break;
      }
      case 'paycheck':
      case 'money-in':
      case 'transfer':
      case 'leg':
        entry.takenBack = true;
        this.#setEffect(entry, {});
        this.#review.delete(entry.id);
        break;
      case 'leftover':
      case 'move':
        throw new MoneyError('broken-book', `${entry.id} did not come from the bank`);
    }
    // Its other half, if any, is on its way again (12.5).
    this.#unpairAll(entry.id);
  }

  // QUESTIONS.md A2: a pending charge the bank drops without posting it is
  // removed, and its money goes back where it came from: its bucket (or
  // each part of a split), the unsorted spending, or the old card debt. One
  // counted in the starting money on setup day leaves the difference in
  // review, like any change to such a charge (A10).
  #receiveDropped(txn: PendingDropped): Received {
    const target = this.#entries.get(this.#aliases.get(txn.pendingId) ?? txn.pendingId);
    if ((target?.kind !== 'spend' && target?.kind !== 'old-card') || !target.pending) {
      throw new MoneyError('not-pending', `${txn.pendingId} is not a pending charge`);
    }
    const before = { pending: target.pending, amount: target.amount };
    target.pending = false;
    target.amount = 0;
    try {
      if (target.kind === 'spend') {
        target.dropped = true;
        this.#refreshSpending(target);
      } else {
        this.#setEffect(target, { oldCardDebt: -target.countedAtSetup });
        this.#review.delete(target.id);
      }
    } catch (error) {
      Object.assign(target, before, target.kind === 'spend' ? { dropped: false } : {});
      throw error;
    }
    this.#drops.set(txn.id, txn);
    return { id: txn.id, outcome: 'dropped' };
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
      if (entry.kind !== 'leg' || entry.txn.kind !== 'transfer-arrived' || this.#pairs.has(entry.id) || this.#gone(entry)) continue;
      const a = entry.txn;
      if (a.sentId === sent.id) {
        if (!sameRoute(a, sent)) throw new MoneyError('bad-transaction', `${a.id} names ${sent.id} but does not match it`);
        return entry.id;
      }
      if (this.#namesNoHalf(a) && fallback === undefined && sameRoute(a, sent)) fallback = entry.id;
    }
    return fallback;
  }

  // An arrival that names no leaving half, or names one the bank took back
  // (4.10), pairs like one the bank did not link.
  #namesNoHalf(arrival: TransferArrived): boolean {
    if (arrival.sentId === undefined) return true;
    const named = this.#entries.get(arrival.sentId);
    return named !== undefined && this.#gone(named);
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
        // A leaving half the bank took back (4.10) cannot be paired with;
        // the oldest unpaired one is taken instead, as for an arrival the
        // bank did not link.
        if (this.#gone(named)) {
          partner = this.#oldestUnpairedSent(txn);
        } else {
          const current = this.#pairs.get(named.id);
          if (current !== undefined) {
            const currentTxn = this.#legTxn(current);
            if (currentTxn.kind !== 'transfer-arrived' || currentTxn.sentId !== undefined) {
              throw new MoneyError('already-arrived', `${txn.sentId} has already arrived`);
            }
            displaced = current;
          }
          partner = named.id;
        }
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
      if (txn?.kind === 'transfer-sent' && !this.#pairs.has(entry.id) && !this.#gone(entry) && sameRoute(txn, arrival)) return entry.id;
    }
    return undefined;
  }

  #waitingFor(sentId: string): boolean {
    for (const entry of this.#entries.values()) {
      if (entry.kind === 'leg' && entry.txn.kind === 'transfer-arrived' && entry.txn.sentId === sentId && !this.#pairs.has(entry.id) && !this.#gone(entry)) return true;
    }
    return false;
  }

  #pair(sentId: string, arrivedId: string): void {
    this.#pairs.set(sentId, arrivedId);
    this.#pairs.set(arrivedId, sentId);
  }

  // Unpairs an entry from its other half, if it has one.
  #unpairAll(id: string): void {
    const partner = this.#pairs.get(id);
    if (partner !== undefined) this.#unpair(id, partner);
  }

  // Rule 7.4: a payment to a person waits in review unless a rule covers
  // that person, whichever of your accounts it leaves (A16). A rule can
  // also say it is for mom (7.6).
  #receivePersonPayment(txn: PersonPayment): Received {
    if (matchesTextRule(this.#settings.momRule, txn.description)) return this.#payMom(txn, 'mom-rule');
    const rule = findRule(this.#rules, 'person', txn.description);
    if (rule?.choice.to === 'mom') return this.#payMom(txn, 'person-rule');
    return this.#addSpending(txn, 'person-payment', rule === undefined ? { to: 'unsorted' } : { to: rule.choice.to });
  }

  #knownTransaction(id: string): BankTransaction | undefined {
    const about = this.#drops.get(id) ?? this.#changes.get(id) ?? this.#takenBacks.get(id);
    if (about !== undefined) return about;
    const postedFor = this.#aliases.get(id);
    if (postedFor !== undefined) {
      const entry = this.#entry(postedFor);
      if ('originalPosted' in entry && entry.originalPosted !== undefined) return entry.originalPosted;
      return 'postedTxn' in entry ? (entry.postedTxn ?? undefined) : undefined;
    }
    const entry = this.#entries.get(id);
    if (entry === undefined || !('txn' in entry)) return undefined;
    // Marked as a transfer by hand (5.6): the bank sent it as something else.
    return ('original' in entry ? entry.original : undefined) ?? entry.txn;
  }

  // Taken back by the bank (4.10): still in the book, doing nothing.
  #gone(entry: Entry): boolean {
    return 'takenBack' in entry && entry.takenBack === true;
  }

  // Rules 8.1 and 8.3: a mom payment comes out of the reserve, whatever the
  // day or amount. If the reserve cannot cover it all, the difference waits
  // in review for you to pick a bucket.
  #payMom(txn: PersonPayment, how: MomEntry['how']): Received {
    const fromReserve = Math.min(txn.amount, Math.max(0, this.#totals.momReserve));
    const mom: MomEntry = { kind: 'mom', id: txn.id, txn, fromReserve, how, effect: {} };
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

  // Rules 4.1, 4.2, 4.6, 4.9.
  #receivePurchase(txn: Purchase | SavingsWithdrawal): Received {
    if (txn.pendingId !== undefined) {
      const target = this.#entries.get(this.#aliases.get(txn.pendingId) ?? txn.pendingId);
      if (target !== undefined) {
        if ((target.kind !== 'spend' && target.kind !== 'old-card') || !target.pending) {
          throw new MoneyError('already-posted', `${txn.pendingId} is not a pending purchase`);
        }
        if (target.txn.kind !== txn.kind || target.txn.account !== txn.account) {
          throw new MoneyError('bad-transaction', `${txn.id} is on a different account from the pending charge it replaces`);
        }
        return this.#post(target, txn);
      }
      // The app never saw the pending charge, so this is simply a new purchase.
    }
    // 4.9: money leaving savings always waits in review; no rule sorts it.
    if (txn.kind === 'savings-withdrawal') return this.#addSpending(txn, 'purchase', { to: 'unsorted' });
    if (txn.account === 'old-card') return this.#addOldCard(txn);
    const rule = findRule(this.#rules, 'purchase', txn.description);
    return this.#addSpending(txn, 'purchase', rule === undefined ? { to: 'unsorted' } : { to: rule.bucket });
  }

  #addSpending(txn: Purchase | SavingsWithdrawal | CardCharge | Transfer | TransferSent | PersonPayment, spendingKind: SpendingKind, sortedTo: SpendingSort): Received {
    const pending = (txn.kind === 'purchase' || txn.kind === 'savings-withdrawal') && txn.pending;
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
  #post(entry: SpendEntry | OldCardEntry, txn: Purchase | SavingsWithdrawal): Received {
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
      if (net !== 0) {
        for (const part of now.split) {
          // A part of a payment to a person that is not mine lowers held for others (7.6).
          const pot = part.bucket === 'not-mine' ? 'heldForOthers' : part.bucket;
          effect[pot] = subtractCents(effect[pot] ?? 0, part.amount);
        }
      }
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
    // A charge the bank dropped (A2) or took back (4.10) with nothing left
    // has nothing to sort.
    const gone = entry.dropped === true || entry.takenBack === true;
    if ('to' in now && now.to === 'unsorted' && !(gone && net === 0)) this.#review.add(entry.id);
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
    const spentBefore = this.#spentBefore(bucket, txn.date);
    const entry: LeftoverEntry = { kind: 'leftover', id: `leftover:${txn.id}:${bucket}`, date: txn.date, bucket, amount, spentBefore, answer: 'open', effect: {} };
    this.#add(entry, {});
    if (choice === 'ask') this.#review.add(entry.id);
    else this.#answerLeftover(entry, 'move-to-savings', amount);
  }

  // What spending made before this day takes from a bucket now (4.1: it
  // comes out on the day it was made, whenever it shows up).
  #spentBefore(bucket: SplitBucket, day: IsoDate): Cents {
    let spent = 0;
    for (const entry of this.#entries.values()) {
      if (entry.kind === 'spend' && daysBetween(entry.txn.date, day) > 0) spent = subtractCents(spent, entry.effect[bucket] ?? 0);
    }
    return spent;
  }

  // B4: what an open leftover question asks about now. Spending made before
  // payday that showed up or changed since lowers it, never below zero and
  // never above what was asked at payday.
  #asked(entry: LeftoverEntry): Cents {
    if (entry.answer !== 'open') return entry.amount;
    const late = subtractCents(this.#spentBefore(entry.bucket, entry.date), entry.spentBefore);
    return Math.min(entry.amount, Math.max(0, subtractCents(entry.amount, late)));
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
    // B4: what the question asks about now, after any late spending.
    const amount = this.#asked(entry);
    const start = answer === 'move-to-savings' ? subtractCents(this.#periodStart[entry.bucket], amount) : this.#periodStart[entry.bucket];
    this.#answerLeftover(entry, answer, amount);
    this.#periodStart[entry.bucket] = start;
    this.#review.delete(id);
  }

  #answerLeftover(entry: LeftoverEntry, answer: LeftoverAnswer, amount: Cents): void {
    if (answer === 'move-to-savings') this.#setEffect(entry, { [entry.bucket]: -amount, savings: amount });
    entry.answer = answer;
  }

  // Sorts something waiting in review, or re-sorts it later (4.7).
  sort(id: string, choice: SortChoice, date: IsoDate): void {
    assertIsoDate(date);
    const entry = this.#entries.get(this.#aliases.get(id) ?? id);
    if (entry === undefined) throw new MoneyError('unknown-item', `no item ${id}`);
    // Taken back by the bank (4.10): only what is left of it, if anything, waits to be sorted.
    if (this.#gone(entry) && !this.#review.has(entry.id)) throw new MoneyError('not-sortable', `the bank took back ${id}`);
    if (typeof choice === 'object' && choice !== null && 'transfer' in choice) return this.#markAsTransfer(entry, choice.transfer);
    // Marked as a transfer by hand (5.6): sorting it any other way makes it
    // what the bank sent again first. A payment to the old card from savings
    // still takes savings or needs, like any (5.2, A4).
    const oldCardFromSavings = entry.kind === 'spend' && entry.spendingKind === 'debt-payoff' && 'to' in choice && (choice.to === 'savings' || choice.to === 'needs');
    if ((entry.kind === 'leg' || entry.kind === 'spend') && entry.original !== undefined && !oldCardFromSavings) {
      this.#atomically(() => this.sort(this.#restore(entry), choice, date));
      return;
    }
    switch (entry.kind) {
      case 'spend':
        if ((entry.txn.kind === 'transfer' || entry.txn.kind === 'transfer-sent') && entry.txn.from === 'checking') {
          throw new MoneyError('not-sortable', `${id} is a payment to the old card, which always comes out of needs (5.2)`);
        }
        return this.#sortSpending(entry, choice);
      case 'money-in':
        return this.#sortMoneyIn(entry, choice);
      case 'mom':
        // 7.6: a payment marked for mom by hand or by a person rule can be
        // sorted again. One the mom rule matched always stays on the reserve (8.1).
        if (entry.how === 'mom-rule') throw new MoneyError('not-sortable', `${id} matches the mom rule, so it always comes out of the mom reserve (8.1)`);
        if (isPersonPaymentChoice(choice) && choice.to === 'mom') return;
        this.#atomically(() => {
          this.#unMom(entry);
          this.#sortSpending(this.#spendEntry(entry.id), choice);
        });
        return;
      default:
        throw new MoneyError('not-sortable', `${id} is a ${entry.kind} and cannot be sorted`);
    }
  }

  // 5.6: spending or money in that was really a transfer between your own
  // accounts. It becomes that transfer's half, leaving checking or savings,
  // or arriving in the account it came into, and is handled as one: no
  // bucket changes (5.1, 5.3), in transit until its other half shows (12.5),
  // or out of needs when it pays the old card from checking (5.2). What the
  // bank sent is kept, so sorting it another way later brings it back.
  #markAsTransfer(entry: Entry, other: unknown): void {
    if (typeof other !== 'string' || !(ACCOUNTS as readonly string[]).includes(other)) {
      throw new MoneyError('bad-choice', `a transfer is with one of your four accounts, not ${String(other)}`);
    }
    const account = other as AccountId;
    if ((entry.kind === 'leg' || entry.kind === 'spend') && entry.original !== undefined) {
      this.#atomically(() => this.#markAsTransfer(this.#entry(this.#restore(entry)), account));
      return;
    }
    const { original, posted, half } = this.#halfFrom(entry, account);
    this.#atomically(() => {
      this.#remove(entry);
      if (half.kind === 'transfer-sent') this.#receiveSent(half);
      else this.#receiveArrived(half);
      const made = this.#entry(half.id);
      if (made.kind !== 'leg' && made.kind !== 'spend') throw new MoneyError('broken-book', `${half.id} did not become a transfer`);
      made.original = original;
      if (posted !== null) made.originalPosted = posted;
    });
  }

  // The half of a transfer an entry becomes when you mark it as one (5.6).
  #halfFrom(entry: Entry, other: AccountId): { original: MarkedAsTransfer; posted: Purchase | SavingsWithdrawal | null; half: TransferSent | TransferArrived } {
    const refuse = (why: string): never => {
      throw new MoneyError('bad-choice', `${entry.id} cannot be a transfer: ${why}`);
    };
    if (entry.kind === 'spend') {
      if (entry.pending) throw new MoneyError('still-pending', `${entry.id} is still pending; mark it once it posts`);
      const txn = entry.txn;
      const fromAnAccount = txn.kind === 'purchase' || txn.kind === 'savings-withdrawal' || txn.kind === 'payment-to-person';
      if (!fromAnAccount || (entry.spendingKind !== 'purchase' && entry.spendingKind !== 'person-payment')) {
        refuse('only money leaving checking or savings can be the leaving half');
      }
      if (txn.kind !== 'purchase' && txn.kind !== 'savings-withdrawal' && txn.kind !== 'payment-to-person') return refuse('not spending from an account');
      if (txn.account !== 'checking' && txn.account !== 'savings') refuse('money leaving a card is never a transfer');
      if (entry.refunded > 0 || entry.countedAtSetup > 0 || entry.dropped === true || this.#gone(entry)) refuse('part of it was refunded, counted on setup day, or taken back');
      const from = txn.account as 'checking' | 'savings';
      if (other === from) refuse('a transfer goes to another of your accounts');
      const shown = entry.postedTxn ?? txn;
      const half: TransferSent = { kind: 'transfer-sent', id: entry.id, from, to: other, date: shown.date, amount: entry.amount, description: shown.description };
      return { original: txn, posted: entry.postedTxn, half };
    }
    const arriving = entry.kind === 'money-in' || (entry.kind === 'old-card' && entry.txn.kind === 'refund');
    if (!arriving || this.#gone(entry)) return refuse('only spending from checking or savings, or money in, can be a transfer');
    const txn = entry.txn;
    if (txn.kind !== 'deposit' && txn.kind !== 'refund') return refuse('only money in can be the arriving half');
    if (other !== 'checking' && other !== 'savings') refuse('money arrives from checking or savings');
    if (other === txn.account) refuse('a transfer comes from another of your accounts');
    const half: TransferArrived = { kind: 'transfer-arrived', id: entry.id, from: other as 'checking' | 'savings', to: txn.account, date: txn.date, amount: txn.amount, description: txn.description };
    return { original: txn, posted: null, half };
  }

  // Undoes a transfer you marked by hand and gives the book what the bank
  // sent instead, as it would have taken it then. Returns its id.
  #restore(entry: LegEntry | SpendEntry): string {
    const { original, originalPosted } = entry;
    if (original === undefined) throw new MoneyError('broken-book', `${entry.id} was not marked as a transfer`);
    this.#remove(entry);
    this.#dispatch(original);
    if (originalPosted !== undefined) this.#dispatch(originalPosted);
    return original.id;
  }

  // 7.6: a payment for mom made back into a payment to a person, unsorted.
  #unMom(entry: MomEntry): void {
    const difference = this.#entries.get(`${entry.id}:difference`);
    if (difference !== undefined) this.#remove(difference);
    this.#remove(entry);
    this.#addSpending(entry.txn, 'person-payment', { to: 'unsorted' });
  }

  #spendEntry(id: string): SpendEntry {
    const entry = this.#entry(id);
    if (entry.kind !== 'spend') throw new MoneyError('broken-book', `${id} is not spending`);
    return entry;
  }

  // Clears a flag in review that has no money to sort (5.4).
  acknowledge(id: string, date: IsoDate): void {
    assertIsoDate(date);
    const entry = this.#entries.get(id);
    if (entry?.kind !== 'old-card' || !this.#review.has(id)) throw new MoneyError('unknown-item', `no flag ${id} waiting in review`);
    this.#review.delete(id);
  }

  // Rules 4.3, 4.4, 4.7, 4.8, 7.2, 7.6.
  #sortSpending(entry: SpendEntry, choice: SortChoice): void {
    const before = { sortedTo: entry.sortedTo, splitChanged: entry.splitChanged };
    if (!('split' in choice) && !('to' in choice)) throw new MoneyError('bad-choice', `not a way to sort spending: ${JSON.stringify(choice)}`);
    const person = entry.spendingKind === 'person-payment';
    if (person && !('split' in choice)) {
      if (!isPersonPaymentChoice(choice)) throw new MoneyError('bad-choice', 'a payment to a person goes to needs, wants, not mine, or for mom, or is split across needs, wants and not mine');
      if (choice.to === 'mom') {
        // 7.6: for mom, it comes out of the mom reserve like a payment the mom rule matches (8.1).
        if (entry.txn.kind !== 'payment-to-person' || entry.refunded > 0) throw new MoneyError('bad-choice', `${entry.id} cannot be for mom: part of it was refunded`);
        const txn = entry.txn;
        this.#atomically(() => {
          this.#remove(entry);
          this.#payMom(txn, 'by-hand');
        });
        return;
      }
      entry.sortedTo = Object.freeze({ to: choice.to });
    } else if (entry.spendingKind === 'debt-payoff') {
      // QUESTIONS.md A4: a payment to the old card from savings comes out of
      // the savings bucket once you confirm it, or out of needs if you pick
      // that instead (5.2).
      if ('split' in choice || (choice.to !== 'savings' && choice.to !== 'needs')) {
        throw new MoneyError('bad-choice', 'a payment to the old card from savings comes out of savings or needs');
      }
      entry.sortedTo = Object.freeze({ to: choice.to });
    } else if (entry.spendingKind === 'mom-difference' && 'split' in choice) {
      throw new MoneyError('bad-choice', 'the difference on a mom payment goes to needs or wants');
    } else if ('split' in choice) {
      if (!Array.isArray(choice.split)) throw new MoneyError('bad-choice', 'a split needs a list of parts');
      const parts = choice.split.map((part) => {
        // 4.4: spending splits across needs and wants; 7.6: a payment to a person can also have a part that is not mine.
        if (!isSpendingBucket(part.bucket) && !(person && part.bucket === 'not-mine')) {
          throw new MoneyError('bad-choice', `${person ? 'a payment to a person splits across needs, wants and not mine' : 'spending can go to needs or wants'}, not ${String(part.bucket)}`);
        }
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
    const before = this.#settings;
    try {
      this.#atomically(() => {
        this.#settings = next;
        const changes = Object.fromEntries(Object.keys(patch).map((key) => [key, next[key as keyof Settings]]));
        this.#log.push(Object.freeze({ date, kind: 'settings-changed', changes }));
        // QUESTIONS.md A9: a new paycheck rule or mom rule also checks what is
        // waiting in review, the way a new sorting rule does (13.2).
        if ('paycheckRule' in patch) this.#recheckForPaychecks();
        if ('momRule' in patch) this.#recheckForMom();
      });
    } catch (error) {
      this.#settings = before;
      throw error;
    }
  }

  // A9: waiting deposits that match the paycheck rule, oldest first. Each
  // starts a pay period like any paycheck (3.1), unless it is less than 10
  // days after the last paycheck, or older than it (3.7, B54); then it waits
  // as an early paycheck, with the same choices (6.1).
  #recheckForPaychecks(): void {
    const matching = [...this.#review]
      .map((id) => this.#entry(id))
      .filter((entry): entry is MoneyInEntry & { txn: Deposit } => {
        return entry.kind === 'money-in' && entry.reason === 'deposit' && entry.txn.kind === 'deposit' && matchesTextRule(this.#settings.paycheckRule, entry.txn.description);
      })
      .sort((a, b) => daysBetween(b.txn.date, a.txn.date));
    for (const entry of matching) {
      if (daysBetween(this.#lastPaycheckDate, entry.txn.date) < this.#settings.earlyPaycheckDays) entry.reason = 'early-paycheck';
      else this.#makePaycheck(entry, entry.txn);
    }
  }

  // A9: waiting payments to a person that match the mom rule come out of the
  // mom reserve, oldest first (8.1); what the reserve cannot cover waits in
  // review (8.3).
  #recheckForMom(): void {
    const matching = [...this.#review]
      .map((id) => this.#entry(id))
      .filter((entry): entry is SpendEntry & { txn: PersonPayment } => {
        return entry.kind === 'spend' && entry.spendingKind === 'person-payment' && entry.txn.kind === 'payment-to-person' && matchesTextRule(this.#settings.momRule, entry.txn.description);
      })
      .sort((a, b) => daysBetween(b.txn.date, a.txn.date));
    for (const entry of matching) {
      this.#remove(entry);
      this.#payMom(entry.txn, 'mom-rule');
    }
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
    // 4.9: money leaving savings always waits in review, so no rule can sort it.
    const fromSavings = entry.kind === 'spend' && entry.txn.kind === 'savings-withdrawal';
    if ('transfer' in choice) throw new MoneyError('bad-choice', 'a sorting rule cannot mark transfers; the bank rules in settings do that');
    if (entry.kind === 'spend' && entry.spendingKind === 'purchase' && !fromSavings) {
      if ('split' in choice || !isSpendingBucket(choice.to)) throw new MoneyError('bad-choice', 'a rule picks needs or wants; it cannot split');
      newRule = { id: rule.id, for: 'purchase', contains: rule.contains, bucket: choice.to };
      descriptions = [entry.txn.description, ...(entry.postedTxn === null ? [] : [entry.postedTxn.description])];
    } else if (entry.kind === 'spend' && entry.spendingKind === 'person-payment') {
      if (!isPersonPaymentChoice(choice)) throw new MoneyError('bad-choice', 'a person rule picks needs, wants, not mine, or mom; it cannot split');
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
      // 4.9: money leaving savings is never sorted by a rule.
      const fromSavings = entry.kind === 'spend' && entry.txn.kind === 'savings-withdrawal';
      if (unsortedSpending && entry.spendingKind === 'purchase' && !fromSavings) {
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
      notices: this.#notices.length,
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
      this.#notices.length = saved.notices;
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

  // Undoes an entry completely. Its other half, if any, is on its way again.
  #remove(entry: Entry): void {
    this.#setEffect(entry, {});
    this.#unpairAll(entry.id);
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
        const fromSavings = entry.txn.kind === 'savings-withdrawal';
        const reason = entry.countedAtSetup > 0 ? 'setup-difference' : entry.splitChanged ? 'split-changed' : fromSavings ? 'from-savings' : spendingReason(entry.spendingKind);
        const description = (entry.postedTxn ?? entry.txn).description;
        // Fees and interest suggest needs (4.8). A payment to the old card
        // waiting here came from savings, so it suggests savings (A4).
        const suggestion = entry.spendingKind === 'debt-payoff' ? 'savings' : ['purchase', 'person-payment', 'mom-difference'].includes(entry.spendingKind) ? null : 'needs';
        return { type: 'spending', id: entry.id, date: entry.txn.date, amount: netOf(entry), description, reason, suggestion };
      }
      case 'leftover':
        return { type: 'leftover', id: entry.id, date: entry.date, bucket: entry.bucket, amount: this.#asked(entry) };
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
