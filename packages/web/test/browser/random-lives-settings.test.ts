import { RULE_CHOICES, addDays, formatDollars, type Settings, type SortingRule } from '@budget-app/money';
import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { Random } from '../../../money/test/sim/random.js';
import { ENGINES, close, phone, untilQuiet, useEngine } from './harness.js';
import { openLive, startLive } from './live.js';
import { FIRST_SEED, LIVES, randomDay } from './random-day.js';
import { bucketsOf, readBuckets, watchChoices } from './screens.js';
import { readSettings, settingsOf } from './settings-screens.js';

// Random made-up lives (the Phase 2 simulator), each stopped on a random day
// and shown on Settings. Whatever the day looks like, every setting shown must
// be the book's, and a few random changes made on the screen (some of them
// ones the money math refuses) must do exactly what the same changes do to a
// twin of the book given straight to the money math.
// WEB_LIVES and WEB_FIRST_SEED run more, or replay one.

// "1500.25": what he would type for this many cents.
const typed = (cents: number): string => formatDollars(cents).replace('$', '').replaceAll(',', '');

// One random change: what to do on the screen, and what to give the twin
// (null when the money math should refuse it, so the twin gets nothing).
interface Change {
  readonly what: string;
  readonly row: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly patch: Partial<Settings> | null;
  readonly asksFirst?: boolean;
  readonly rule?: Omit<Extract<SortingRule, { for: 'purchase' }>, 'id'> | Omit<Extract<SortingRule, { for: 'deposit' | 'person' }>, 'id'>;
  // A22: a rule moved one place, from its sheet.
  readonly move?: { readonly id: string; readonly direction: 'up' | 'down' };
}

function randomChange(random: Random, settings: Settings, descriptions: readonly string[]): Change {
  const pick = random.int(0, 11);
  switch (pick) {
    case 0: {
      const savings = random.int(0, 100);
      const needs = random.int(0, 100 - savings);
      // Now and then the three do not add up to 100: the money math refuses it.
      const wants = random.int(0, 4) === 0 ? random.int(0, 100) : 100 - savings - needs;
      const split = { savings, needs, wants };
      return { what: `split ${savings}/${needs}/${wants}`, row: 'row-split', fields: { 'field-savings': String(savings), 'field-needs': String(needs), 'field-wants': String(wants) }, patch: savings + needs + wants === 100 ? { split } : null };
    }
    case 1: {
      const per = random.int(0, 300_000);
      const cap = random.int(0, 400_000);
      return { what: `reserve ${per} cap ${cap}`, row: 'row-reserve', fields: { 'field-reserve': typed(per), 'field-cap': typed(cap) }, patch: { momReservePerPaycheck: per, momReserveCap: cap } };
    }
    case 2: {
      const low = random.int(0, 300_000);
      const high = random.int(0, 300_000);
      return { what: `target ${low} to ${high}`, row: 'row-target', fields: { 'field-target-low': typed(low), 'field-target-high': typed(high) }, patch: low <= high ? { momMonthlyTarget: { low, high } } : null };
    }
    case 3: {
      const percent = random.int(0, 120);
      return { what: `low alert ${percent}`, row: 'row-low-alert', fields: { 'field-low-alert': String(percent) }, patch: percent <= 100 ? { lowBucketAlertPercent: percent } : null };
    }
    case 4: {
      const days = Array.from({ length: random.int(0, 3) }, () => random.int(0, 30));
      return { what: `reminders ${days.join(',')}`, row: 'row-reminders', fields: { 'field-reminders': days.join(', ') }, patch: { cardReminderDaysBefore: days } };
    }
    case 5: {
      const time = `${String(random.int(0, 23)).padStart(2, '0')}:${String(random.int(0, 59)).padStart(2, '0')}`;
      return { what: `review at ${time}`, row: 'row-review-time', fields: { 'field-review-time': time }, patch: { dailyReviewTime: time } };
    }
    case 6: {
      const choices = ['ask', 'roll-over', 'move-to-savings'] as const;
      const needs = random.pick(choices);
      const wants = random.pick(choices);
      return { what: `leftover ${needs} ${wants}`, row: 'row-leftover', fields: { 'field-leftover-needs': needs, 'field-leftover-wants': wants }, patch: { leftoverAtPayday: { needs, wants } } };
    }
    case 7: {
      const days = random.int(0, 30);
      return { what: `pay schedule ${days}`, row: 'row-pay-schedule', fields: { 'field-pay-schedule': String(days) }, patch: days >= 1 ? { payScheduleDays: days } : null };
    }
    case 8: {
      const days = random.int(0, 20);
      return { what: `early days ${days}`, row: 'row-early-days', fields: { 'field-early-days': String(days) }, patch: { earlyPaycheckDays: days } };
    }
    case 9: {
      const date = addDays('2026-11-01', random.int(0, 500));
      return { what: `promo ${date}`, row: 'row-promo', fields: { 'field-promo': date }, patch: { oldCardPromoEndDate: date } };
    }
    case 10: {
      // The paycheck rule, set to text from something waiting or from the old rule: it asks first (A9).
      const text = random.int(0, 1) === 0 && descriptions.length > 0 ? random.pick(descriptions).slice(0, 12).trim() : (settings.paycheckRule?.contains ?? 'PAYROLL');
      return { what: `paycheck rule "${text}"`, row: 'row-paycheck-rule', fields: { 'field-paycheck-rule': text }, patch: text === '' ? null : { paycheckRule: { contains: text } }, asksFirst: true };
    }
    default: {
      const kind = random.pick(['purchase', 'deposit', 'person'] as const);
      const to = random.pick(RULE_CHOICES[kind] as readonly string[]);
      const text = descriptions.length > 0 ? random.pick(descriptions).slice(0, 10).trim() || 'MADE UP' : 'MADE UP';
      const rule = (kind === 'purchase' ? { for: kind, contains: text, bucket: to } : { for: kind, contains: text, choice: { to } }) as Change['rule'];
      return { what: `rule ${kind} "${text}" ${to}`, row: 'row-add-rule', fields: { 'field-rule-kind': kind, 'field-rule-text': text, 'field-rule-to': to }, patch: null, ...(rule === undefined ? {} : { rule }) };
    }
  }
}

