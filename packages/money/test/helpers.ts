import {
  DEFAULT_SETTINGS,
  changeSettings,
  openBook,
  type BankTransaction,
  type Book,
  type CardCharge,
  type Deposit,
  type Purchase,
  type SavingsWithdrawal,
  type PendingChanged,
  type PendingDropped,
  type PersonPayment,
  type TakenBack,
  type Refund,
  type Transfer,
  type TransferArrived,
  type TransferSent,
  type Cents,
  type IsoDate,
  type OpenBookInput,
  type Pots,
  type Settings,
} from '../src/index.js';

// Made-up names only. No real account numbers, names, or balances in tests.
export const PAYROLL = 'ACME PAYROLL';
export const MOM_NAME = 'Made Up Mom';

export const TEST_SETTINGS: Settings = changeSettings(DEFAULT_SETTINGS, {
  paycheckRule: { contains: PAYROLL },
  momRule: { contains: MOM_NAME },
});

export const START_DATE: IsoDate = '2026-10-01';
export const LAST_PAYCHECK: IsoDate = '2026-09-25';

export const ZERO_POTS = { savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0 } as const;

export interface TestBookOptions extends Partial<Omit<OpenBookInput, 'settings' | 'pots'>> {
  settings?: Partial<Settings>;
  pots?: Partial<OpenBookInput['pots']>;
}

export function openTestBook(options: TestBookOptions = {}): Book {
  const { settings = {}, pots = {}, ...rest } = options;
  return openBook({
    date: START_DATE,
    lastPaycheckDate: LAST_PAYCHECK,
    oldCardDebt: 0,
    ...rest,
    pots: { ...ZERO_POTS, ...pots },
    settings: changeSettings(TEST_SETTINGS, settings),
  });
}

export function paycheck(id: string, date: IsoDate, amount: Cents): Deposit {
  return { kind: 'deposit', id, account: 'checking', date, amount, description: `${PAYROLL} DIRECT DEP` };
}

export function purchase(
  id: string,
  date: IsoDate,
  amount: Cents,
  description = 'MADE UP STORE',
  options: { account?: Purchase['account']; pending?: boolean } = {},
): Purchase {
  return { kind: 'purchase', id, account: options.account ?? 'everyday-card', date, amount, description, pending: options.pending ?? false };
}

// Other money leaving savings, such as a bill paid from it (4.9, A16).
export function withdrawal(id: string, date: IsoDate, amount: Cents, description = 'MADE UP BILL PAY', options: { pending?: boolean; pendingId?: string } = {}): SavingsWithdrawal {
  return { kind: 'savings-withdrawal', id, account: 'savings', date, amount, description, pending: options.pending ?? false, ...(options.pendingId === undefined ? {} : { pendingId: options.pendingId }) };
}

// The posted version of a pending purchase. The bank gives it a new id.
export function posted(id: string, pendingId: string, date: IsoDate, amount: Cents, description = 'MADE UP STORE', account: Purchase['account'] = 'everyday-card'): Purchase {
  return { kind: 'purchase', id, account, date, amount, description, pending: false, pendingId };
}

// The bank dropping a pending charge without posting it (QUESTIONS.md A2).
export function dropped(id: string, pendingId: string, date: IsoDate): PendingDropped {
  return { kind: 'pending-dropped', id, pendingId, date, description: 'HOLD RELEASED' };
}

export function refund(id: string, date: IsoDate, amount: Cents, refundOf?: string, account: Refund['account'] = 'everyday-card'): Refund {
  return { kind: 'refund', id, account, date, amount, description: 'MADE UP STORE REFUND', ...(refundOf === undefined ? {} : { refundOf }) };
}

export function cardCharge(id: string, date: IsoDate, amount: Cents, charge: 'fee' | 'interest' = 'fee', account: CardCharge['account'] = 'everyday-card'): CardCharge {
  return { kind: 'card-charge', id, account, date, amount, description: charge === 'fee' ? 'LATE FEE' : 'INTEREST CHARGE', charge };
}

export function transfer(id: string, date: IsoDate, amount: Cents, from: Transfer['from'], to: Transfer['to']): Transfer {
  return { kind: 'transfer', id, from, to, date, amount, description: `TRANSFER ${from} TO ${to}` };
}

// Money sent to a person (Zelle and the like), from checking or savings (A16).
export function payPerson(id: string, date: IsoDate, amount: Cents, payee: string, account: PersonPayment['account'] = 'checking'): PersonPayment {
  return { kind: 'payment-to-person', id, account, date, amount, description: `ZELLE TO ${payee}` };
}

// The bank changing a pending charge's amount before it posts (QUESTIONS.md A13).
export function pendingChanged(id: string, pendingId: string, date: IsoDate, amount: Cents): PendingChanged {
  return { kind: 'pending-changed', id, pendingId, date, amount, description: 'MADE UP STORE' };
}

// The bank taking back a transaction the app had counted (QUESTIONS.md A14).
export function takenBack(id: string, takenId: string, date: IsoDate): TakenBack {
  return { kind: 'taken-back', id, takenId, date, description: 'CORRECTION' };
}

// The two halves of a transfer, when the bank shows them on different days:
// the money leaving one account, then arriving in the other (12.5).
export function sent(id: string, date: IsoDate, amount: Cents, from: TransferSent['from'], to: TransferSent['to']): TransferSent {
  return { kind: 'transfer-sent', id, from, to, date, amount, description: `PAYMENT FROM ${from} TO ${to}` };
}

