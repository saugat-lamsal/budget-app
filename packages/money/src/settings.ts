import { assertCentsAtLeastZero, type Cents } from './cents.js';
import { assertIsoDate, type IsoDate } from './dates.js';
import { MoneyError } from './errors.js';

// Rule 0.2: every number and rule in the rulebook is a setting. These are
// the starting values from rulebook section 2.

export type LeftoverChoice = 'ask' | 'roll-over' | 'move-to-savings';

// Matches a bank description that contains this text, ignoring case.
export interface TextRule {
  readonly contains: string;
}

export interface Settings {
  // Percent of each paycheck (after the mom reserve) for each bucket.
  readonly split: { readonly savings: number; readonly needs: number; readonly wants: number };
  readonly momReservePerPaycheck: Cents;
  readonly momReserveCap: Cents;
  readonly momMonthlyTarget: { readonly low: Cents; readonly high: Cents };
  readonly lowBucketAlertPercent: number;
  readonly cardReminderDaysBefore: readonly number[];
  // "HH:MM", 24-hour clock.
  readonly dailyReviewTime: string;
  readonly leftoverAtPayday: { readonly needs: LeftoverChoice; readonly wants: LeftoverChoice };
  readonly oldCardPromoEndDate: IsoDate | null;
  // How a paycheck shows up on the statement. Set after the first sync.
  readonly paycheckRule: TextRule | null;
  readonly payScheduleDays: number;
  // Mom's name as it appears on transfers.
  readonly momRule: TextRule | null;
  // Rule 3.7: a paycheck-looking deposit less than this many days after the
  // last paycheck goes to review.
  readonly earlyPaycheckDays: number;
}

export const DEFAULT_SETTINGS: Settings = deepFreeze({
  split: { savings: 50, needs: 30, wants: 20 },
  momReservePerPaycheck: 150_000,
  momReserveCap: 300_000,
  momMonthlyTarget: { low: 200_000, high: 300_000 },
  lowBucketAlertPercent: 20,
  cardReminderDaysBefore: [7, 2],
  dailyReviewTime: '20:00',
  leftoverAtPayday: { needs: 'ask', wants: 'ask' },
  oldCardPromoEndDate: null,
  paycheckRule: null,
  payScheduleDays: 14,
  momRule: null,
  earlyPaycheckDays: 10,
});

const LEFTOVER_CHOICES: readonly LeftoverChoice[] = ['ask', 'roll-over', 'move-to-savings'];

// Rule 13.1: a change to these waits for the next paycheck; every other
// setting applies right away (QUESTIONS.md B38).
export const FROM_NEXT_PAYCHECK = Object.freeze(['split', 'momReservePerPaycheck', 'momReserveCap'] as const);

export function changeSettings(current: Settings, patch: Partial<Settings>): Settings {
  for (const key of Object.keys(patch)) check(Object.hasOwn(DEFAULT_SETTINGS, key), `there is no setting called ${key}`);
  return validateSettings({ ...current, ...patch });
}

// Returns a frozen copy, or refuses with code "bad-setting".
export function validateSettings(settings: Settings): Settings {
  const s = settings;
  check(
    [s.split.savings, s.split.needs, s.split.wants].every((p) => Number.isInteger(p) && p >= 0 && p <= 100),
    'split percentages must be whole numbers from 0 to 100',
  );
  const sum = s.split.savings + s.split.needs + s.split.wants;
  check(sum === 100, `split must add up to 100, not ${sum}`);
  checkCents(s.momReservePerPaycheck, 'mom reserve per paycheck');
  checkCents(s.momReserveCap, 'mom reserve cap');
  checkCents(s.momMonthlyTarget.low, 'mom monthly target low end');
  checkCents(s.momMonthlyTarget.high, 'mom monthly target high end');
  check(s.momMonthlyTarget.low <= s.momMonthlyTarget.high, 'mom monthly target low end must not be above the high end');
  check(isWholeInRange(s.lowBucketAlertPercent, 0, 100), 'low-bucket alert must be a whole percent from 0 to 100');
  check(s.cardReminderDaysBefore.every((d) => isWholeInRange(d, 0, Infinity)), 'card reminder days must be whole days, zero or more');
  check(/^([01]\d|2[0-3]):[0-5]\d$/.test(s.dailyReviewTime), 'daily review time must be HH:MM');
  check(LEFTOVER_CHOICES.includes(s.leftoverAtPayday.needs), 'leftover choice for needs is not one of the options');
  check(LEFTOVER_CHOICES.includes(s.leftoverAtPayday.wants), 'leftover choice for wants is not one of the options');
  if (s.oldCardPromoEndDate !== null) {
    try {
      assertIsoDate(s.oldCardPromoEndDate);
    } catch {
      check(false, 'old card promo end date must be a real date');
    }
  }
  checkTextRule(s.paycheckRule, 'paycheck rule');
  checkTextRule(s.momRule, 'mom rule');
  check(isWholeInRange(s.payScheduleDays, 1, Infinity), 'pay schedule must be a whole number of days, at least 1');
  check(isWholeInRange(s.earlyPaycheckDays, 0, Infinity), 'early paycheck days must be a whole number, zero or more');
  return deepFreeze(copySettings(s));
}

function copySettings(s: Settings): Settings {
  return {
    ...s,
    split: { ...s.split },
    momMonthlyTarget: { ...s.momMonthlyTarget },
    cardReminderDaysBefore: [...s.cardReminderDaysBefore],
    leftoverAtPayday: { ...s.leftoverAtPayday },
    paycheckRule: s.paycheckRule === null ? null : { ...s.paycheckRule },
    momRule: s.momRule === null ? null : { ...s.momRule },
  };
}

function check(ok: boolean, message: string): void {
  if (!ok) throw new MoneyError('bad-setting', message);
}

function checkCents(value: Cents, what: string): void {
  try {
    assertCentsAtLeastZero(value, what);
  } catch {
    check(false, `${what} must be whole cents, zero or more`);
  }
}

function checkTextRule(rule: TextRule | null, what: string): void {
  if (rule !== null) check(rule.contains.trim() !== '', `${what} needs some text to match`);
}

function isWholeInRange(value: number, low: number, high: number): boolean {
  return Number.isInteger(value) && value >= low && value <= high;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

// True when a bank description matches a text rule, ignoring case.
export function matchesTextRule(rule: TextRule | null, description: string): boolean {
  return rule !== null && description.toLowerCase().includes(rule.contains.trim().toLowerCase());
}
