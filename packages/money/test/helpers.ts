import {
  DEFAULT_SETTINGS,
  changeSettings,
  openBook,
  type BankTransaction,
  type Book,
  type CardCharge,
  type Deposit,
  type Purchase,
  type Refund,
  type Transfer,
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

// The posted version of a pending purchase. The bank gives it a new id.
export function posted(id: string, pendingId: string, date: IsoDate, amount: Cents, description = 'MADE UP STORE', account: Purchase['account'] = 'everyday-card'): Purchase {
  return { kind: 'purchase', id, account, date, amount, description, pending: false, pendingId };
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

  constructor(start: { checking?: Cents; savings?: Cents; everydayCard?: Cents; oldCard?: Cents } = {}) {
    Object.assign(this, start);
  }

  // Pending purchases by id, so a posting can replace the pending amount.
  readonly #pending = new Map<string, { account: Purchase['account']; amount: Cents }>();

  apply(txn: BankTransaction): void {
    switch (txn.kind) {
      case 'deposit':
        this[txn.account] += txn.amount;
        break;
      case 'purchase': {
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
      case 'transfer':
        this[txn.from] -= txn.amount;
        if (txn.to === 'checking' || txn.to === 'savings') this[txn.to] += txn.amount;
        else this.#spend(txn.to, -txn.amount);
        break;
    }
  }

  // Money spent on an account: checking goes down, a card balance goes up.
  #spend(account: Purchase['account'], amount: Cents): void {
    if (account === 'checking') this.checking -= amount;
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
