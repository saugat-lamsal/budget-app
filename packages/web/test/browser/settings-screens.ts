import { payoffCountdown, type Book, type Cents, type IsoDate, type SortingRule } from '@budget-app/money';
import type { BrowserContext, Page } from 'playwright';
import { dayWithYear } from '../../src/ui/dates.js';
import { daysText, leftoverText, reminderText, textRuleText, timeText } from '../../src/screens/settings-text.js';
import { openScenario, readCents, untilAnswered, waitOrReport } from './harness.js';

// Opens Settings on a made-up life, once its numbers are in. (openScenario
// also takes a screen marked "settings" as ready, which the placeholder used
// to be; the real screen is ready once it is no longer busy.)
export async function openSettings(context: BrowserContext, base: string, life: string): Promise<Page> {
  const page = await openScenario(context, base, life, '/settings');
  await waitOrReport(page, 'main[aria-busy="false"]');
  await untilAnswered(page);
  return page;
}

// Reading the Settings screen the way a person reads it, and working out what
// it should say straight from the book (the money package), so the two can be
// compared. Amounts are read as cents; words as words.

const BUCKETS = ['savings', 'needs', 'wants'] as const;
const KINDS = ['purchase', 'deposit', 'person'] as const;

export interface SettingsNumbers {
  // 13.1: each row of the table, this pay period and from the next paycheck.
  readonly split: Readonly<Record<(typeof BUCKETS)[number], { readonly now: string; readonly next: string; readonly changes: boolean }>>;
  readonly reserve: { readonly now: Cents; readonly next: Cents; readonly changes: boolean };
  readonly cap: { readonly now: Cents; readonly next: Cents; readonly changes: boolean };
  // Every other setting, as its row says it.
  readonly values: Readonly<Record<string, string>>;
  readonly target: { readonly low: Cents; readonly high: Cents };
  // 9.5: null while the countdown is off.
  readonly perPayday: Cents | null;
  // Each kind of rule, in the order shown: its number, its id, and what it picks.
  readonly rules: Readonly<Record<(typeof KINDS)[number], readonly string[]>>;
  // The change log's lines, newest first, by their key.
  readonly log: readonly string[];
}

const VALUE_ROWS = ['paycheck-rule', 'pay-schedule', 'early-days', 'leftover', 'mom-rule', 'low-alert', 'reminders', 'review-time', 'promo'] as const;

export async function readSettings(page: Page): Promise<SettingsNumbers> {
  const text = async (testId: string): Promise<string> => (await page.getByTestId(testId).innerText()).replace(/\s+/g, ' ').trim();
  const cents = async (testId: string): Promise<Cents> => readCents(await text(testId));
  // The value in a cell, without the word "Changes" under it.
  const cell = async (testId: string): Promise<string> => (await page.getByTestId(testId).locator('.compare__value').count()) > 0 ? (await page.getByTestId(testId).locator('.compare__value').innerText()).trim() : await text(testId);
  const row = async (name: string): Promise<{ readonly now: string; readonly next: string; readonly changes: boolean }> => ({
    now: await text(`split-${name}-first`),
    next: await cell(`split-${name}-second`),
    changes: (await page.getByTestId(`split-${name}`).getAttribute('data-differs')) === 'true',
  });
  const split = {} as Record<(typeof BUCKETS)[number], { now: string; next: string; changes: boolean }>;
  for (const b of BUCKETS) split[b] = await row(b);
  const money = async (name: string): Promise<{ now: Cents; next: Cents; changes: boolean }> => {
    const r = await row(name);
    return { now: readCents(r.now), next: readCents(r.next), changes: r.changes };
  };
  const values: Record<string, string> = {};
  for (const what of VALUE_ROWS) values[what] = await text(`value-${what}`);
  const rules = {} as Record<(typeof KINDS)[number], string[]>;
  for (const kind of KINDS) {
    // Each row: its number in the list, its rule, and what it picks.
    const ids = await page.getByTestId(`rules-${kind}`).locator('button[data-testid^="rule-"]').evaluateAll((els) =>
      els.map((e) => `${e.querySelector('.position')?.textContent ?? '?'} ${(e.getAttribute('data-testid') ?? '').replace(/^rule-/, '')}: ${e.querySelector('[data-testid$="-to"]')?.textContent ?? '?'}`),
    );
    rules[kind] = ids;
  }
  const log = await page.getByTestId('log').locator('[data-testid^="log-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? '').filter((id) => id !== 'log-empty'));
  return {
    split,
    reserve: await money('reserve'),
    cap: await money('cap'),
    values,
    target: { low: await cents('target-low'), high: await cents('target-high') },
    perPayday: (await page.getByTestId('payoff-per-payday').count()) > 0 ? await cents('payoff-per-payday') : null,
    rules,
    log,
  };
}

const CHOICE_WORDS: Readonly<Record<string, string>> = {
  needs: 'Needs',
  wants: 'Wants',
  savings: 'Savings',
  momReserve: 'Mom reserve',
  'other-income': 'Other income (split)',
  'not-mine': 'Not mine',
  mom: 'For mom',
};

function picks(rule: SortingRule): string {
  return CHOICE_WORDS[rule.for === 'purchase' ? rule.bucket : rule.choice.to] ?? '?';
}

// What the screen should show for this book today, from the money math.
export function settingsOf(book: Book, today: IsoDate): SettingsNumbers {
  const s = book.settings();
  const now = book.splitInForce();
  const pct = (n: number): string => `${n}%`;
  const split = Object.fromEntries(BUCKETS.map((b) => [b, { now: pct(now.split[b]), next: pct(s.split[b]), changes: now.split[b] !== s.split[b] }])) as SettingsNumbers['split'];
  const payoff = payoffCountdown(book, today);
  const rulesOf = (kind: SortingRule['for']): string[] => book.rules().filter((r) => r.for === kind).map((r, i) => `${i + 1}. ${r.id}: ${picks(r)}`);
  const log: string[] = [];
  book.changeLog().forEach((entry, i) => {
    const lines = entry.kind === 'settings-changed' ? Object.keys(entry.changes).length : 1;
    const keys = Array.from({ length: lines }, (_, j) => `log-${i}-${j}`);
    log.unshift(...keys);
  });
  return {
    split,
    reserve: { now: now.momReservePerPaycheck, next: s.momReservePerPaycheck, changes: now.momReservePerPaycheck !== s.momReservePerPaycheck },
    cap: { now: now.momReserveCap, next: s.momReserveCap, changes: now.momReserveCap !== s.momReserveCap },
    values: {
      'paycheck-rule': textRuleText(s.paycheckRule),
      'pay-schedule': `Every ${daysText(s.payScheduleDays)}`,
      'early-days': daysText(s.earlyPaycheckDays),
      leftover: leftoverText(s.leftoverAtPayday),
      'mom-rule': textRuleText(s.momRule),
      'low-alert': `${s.lowBucketAlertPercent}%`,
      reminders: reminderText(s.cardReminderDaysBefore),
      'review-time': timeText(s.dailyReviewTime),
      promo: s.oldCardPromoEndDate === null ? 'Not entered' : dayWithYear(s.oldCardPromoEndDate),
    },
    target: { low: s.momMonthlyTarget.low, high: s.momMonthlyTarget.high },
    perPayday: payoff.on ? payoff.perPayday : null,
    rules: { purchase: rulesOf('purchase'), deposit: rulesOf('deposit'), person: rulesOf('person') },
    log,
  };
}
