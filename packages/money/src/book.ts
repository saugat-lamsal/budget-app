import { addCents, assertCents, subtractCents, type Cents } from './cents.js';
import { assertIsoDate, daysBetween, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';
import { splitPaycheck, type PaycheckSplit } from './payday.js';
import { matchesTextRule, validateSettings, type Settings } from './settings.js';
import { checkTransaction, sameTransaction, type BankTransaction, type Deposit } from './transactions.js';

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
type Effect = Partial<Record<PotName, Cents>>;

const POT_NAMES: readonly PotName[] = ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers', 'unsortedIn', 'unsortedOut'];

export interface OpenBookInput {
  // The day tracking starts.
  readonly date: IsoDate;
  readonly pots: StartingPots;
  readonly oldCardDebt: Cents;
  // The pay schedule counts from this date until the first paycheck arrives.
  readonly lastPaycheckDate: IsoDate;
  readonly settings: Settings;
}

export type ReceiveOutcome = 'paycheck' | 'review' | 'duplicate';

export interface Received {
  readonly id: string;
  readonly outcome: ReceiveOutcome;
}

export type LeftoverAnswer = 'roll-over' | 'move-to-savings';
export type SplitBucket = 'needs' | 'wants';

export type ReviewItem =
  | {
      readonly type: 'money-in';
      readonly id: string;
      readonly date: IsoDate;
      readonly amount: Cents;
      readonly description: string;
      readonly reason: 'deposit' | 'early-paycheck';
    }
  | {
      readonly type: 'leftover';
      readonly id: string;
      readonly date: IsoDate;
      readonly bucket: SplitBucket;
      readonly amount: Cents;
    };

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
  readonly txn: Deposit;
  readonly reason: 'deposit' | 'early-paycheck';
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

type Entry = PaycheckEntry | MoneyInEntry | LeftoverEntry;

export function openBook(input: OpenBookInput): Book {
  return new Book(input);
}

export class Book {
  readonly #opening: StartingPots;
  readonly #pots: Record<PotName, Cents>;
  readonly #entries = new Map<string, Entry>();
  // Ids of entries waiting for you, in the order they arrived.
  readonly #review = new Set<string>();
  readonly #paychecks: PaycheckRecord[] = [];
  #settings: Settings;
  #lastPaycheckDate: IsoDate;
  #period: Period;

  constructor(input: OpenBookInput) {
    assertIsoDate(input.date, 'start date');
    assertIsoDate(input.lastPaycheckDate, 'last paycheck date');
    assertCents(input.oldCardDebt, 'old card debt');
    const { savings, needs, wants, momReserve, heldForOthers } = input.pots;
    this.#opening = Object.freeze({ savings, needs, wants, momReserve, heldForOthers });
    for (const [name, value] of Object.entries(this.#opening)) assertCents(value, name);
    this.#pots = { ...this.#opening, unsortedIn: 0, unsortedOut: 0 };
    addCents(...Object.values(this.#pots));
    this.#settings = validateSettings(input.settings);
    this.#lastPaycheckDate = input.lastPaycheckDate;
    this.#period = { number: 0, startDate: input.date };
  }

  // ----- Reading -----

  pots(): Pots {
    return Object.freeze({ ...this.#pots });
  }

  // Adds every bucket up again from the starting amounts and every entry.
  // Must always equal pots(); a difference means the book is broken.
  recountPots(): Pots {
    const totals: Record<PotName, Cents> = { ...this.#opening, unsortedIn: 0, unsortedOut: 0 };
    for (const entry of this.#entries.values()) {
      for (const name of POT_NAMES) totals[name] = addCents(totals[name], entry.effect[name] ?? 0);
    }
    return Object.freeze(totals);
  }

  settings(): Settings {
    return this.#settings;
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

  reviewItems(): ReviewItem[] {
    return [...this.#review].map((id) => this.#reviewView(this.#entry(id)));
  }

  // Rule 3.8: what should be sitting in the savings account (savings plus
  // the mom reserve), and how much still needs to be moved there. Negative
  // means the account holds more than the buckets say.
  savingsTransfer(savingsAccountBalance: Cents): SavingsTransfer {
    assertCents(savingsAccountBalance, 'savings account balance');
    const shouldBeInSavings = addCents(this.#pots.savings, this.#pots.momReserve);
    return { shouldBeInSavings, savingsAccountBalance, stillToMove: subtractCents(shouldBeInSavings, savingsAccountBalance) };
  }

  // ----- Bank activity -----

  receive(txn: BankTransaction): Received {
    checkTransaction(txn);
    const existing = this.#entries.get(txn.id);
    if (existing !== undefined) {
      if ('txn' in existing && sameTransaction(existing.txn, txn)) return { id: txn.id, outcome: 'duplicate' };
      throw new MoneyError('conflicting-id', `a different transaction already has id ${txn.id}`);
    }
    const copy = Object.freeze({ ...txn });
    switch (copy.kind) {
      case 'deposit':
        return this.#receiveDeposit(copy);
    }
  }

  #receiveDeposit(txn: Deposit): Received {
    const s = this.#settings;
    if (!matchesTextRule(s.paycheckRule, txn.description)) return this.#holdMoneyIn(txn, 'deposit');
    // Rule 3.7: too soon after the last paycheck to split automatically.
    if (daysBetween(this.#lastPaycheckDate, txn.date) < s.earlyPaycheckDays) return this.#holdMoneyIn(txn, 'early-paycheck');
    this.#payday(txn);
    return { id: txn.id, outcome: 'paycheck' };
  }

  #holdMoneyIn(txn: Deposit, reason: MoneyInEntry['reason']): Received {
    const entry: MoneyInEntry = { kind: 'money-in', id: txn.id, txn, reason, effect: {} };
    this.#add(entry, { unsortedIn: txn.amount });
    this.#review.add(entry.id);
    return { id: txn.id, outcome: 'review' };
  }

  // Rules 3.1 to 3.5.
  #payday(txn: Deposit): void {
    this.#closePeriod('needs', txn);
    this.#closePeriod('wants', txn);
    const split = splitPaycheck(txn.amount, this.#pots.momReserve, this.#settings);
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
    const amount = this.#pots[bucket];
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
    const updated = { ...this.#pots };
    for (const name of POT_NAMES) {
      const change = subtractCents(next[name] ?? 0, entry.effect[name] ?? 0);
      updated[name] = addCents(updated[name], change);
    }
    Object.assign(this.#pots, updated);
    entry.effect = { ...next };
  }

  #reviewView(entry: Entry): ReviewItem {
    switch (entry.kind) {
      case 'money-in': {
        const { id, date, amount, description } = entry.txn;
        return { type: 'money-in', id, date, amount, description, reason: entry.reason };
      }
      case 'leftover':
        return { type: 'leftover', id: entry.id, date: entry.date, bucket: entry.bucket, amount: entry.amount };
      case 'paycheck':
        throw new MoneyError('broken-book', `paycheck ${entry.id} should never be in review`);
    }
  }
}
