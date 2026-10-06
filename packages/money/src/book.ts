import { isSpendingBucket, type SplitBucket } from './buckets.js';
import { addCents, assertCents, assertPositiveCents, subtractCents, type Cents } from './cents.js';
import { addDays, assertIsoDate, daysBetween, monthOf, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import { splitPaycheck, type PaycheckSplit } from './payday.js';
import { bankSide, type BankBalances } from './self-check.js';
import { checkRules, findRule, isMoneyInChoice, isPersonPaymentChoice, type MoneyInChoice, type SortingRule } from './rules.js';
import { matchesTextRule, validateSettings, type Settings } from './settings.js';
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
// is tracked on its own and is not part of the self-check (12.4).
type TotalName = PotName | 'oldCardDebt';
type Effect = Partial<Record<TotalName, Cents>>;

const POT_NAMES: readonly PotName[] = ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers', 'unsortedIn', 'unsortedOut'];
const TOTAL_NAMES: readonly TotalName[] = [...POT_NAMES, 'oldCardDebt'];

export interface OpenBookInput {
  // The day tracking starts.
  readonly date: IsoDate;
  readonly pots: StartingPots;
  readonly oldCardDebt: Cents;
  // The pay schedule counts from this date until the first paycheck arrives.
  readonly lastPaycheckDate: IsoDate;
  readonly settings: Settings;
  readonly rules?: readonly SortingRule[];
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
  | { readonly to: 'not-mine' };

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
      readonly reason: 'no-rule' | 'card-fee' | 'card-interest' | 'split-changed' | 'old-card-from-savings' | 'person-payment' | 'mom-difference';
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

// Rule 12.3: the bank side and the app side must be equal.
export interface SelfCheck {
  readonly bankSide: Cents;
  readonly appSide: Cents;
  // Bank side minus app side. Zero when they match.
  readonly difference: Cents;
  readonly ok: boolean;
}

// Rule 0.5: safe to spend only when the totals match the bank.
export type CheckedSafeToSpend =
  | { readonly ok: true; readonly safeToSpend: SafeToSpend }
  | { readonly ok: false; readonly difference: Cents; readonly nextPayday: IsoDate; readonly daysToPayday: number };

export interface SavingsTransfer {
  readonly shouldBeInSavings: Cents;
  readonly savingsAccountBalance: Cents;
  readonly stillToMove: Cents;
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
  sortedTo: 'unsorted' | MoneyInChoice['to'];
  // How it was split, when sorted as income.
  incomeSplit: PaycheckSplit | null;
  effect: Effect;
}

interface SpendEntry {
  readonly kind: 'spend';
  readonly id: string;
  readonly txn: Purchase | CardCharge | Transfer | PersonPayment;
  readonly spendingKind: SpendingKind;
  postedTxn: Purchase | null;
  pending: boolean;
  amount: Cents;
  refunded: Cents;
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

type Entry = PaycheckEntry | MoneyInEntry | SpendEntry | RefundEntry | MomEntry | TransferEntry | OldCardEntry | LeftoverEntry;

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
  // Ids of entries waiting for you, in the order they arrived.
  readonly #review = new Set<string>();
  readonly #paychecks: PaycheckRecord[] = [];
  #settings: Settings;
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
    this.#totals = { ...this.#opening, unsortedIn: 0, unsortedOut: 0 };
    addCents(savings, needs, wants, momReserve, heldForOthers);
    this.#settings = validateSettings(input.settings);
    this.#rules = checkRules(input.rules ?? []);
    this.#lastPaycheckDate = input.lastPaycheckDate;
    this.#period = { number: 0, startDate: input.date };
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
    const totals: Record<TotalName, Cents> = { ...this.#opening, unsortedIn: 0, unsortedOut: 0 };
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
      views.push({ id: e.id, date: e.txn.date, description, amount: e.amount, refunded: e.refunded, pending: e.pending, kind: e.spendingKind, sortedTo: e.sortedTo });
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

  // Rules 12.1 to 12.4. The bank balances must include pending charges
  // (withPendingCharges). The old card is not part of the check.
  selfCheck(bank: BankBalances): SelfCheck {
    const bankTotal = bankSide(bank);
    const t = this.#totals;
    // 12.2: savings + needs + wants + mom reserve + held for others
    //       + unsorted money in - unsorted spending
    const appTotal = subtractCents(addCents(t.savings, t.needs, t.wants, t.momReserve, t.heldForOthers, t.unsortedIn), t.unsortedOut);
    const difference = subtractCents(bankTotal, appTotal);
    return { bankSide: bankTotal, appSide: appTotal, difference, ok: difference === 0 };
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
    return { shouldBeInSavings, savingsAccountBalance, stillToMove: subtractCents(shouldBeInSavings, savingsAccountBalance) };
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
  // (9.3, 9.4).
  cardPayments(card: 'everyday-card' | 'old-card'): { readonly date: IsoDate; readonly amount: Cents }[] {
    const payments: { date: IsoDate; amount: Cents }[] = [];
    for (const entry of this.#entries.values()) {
      if ((entry.kind === 'transfer' || entry.kind === 'spend') && entry.txn.kind === 'transfer' && entry.txn.to === card) {
        payments.push({ date: entry.txn.date, amount: entry.txn.amount });
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
      case 'payment-to-person':
        return this.#receivePersonPayment(copy);
    }
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
    this.#add({ kind: 'mom', id: txn.id, txn, fromReserve, effect: {} }, { momReserve: -fromReserve });
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
      sortedTo: { to: 'unsorted' },
      splitChanged: false,
      effect: {},
    };
    this.#entries.set(entry.id, entry);
    this.#refreshSpending(entry);
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
    const entry: OldCardEntry = { kind: 'old-card', id: txn.id, txn, postedTxn: null, pending: txn.kind === 'purchase' && txn.pending, amount: txn.amount, effect: {} };
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
      this.#sortMoneyIn(this.#moneyInEntry(txn.id), rule.choice);
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

  #addSpending(txn: Purchase | CardCharge | Transfer | PersonPayment, spendingKind: SpendingKind, sortedTo: SpendingSort): Received {
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
      sortedTo,
      splitChanged: false,
      effect: {},
    };
    this.#entries.set(entry.id, entry);
    this.#refreshSpending(entry);
    return { id: txn.id, outcome: this.#review.has(entry.id) ? 'review' : 'sorted' };
  }

  // Rule 4.6: the posted charge replaces the pending one, even at a new amount.
  #post(entry: SpendEntry | OldCardEntry, txn: Purchase): Received {
    entry.postedTxn = txn;
    entry.pending = false;
    entry.amount = txn.amount;
    this.#aliases.set(txn.id, entry.id);
    if (entry.kind === 'spend') this.#refreshSpending(entry);
    else this.#setEffect(entry, { oldCardDebt: txn.amount });
    return { id: txn.id, outcome: 'posted' };
  }

  // Rule 4.5.
  #receiveRefund(txn: Refund): Received {
    const target = txn.refundOf === undefined ? undefined : this.#entries.get(this.#aliases.get(txn.refundOf) ?? txn.refundOf);
    if (target?.kind !== 'spend' || target.spendingKind === 'debt-payoff' || txn.amount > target.amount - target.refunded) {
      return this.#holdMoneyIn(txn, 'refund');
    }
    this.#add({ kind: 'refund', id: txn.id, txn, of: target.id, effect: {} }, {});
    target.refunded = addCents(target.refunded, txn.amount);
    this.#refreshSpending(target);
    return { id: txn.id, outcome: 'sorted' };
  }

  // Works out what a purchase does to the buckets now. A split that no
  // longer adds up (after a refund, or posting at a new amount) goes back to
  // review to be split again.
  #refreshSpending(entry: SpendEntry): void {
    const net = entry.amount - entry.refunded;
    const sorted = entry.sortedTo;
    if ('split' in sorted && sorted.split.reduce((sum, part) => sum + part.amount, 0) !== net) {
      entry.sortedTo = { to: 'unsorted' };
      entry.splitChanged = true;
    }
    const now = entry.sortedTo;
    let effect: Effect;
    if ('split' in now) {
      effect = {};
      for (const part of now.split) effect[part.bucket] = subtractCents(effect[part.bucket] ?? 0, part.amount);
    } else if (now.to === 'unsorted') {
      effect = { unsortedOut: net };
    } else if (now.to === 'not-mine') {
      effect = { heldForOthers: -net };
    } else {
      effect = { [now.to]: -net };
    }
    // A payment to the old card also lowers the debt, however it is sorted.
    if (entry.spendingKind === 'debt-payoff') effect.oldCardDebt = -entry.amount;
    this.#setEffect(entry, effect);
    if ('to' in now && now.to === 'unsorted') this.#review.add(entry.id);
    else this.#review.delete(entry.id);
  }

  // Rules 3.1 to 3.5.
  #payday(txn: Deposit): void {
    this.#closePeriod('needs', txn);
    this.#closePeriod('wants', txn);
    const split = splitPaycheck(txn.amount, this.#totals.momReserve, this.#settings);
    const entry: PaycheckEntry = { kind: 'paycheck', id: txn.id, txn, split, effect: {} };
    this.#add(entry, { momReserve: split.momReserve, savings: split.savings, needs: split.needs, wants: split.wants });
    this.#paychecks.push({ id: txn.id, date: txn.date, amount: txn.amount, split });
    this.#period = { number: this.#period.number + 1, startDate: txn.date };
    this.#lastPaycheckDate = txn.date;
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

  answerLeftover(id: string, answer: LeftoverAnswer, date: IsoDate): void {
    assertIsoDate(date);
    if (answer !== 'roll-over' && answer !== 'move-to-savings') throw new MoneyError('bad-choice', `not a leftover choice: ${String(answer)}`);
    const entry = this.#entries.get(id);
    if (entry?.kind !== 'leftover' || !this.#review.has(id)) throw new MoneyError('unknown-item', `no open leftover question ${id}`);
    this.#answerLeftover(entry, answer);
    this.#review.delete(id);
  }

  #answerLeftover(entry: LeftoverEntry, answer: LeftoverAnswer): void {
    entry.answer = answer;
    if (answer === 'move-to-savings') this.#setEffect(entry, { [entry.bucket]: -entry.amount, savings: entry.amount });
  }

  // Sorts something waiting in review, or re-sorts it later (4.7).
  sort(id: string, choice: SortChoice, date: IsoDate): void {
    assertIsoDate(date);
    const entry = this.#entries.get(this.#aliases.get(id) ?? id);
    if (entry === undefined) throw new MoneyError('unknown-item', `no item ${id}`);
    switch (entry.kind) {
      case 'spend':
        if (entry.txn.kind === 'transfer' && entry.txn.from === 'checking') {
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
      const net = entry.amount - entry.refunded;
      if (total !== net) throw new MoneyError('split-does-not-add-up', `the parts add up to ${total}, the purchase is ${net}`);
      entry.sortedTo = Object.freeze({ split: Object.freeze(parts) });
    } else if (isSpendingBucket(choice.to)) {
      entry.sortedTo = Object.freeze({ to: choice.to });
    } else {
      throw new MoneyError('bad-choice', `spending can go to needs or wants, not ${String(choice.to)}`);
    }
    entry.splitChanged = false;
    this.#refreshSpending(entry);
  }

  // Rule 6.1: income, payback, or not mine. A store refund the app could
  // not match can be payback or not mine, but not income.
  #sortMoneyIn(entry: MoneyInEntry, choice: SortChoice): void {
    if (!isMoneyInChoice(choice)) throw new MoneyError('bad-choice', 'money in is income, payback into one bucket, or not mine');
    const amount = entry.txn.amount;
    let effect: Effect;
    let incomeSplit: PaycheckSplit | null = null;
    if (choice.to === 'income') {
      if (entry.reason === 'refund') throw new MoneyError('bad-choice', 'a store refund is not income');
      // Treated like a paycheck: the reserve first, then the split. The
      // reserve is counted without this entry's own earlier effect.
      const reserveNow = subtractCents(this.#totals.momReserve, entry.effect.momReserve ?? 0);
      incomeSplit = splitPaycheck(amount, reserveNow, this.#settings);
      effect = { momReserve: incomeSplit.momReserve, savings: incomeSplit.savings, needs: incomeSplit.needs, wants: incomeSplit.wants };
    } else if (choice.to === 'not-mine') {
      effect = { heldForOthers: amount };
    } else {
      effect = { [choice.to]: amount };
    }
    entry.sortedTo = choice.to;
    entry.incomeSplit = incomeSplit;
    this.#setEffect(entry, effect);
    this.#review.delete(entry.id);
  }

  #moneyInEntry(id: string): MoneyInEntry {
    const entry = this.#entry(id);
    if (entry.kind !== 'money-in') throw new MoneyError('broken-book', `${id} is not money in`);
    return entry;
  }

  // ----- Bookkeeping -----

  #entry(id: string): Entry {
    const entry = this.#entries.get(id);
    if (entry === undefined) throw new MoneyError('unknown-item', `no item ${id}`);
    return entry;
  }

  #add(entry: Entry, effect: Effect): void {
    this.#entries.set(entry.id, entry);
    this.#setEffect(entry, effect);
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
        const reason = entry.splitChanged
          ? 'split-changed'
          : entry.spendingKind === 'purchase'
            ? 'no-rule'
            : entry.spendingKind === 'debt-payoff'
              ? 'old-card-from-savings'
              : entry.spendingKind;
        const description = (entry.postedTxn ?? entry.txn).description;
        // Fees, interest, and old card payments suggest needs (4.8, 5.2).
        const suggestion = ['purchase', 'person-payment', 'mom-difference'].includes(entry.spendingKind) ? null : 'needs';
        return { type: 'spending', id: entry.id, date: entry.txn.date, amount: entry.amount - entry.refunded, description, reason, suggestion };
      }
      case 'leftover':
        return { type: 'leftover', id: entry.id, date: entry.date, bucket: entry.bucket, amount: entry.amount };
      case 'old-card':
        return { type: 'old-card-purchase', id: entry.id, date: entry.txn.date, amount: entry.amount, description: (entry.postedTxn ?? entry.txn).description };
      case 'paycheck':
      case 'refund':
      case 'mom':
      case 'transfer':
        throw new MoneyError('broken-book', `${entry.kind} ${entry.id} should never be in review`);
    }
  }
}
