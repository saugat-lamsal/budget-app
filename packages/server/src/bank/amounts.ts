import type { Cents } from '@budget-app/money';
import { BankDataError } from '../errors.js';

// Rule 0.1: whole cents only. Plaid sends dollars as JSON numbers, such as
// 72.1 for $72.10. JavaScript writes a number back as the shortest text that
// reads as the same number, which for an amount of up to 14 digits is the
// text Plaid sent. The cents are read from that text, so there is no
// floating-point multiplying (4.35 * 100 is 434.99999999999994). Anything
// that is not whole cents is refused, never rounded.
const AMOUNT_TEXT = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
// $999,999,999,999.99 at most: 14 digits, all of them exact.
const LIMIT = 1e12;

export function centsFromPlaid(amount: unknown, what = 'amount'): Cents {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new BankDataError(`${what} is not a number: ${String(amount)}`);
  if (Math.abs(amount) >= LIMIT) throw new BankDataError(`${what} is too large to keep exact: ${String(amount)}`);
  const match = AMOUNT_TEXT.exec(String(amount));
  if (match === null) throw new BankDataError(`${what} is not a whole number of cents: ${String(amount)}`);
  const [, sign = '', dollars = '0', fraction = ''] = match;
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, '0'));
  return sign === '-' && cents !== 0 ? -cents : cents;
}
