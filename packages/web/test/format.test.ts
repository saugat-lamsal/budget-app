import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parseDollars } from '@budget-app/money';
import { MINUS, moneyText, moneyWords } from '../src/ui/money-format.js';
import { barFill } from '../src/ui/bar-fill.js';
import { longDate, shortDate } from '../src/ui/dates.js';
import { dueText, paydayText, waitingText } from '../src/screens/home-text.js';

// How the screens write money, dates, and counts. Made-up numbers only.

describe('0.1 money is always written the same way (design rules)', () => {
  it('0.1 dollars and cents with commas', () => {
    expect(moneyText(123_456)).toBe('$1,234.56');
    expect(moneyText(100)).toBe('$1.00');
    expect(moneyText(99_999_999)).toBe('$999,999.99');
  });

  it('0.1 zero and one cent', () => {
    expect(moneyText(0)).toBe('$0.00');
    expect(moneyText(1)).toBe('$0.01');
  });

  it('0.1 a negative has a real minus sign in front, so it is obvious without color', () => {
    expect(moneyText(-1)).toBe(`${MINUS}$0.01`);
    expect(moneyText(-123_456)).toBe('−$1,234.56');
  });

  it('0.1 a screen reader says minus', () => {
    expect(moneyWords(-1_230)).toBe('minus $12.30');
    expect(moneyWords(1_230)).toBe('$12.30');
  });

  it('0.1 very large amounts stay exact', () => {
    expect(moneyText(900_719_925_474_099)).toBe('$9,007,199,254,740.99');
    expect(moneyText(-900_719_925_474_099)).toBe('−$9,007,199,254,740.99');
  });

  it('0.1 refuses anything that is not whole cents', () => {
    expect(() => moneyText(1.5)).toThrow();
    expect(() => moneyText(Number.NaN)).toThrow();
  });

  it('0.1 what is written reads back as the same cents, for any amount', () => {
    fc.assert(
      fc.property(fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }), (cents) => {
        expect(parseDollars(moneyText(cents).replace(MINUS, '-'))).toBe(cents);
      }),
    );
  });
});

describe('10.1 how full a bucket bar is', () => {
  it('10.1 what is left over what the bucket started the pay period with', () => {
    expect(barFill(50_000, 100_000)).toBe(0.5);
    expect(barFill(100_000, 100_000)).toBe(1);
    expect(barFill(1, 100_000)).toBeCloseTo(0.00001);
  });

  it('10.2 zero and below are an empty bar', () => {
    expect(barFill(0, 100_000)).toBe(0);
    expect(barFill(-500, 100_000)).toBe(0);
  });

  it('10.1 more than it started with (a payback, a hand move) is a full bar, not past the end', () => {
    expect(barFill(150_000, 100_000)).toBe(1);
  });

  it('10.1 a bucket that started at zero or below: full if anything is in it, else empty', () => {
    expect(barFill(1, 0)).toBe(1);
    expect(barFill(0, 0)).toBe(0);
    expect(barFill(500, -100)).toBe(1);
    expect(barFill(-1, -100)).toBe(0);
  });
});

describe('11.2 days to payday, in words', () => {
  it('11.2 days before payday', () => {
    expect(paydayText(9)).toBe('9 days to payday');
    expect(paydayText(2)).toBe('2 days to payday');
    expect(paydayText(1)).toBe('1 day to payday');
  });

  it('11.2 on payday', () => {
    expect(paydayText(0)).toBe('Payday is today');
  });

  it('11.2 a late paycheck says late, not a negative number (B35)', () => {
    expect(paydayText(-1)).toBe('Paycheck is 1 day late');
    expect(paydayText(-2)).toBe('Paycheck is 2 days late');
  });
});

describe('10.3 how many wait in review, in words', () => {
  it('10.3 one and more', () => {
    expect(waitingText(1)).toBe('1 waiting in review');
    expect(waitingText(12)).toBe('12 waiting in review');
  });
});

describe('9.1 9.2 when a card payment is due, in words', () => {
  it('9.1 days before the due date', () => {
    expect(dueText(7)).toBe('due in 7 days');
    expect(dueText(2)).toBe('due in 2 days');
    expect(dueText(1)).toBe('due in 1 day');
  });

  it('9.1 a reminder on the due date itself (0 days before is a setting he can pick)', () => {
    expect(dueText(0)).toBe('due today');
  });
});

describe('dates on the screens', () => {
  it('a short date with the weekday', () => {
    expect(shortDate('2026-10-16')).toBe('Fri, Oct 16');
    expect(shortDate('2026-01-01')).toBe('Thu, Jan 1');
  });

  it('the long date at the top of Home', () => {
    expect(longDate('2026-10-07')).toBe('Wednesday, October 7');
  });

  it('a date never shifts a day, whatever the time zone (the dates are calendar days)', () => {
    expect(shortDate('2026-03-08')).toBe('Sun, Mar 8');
    expect(shortDate('2026-11-01')).toBe('Sun, Nov 1');
    expect(shortDate('2026-12-31')).toBe('Thu, Dec 31');
  });
});