// A22: a rule that can move, and which way (the first cannot go up, the last cannot go down).
function randomMove(random: Random, rules: readonly SortingRule[]): Change | null {
  const movable = rules.flatMap((rule) => {
    const ofItsKind = rules.filter((r) => r.for === rule.for);
    const place = ofItsKind.indexOf(rule);
    return [...(place > 0 ? [{ id: rule.id, direction: 'up' as const }] : []), ...(place < ofItsKind.length - 1 ? [{ id: rule.id, direction: 'down' as const }] : [])];
  });
  if (movable.length === 0) return null;
  const move = random.pick(movable);
  return { what: `move ${move.id} ${move.direction}`, row: `rule-${move.id}`, fields: {}, patch: null, move };
}

async function make(page: Page, change: Change): Promise<void> {
  if (change.move !== undefined) {
    await page.getByTestId(change.row).click();
    await page.getByTestId(`sheet-move-${change.move.direction}`).click();
    await page.getByTestId('notice').waitFor();
    await untilQuiet(page);
    return;
  }
  await page.getByTestId(change.row).click();
  await page.getByTestId('settings-sheet').waitFor();
  for (const [testId, value] of Object.entries(change.fields)) {
    const field = page.getByTestId(testId);
    await field.waitFor();
    if ((await field.evaluate((e) => e.tagName)) === 'SELECT') await field.selectOption(value);
    else await field.fill(value);
  }
  await page.getByTestId('sheet-save').click();
  // What the money math answers: done, a question first, or a refusal (or "already so").
  await page.locator('[data-testid="notice"], [data-testid="confirm-yes"], [data-testid="sheet-problem"]').first().waitFor();
  if ((await page.getByTestId('confirm-yes').count()) > 0) await page.getByTestId('confirm-yes').click();
  await page.locator('[data-testid="notice"], [data-testid="sheet-problem"]').first().waitFor();
  if ((await page.getByTestId('sheet-problem').count()) > 0) await page.keyboard.press('Escape');
  await untilQuiet(page);
}

describe.each(ENGINES)('random lives on Settings in %s', (_name, engine) => {
  const { browser } = useEngine(engine);

  const seeds = Array.from({ length: LIVES }, (_, i) => FIRST_SEED + i);
  it.each(seeds)('0.2 13.1 13.2 13.5 every setting shown is the book\'s, and random changes do what they do to the twin, life %i', async (seed) => {
    const life = randomDay(seed);
    const twin = randomDay(seed);
    const where = `seed ${life.seed}, day ${life.day} (${life.today})`;
    const live = await startLive(life);
    const context = await browser().newContext(phone());
    try {
      const page = await openLive(context, live.base, '/settings');
      page.setDefaultTimeout(20_000);
      expect(await readSettings(page), where).toEqual(settingsOf(twin.book, twin.today));
      const watch = watchChoices(page);

      const random = new Random(seed * 131);
      const done: string[] = [];
      for (let n = 0; n < 3; n += 1) {
        const descriptions = twin.book.reviewItems().flatMap((i) => ('description' in i ? [i.description] : []));
        const change = (random.int(0, 4) === 0 ? randomMove(random, twin.book.rules()) : null) ?? randomChange(random, twin.book.settings(), descriptions);
        const at = `${where}, change ${n + 1}: ${change.what}`;
        const posts = watch.posts.length;
        await make(page, change);
        done.push(change.what);
        // The same change, straight to the money math. A change it refuses (or
        // one that is already so) changes nothing on either.
        const id = watch.ids()[posts];
        if (change.move !== undefined) {
          twin.book.moveRule(change.move.id, change.move.direction, twin.today);
        } else if (change.rule !== undefined && id !== undefined) {
          twin.book.addRule({ ...change.rule, id: `rule-${id}` } as SortingRule, twin.today);
        } else if (change.patch !== null) {
          const current = twin.book.settings();
          const real = Object.fromEntries(Object.entries(change.patch).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(current[k as keyof Settings])));
          if (Object.keys(real).length > 0) twin.book.changeSettings(real, twin.today);
        }
        expect(life.book.settings(), at).toEqual(twin.book.settings());
        expect(life.book.rules(), at).toEqual(twin.book.rules());
        await expect.poll(async () => readSettings(page), { message: at }).toEqual(settingsOf(twin.book, twin.today));
      }

      // Everything else follows the twin too.
      expect(life.book.pots(), where).toEqual(twin.book.pots());
      expect(life.book.reviewItems(), where).toEqual(twin.book.reviewItems());
      expect(life.book.changeLog(), where).toEqual(twin.book.changeLog());
      expect(life.book.recountPots(), where).toEqual(life.book.pots());
      expect(life.book.selfCheck(life.bank).ok, `${where} after ${done.join('; ')}`).toBe(true);
      await page.getByTestId('tab-buckets').click();
      await page.getByTestId('buckets-total').waitFor();
      await expect.poll(async () => readBuckets(page), { message: where }).toEqual(bucketsOf(twin.book));
    } finally {
      await context.close();
      await close(live.server);
    }
  });
});
