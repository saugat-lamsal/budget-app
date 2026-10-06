import {
  DEFAULT_SETTINGS,
  changeSettings,
  openBook,
  type BankTransaction,
  type Book,
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

export function paycheck(id: string, date: IsoDate, amount: Cents): BankTransaction {
  return { kind: 'deposit', id, account: 'checking', date, amount, description: `${PAYROLL} DIRECT DEP` };
}

export function deposit(
  id: string,
  date: IsoDate,
  amount: Cents,
  description = 'MADE UP DEPOSIT',
  account: 'checking' | 'savings' = 'checking',
): BankTransaction {
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

  constructor(start: { checking?: Cents; savings?: Cents; everydayCard?: Cents } = {}) {
    Object.assign(this, start);
  }

  apply(txn: BankTransaction): void {
    switch (txn.kind) {
      case 'deposit':
        this[txn.account] += txn.amount;
        break;
    }
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