export function arrived(id: string, date: IsoDate, amount: Cents, from: TransferArrived['from'], to: TransferArrived['to'], sentId?: string): TransferArrived {
  return { kind: 'transfer-arrived', id, from, to, date, amount, description: `PAYMENT RECEIVED FROM ${from}`, ...(sentId === undefined ? {} : { sentId }) };
}

export function deposit(
  id: string,
  date: IsoDate,
  amount: Cents,
  description = 'MADE UP DEPOSIT',
  account: 'checking' | 'savings' = 'checking',
): Deposit {
  return { kind: 'deposit', id, account, date, amount, description };
}

// The app side of the self-check (rule 12.2), worked out here on its own so
// tests do not lean on the code they are checking.
export function appSide(p: Pots): Cents {
  return p.savings + p.needs + p.wants + p.momReserve + p.heldForOthers + p.unsortedIn - p.unsortedOut;
}

// A made-up bank that follows the same transactions, so tests can compare
// the app's buckets with what the bank would show (rule 12.1).
export class TestBank {
  checking = 0;
  savings = 0;
  everydayCard = 0;
  // Not part of the self-check (12.4), tracked to compare with the debt shown.
  oldCard = 0;
  // Money that has left checking or savings for checking, savings, or the
  // everyday card and not arrived yet (12.5), worked out here on its own.
  inTransit = 0;

  constructor(start: { checking?: Cents; savings?: Cents; everydayCard?: Cents; oldCard?: Cents } = {}) {
    Object.assign(this, start);
  }

  // Pending purchases by id, so a posting can replace the pending amount.
  readonly #pending = new Map<string, { account: Purchase['account'] | 'savings'; amount: Cents }>();
  // Everything applied, by id, so the bank can take one back.
  readonly #applied = new Map<string, BankTransaction>();

  apply(txn: BankTransaction): void {
    this.#applied.set(txn.id, txn);
    switch (txn.kind) {
      case 'deposit':
        this[txn.account] += txn.amount;
        break;
      case 'purchase':
      case 'savings-withdrawal': {
        const earlier = txn.pendingId === undefined ? undefined : this.#pending.get(txn.pendingId);
        if (earlier !== undefined && txn.pendingId !== undefined) {
          this.#spend(earlier.account, -earlier.amount);
          this.#pending.delete(txn.pendingId);
        }
        this.#spend(txn.account, txn.amount);
        if (txn.pending) this.#pending.set(txn.id, { account: txn.account, amount: txn.amount });
        break;
      }
      case 'refund':
        this.#spend(txn.account, -txn.amount);
        break;
      case 'card-charge':
        this.#spend(txn.account, txn.amount);
        break;
      case 'payment-to-person':
        this[txn.account] -= txn.amount;
        break;
      case 'transfer':
        this[txn.from] -= txn.amount;
        this.#land(txn.to, txn.amount);
        break;
      case 'transfer-sent':
        this[txn.from] -= txn.amount;
        if (txn.to !== 'old-card') this.inTransit += txn.amount;
        break;
      case 'transfer-arrived':
        this.#land(txn.to, txn.amount);
        if (txn.to !== 'old-card') this.inTransit -= txn.amount;
        break;
      case 'pending-dropped': {
        const earlier = this.#pending.get(txn.pendingId);
        if (earlier !== undefined) {
          this.#spend(earlier.account, -earlier.amount);
          this.#pending.delete(txn.pendingId);
        }
        break;
      }
      case 'pending-changed': {
        const earlier = this.#pending.get(txn.pendingId);
        if (earlier !== undefined) {
          this.#spend(earlier.account, txn.amount - earlier.amount);
          earlier.amount = txn.amount;
        }
        break;
      }
      case 'taken-back': {
        const gone = this.#applied.get(txn.takenId);
        if (gone !== undefined) this.#undo(gone);
        break;
      }
    }
  }

  // The bank taking a transaction back: as if it had never happened.
  #undo(txn: BankTransaction): void {
    switch (txn.kind) {
      case 'deposit':
        this[txn.account] -= txn.amount;
        break;
      case 'purchase':
      case 'savings-withdrawal':
        this.#spend(txn.account, -txn.amount);
        break;
      case 'refund':
        this.#spend(txn.account, txn.amount);
        break;
      case 'card-charge':
        this.#spend(txn.account, -txn.amount);
        break;
      case 'payment-to-person':
        this[txn.account] += txn.amount;
        break;
      case 'transfer':
        this[txn.from] += txn.amount;
        this.#land(txn.to, -txn.amount);
        break;
      case 'transfer-sent':
        this[txn.from] += txn.amount;
        if (txn.to !== 'old-card') this.inTransit -= txn.amount;
        break;
      case 'transfer-arrived':
        this.#land(txn.to, -txn.amount);
        if (txn.to !== 'old-card') this.inTransit += txn.amount;
        break;
      case 'pending-dropped':
      case 'pending-changed':
      case 'taken-back':
        break;
    }
  }

  // Money arriving in an account: checking and savings go up, a card owes less.
  #land(account: Transfer['to'], amount: Cents): void {
    if (account === 'checking' || account === 'savings') this[account] += amount;
    else this.#spend(account, -amount);
  }

  // Money spent on an account: checking and savings go down, a card balance goes up.
  #spend(account: Purchase['account'] | 'savings', amount: Cents): void {
    if (account === 'checking' || account === 'savings') this[account] -= amount;
    else if (account === 'everyday-card') this.everydayCard += amount;
    else this.oldCard += amount;
  }

  side(): Cents {
    return this.checking + this.savings - this.everydayCard;
  }
}

export function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code;
    throw error;
  }
  return 'no error';
}
