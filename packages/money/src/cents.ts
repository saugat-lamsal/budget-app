import { MoneyError } from './errors.js';

// Rule 0.1: every amount is a whole number of cents. Amounts are plain
// numbers, checked wherever they enter, and every sum is checked again so a
// total too big to stay exact is refused instead of silently rounded.
export type Cents = number;

export function assertCents(value: unknown, what = 'amount'): asserts value is Cents {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new MoneyError('not-cents', `${what} must be a whole number of cents, got ${String(value)}`);
  }
}

export function assertPositiveCents(value: unknown, what = 'amount'): asserts value is Cents {
  assertCents(value, what);
  if (value <= 0) throw new MoneyError('not-positive', `${what} must be more than zero, got ${value}`);
}

export function assertCentsAtLeastZero(value: unknown, what = 'amount'): asserts value is Cents {
  assertCents(value, what);
  if (value < 0) throw new MoneyError('not-positive', `${what} must be zero or more, got ${value}`);
}

export function addCents(...amounts: Cents[]): Cents {
  let total = 0;
  for (const amount of amounts) {
    assertCents(amount);
    total += amount;
    assertCents(total, 'total');
  }
  return total;
}

export function subtractCents(from: Cents, amount: Cents): Cents {
  assertCents(from);
  assertCents(amount);
  const result = from - amount;
  assertCents(result, 'result');
  return result;
}

// A whole-number percentage of an amount, rounded down to a whole cent. The
// multiplication runs on BigInt so very large amounts stay exact.
export function percentOf(amount: Cents, percent: number): Cents {
  assertCentsAtLeastZero(amount);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new MoneyError('bad-percent', `percent must be a whole number from 0 to 100, got ${percent}`);
  }
  return Number((BigInt(amount) * BigInt(percent)) / 100n);
}

const DOLLARS = /^(-?)\$?((?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.(\d{2}))?$/;

// Reads "1,234.56", "$1,500.00", "-12.30", or "3000" as cents, by text only.
export function parseDollars(text: string): Cents {
  const match = DOLLARS.exec(text);
  if (match === null) throw new MoneyError('not-dollars', `not a dollar amount: "${text}"`);
  const [, sign = '', whole = '', fraction = '00'] = match;
  const cents = BigInt(whole.replaceAll(',', '') + fraction) * (sign === '-' ? -1n : 1n);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError('not-dollars', `too large to keep exact: "${text}"`);
  }
  return Number(cents);
}

export function formatDollars(amount: Cents): string {
  assertCents(amount);
  const digits = String(Math.abs(amount)).padStart(3, '0');
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+$)/g, ',');
  return `${amount < 0 ? '-' : ''}$${whole}.${digits.slice(-2)}`;
}
