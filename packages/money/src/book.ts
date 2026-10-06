import { isBucket, isSpendingBucket, type Bucket, type SplitBucket } from './buckets.js';
import { addCents, assertCents, assertPositiveCents, subtractCents, type Cents } from './cents.js';
import { assertIsoDate, daysBetween, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import { splitPaycheck, type PaycheckSplit } from './payday.js';
import { checkRules, findRule, type SortingRule } from './rules.js';
import { matchesTextRule, validateSettings, type Settings } from './settings.js';
import {
  checkTransaction,
  sameTransaction,
  type BankTransaction,
  type CardCharge,
  type Deposit,
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
export type SortChoice = { readonly to: Bucket } | { readonly split: readonly SplitPart[] };

export type SpendingSort = { readonly to: 'unsorted' } | { readonly to: SplitBucket } | { readonly split: readonly SplitPart[] };

// debt-payoff is a payment to the old card (5.2).
export type SpendingKind = 'purchase' | 'card-fee' | 'card-interest' | 'debt-payoff';

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
      readonly reason: 'no-rule' | 'card-fee' | 'card-interest' | 'split-changed' | 'old-card-from-savings';
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
  sortedTo: 'unsorted' | Bucket;
  effect: Effect;
}

interface SpendEntry {
  readonly kind: 'spend';
  readonly id: string;
  readonly txn: Purchase | CardCharge | Transfer;
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

type Entry = PaycheckEntry | MoneyInEntry | SpendEntry | RefundEntry | TransferEntry | OldCardEntry | LeftoverEntry;

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
      const { id, date } = e.txn;
      const description = (e.postedTxn ?? e.txn).description;
      views.push({ id, date, description, amount: e.amount, refunded: e.refunded, pending: e.pending, kind: e.spendingKind, sortedTo: e.sortedTo });
    }
    return views;
  }

  reviewItems(): ReviewItem[] {
    return [...this.#review].map((id) => this.#reviewView(this.#entry(id)));
  }

  // Rule 3.8: what should be sitting in the savings account (savings plus
  // the mom reserve), and how much still needs to be moved there. Negative
  // means the account holds more than the buckets say.
  savingsTransfer(savingsAccountBalance: Cents): SavingsTransfer {
    assertCents(savingsAccountBalance, 'savings account balance');
    const shouldBeInSavings = addCents(this.#totals.savings, this.#totals.momReserve);
    return { shouldBeInSavings, savingsAccountBalance, stillToMove: subtractCents(shouldBeInSavings, savingsAccountBalance) };
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
    }
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
    if (!matchesTextRule(s.paycheckRule, txn.description)) return this.#holdMoneyIn(txn, 'deposit');
    // Rule 3.7: too soon after the last paycheck to split automatically.
    if (daysBetween(this.#lastPaycheckDate, txn.date) < s.earlyPaycheckDays) return this.#holdMoneyIn(txn, 'early-paycheck');
    this.#payday(txn);
    return { id: txn.id, outcome: 'paycheck' };
  }

  #holdMoneyIn(txn: Deposit | Refund, reason: MoneyInReason): Received {
    const entry: MoneyInEntry = { kind: 'money-in', id: txn.id, txn, reason, sortedTo: 'unsorted', effect: {} };
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

  #addSpending(txn: Purchase | CardCharge | Transfer, spendingKind: SpendingKind, sortedTo: SpendingSort): Received {
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

  // Rules 4.3, 4.4, 4.7, 4.8.
  #sortSpending(entry: SpendEntry, choice: SortChoice): void {
    if ('split' in choice) {
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

  #sortMoneyIn(entry: MoneyInEntry, choice: SortChoice): void {
    if ('split' in choice || !isBucket(choice.to)) throw new MoneyError('bad-choice', 'money in goes to one bucket');
    entry.sortedTo = choice.to;
    this.#setEffect(entry, { [choice.to]: entry.txn.amount });
    this.#review.delete(entry.id);
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
        const suggestion = entry.spendingKind === 'purchase' ? null : 'needs';
        return { type: 'spending', id: entry.id, date: entry.txn.date, amount: entry.amount - entry.refunded, description, reason, suggestion };
      }
      case 'leftover':
        return { type: 'leftover', id: entry.id, date: entry.date, bucket: entry.bucket, amount: entry.amount };
      case 'old-card':
        return { type: 'old-card-purchase', id: entry.id, date: entry.txn.date, amount: entry.amount, description: (entry.postedTxn ?? entry.txn).description };
      case 'paycheck':
      case 'refund':
      case 'transfer':
        throw new MoneyError('broken-book', `${entry.kind} ${entry.id} should never be in review`);
    }
  }
}
