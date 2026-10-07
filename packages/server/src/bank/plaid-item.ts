import { MoneyError, assertIsoDate, type Cents, type IsoDate } from '@budget-app/money';
import { BankDataError } from '../errors.js';
import { centsFromPlaid } from './amounts.js';

// One Plaid transaction, checked and reduced to what the app uses. Anything
// missing or of the wrong type is refused here, so the rest of the app never
// guesses at what the bank meant.
export interface PlaidItem {
  readonly id: string;
  readonly accountId: string;
  // Plaid's sign: positive is money out of the account.
  readonly amount: Cents;
  // For a pending item, the day it happened; once posted, the day it posted.
  readonly date: IsoDate;
  // The day it happened: when it was authorized, if the bank says (rule 4.1:
  // a purchase comes out of a bucket on the day of the purchase).
  readonly day: IsoDate;
  // The bank's own words when Plaid has them, otherwise Plaid's name for it.
  readonly description: string;
  readonly pending: boolean;
  readonly pendingTransactionId: string | null;
}

export type ReadResult = { readonly ok: true; readonly item: PlaidItem } | { readonly ok: false; readonly id: string | null; readonly why: string };

export function readPlaidItem(raw: unknown): ReadResult {
  const tx = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const id = typeof tx['transaction_id'] === 'string' && tx['transaction_id'] !== '' ? tx['transaction_id'] : null;
  try {
    if (id === null) throw new BankDataError('it has no transaction id');
    // The money math keeps ":" for ids of its own.
    if (id.includes(':')) throw new BankDataError('its id has a ":" in it');
    const accountId = text(tx['account_id'], 'account id');
    const amount = centsFromPlaid(tx['amount']);
    const currency = tx['iso_currency_code'];
    if (currency !== 'USD' && !(currency === null && tx['unofficial_currency_code'] === null)) {
      throw new BankDataError(`it is not in dollars (${String(currency ?? tx['unofficial_currency_code'])})`);
    }
    const date = day(tx['date'], 'date');
    const authorized = tx['authorized_date'] === null || tx['authorized_date'] === undefined ? null : day(tx['authorized_date'], 'authorized date');
    if (typeof tx['pending'] !== 'boolean') throw new BankDataError('it does not say whether it is pending');
    const link = tx['pending_transaction_id'];
    if (link !== null && link !== undefined && typeof link !== 'string') throw new BankDataError('its pending transaction id is not text');
    const original = tx['original_description'];
    const description = typeof original === 'string' && original.trim() !== '' ? original : text(tx['name'], 'description');
    return {
      ok: true,
      item: {
        id,
        accountId,
        amount,
        date,
        day: authorized ?? date,
        description,
        pending: tx['pending'],
        pendingTransactionId: typeof link === 'string' && link !== '' ? link : null,
      },
    };
  } catch (error) {
    if (error instanceof BankDataError || error instanceof MoneyError) return { ok: false, id, why: error.message };
    throw error;
  }
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new BankDataError(`its ${what} is not text`);
  return value;
}

function day(value: unknown, what: string): IsoDate {
  if (typeof value !== 'string') throw new BankDataError(`its ${what} is not a date`);
  assertIsoDate(value, what);
  return value;
}
