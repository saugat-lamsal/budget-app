import { type BankBalances, type Book, type IsoDate, type Settings } from '@budget-app/money';
import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { MOM_NAME, appSide, openTestBook, payPerson, refund } from '../../../money/test/helpers.js';
import { ENGINES, centsAt, close, phone, readCents, textAt, untilQuiet, useEngine } from './harness.js';
import { openLive, startLive } from './live.js';
import { bucketsOf, readBuckets, watchChoices } from './screens.js';
import { openSettings, readSettings, settingsOf } from './settings-screens.js';

// The Settings screen, used in a browser like a person would (rulebook
// section 2; rules 13.1, 13.2, 13.5, 9.5; QUESTIONS.md A9). Every setting
// shown is compared with the book, and every change made on the screen with
// the same change given to a twin of the book directly.

interface Life {
  readonly book: Book;
  readonly bank: BankBalances | null;
  readonly today: IsoDate;
}

function life(name: string): Life {
  const input = demoScenario(name)?.input?.();
  if (input === undefined || input.book === null) throw new Error(`no made-up life called ${name}`);
  return { book: input.book, bank: input.bank, today: input.today };
}

// Opens a sheet from its row, fills the fields, and saves.
async function change(page: Page, row: string, fields: Readonly<Record<string, string>>): Promise<void> {
  await page.getByTestId(row).click();
  await page.getByTestId('settings-sheet').waitFor();
  for (const [testId, value] of Object.entries(fields)) {
    const field = page.getByTestId(testId);
    if ((await field.evaluate((e) => e.tagName)) === 'SELECT') await field.selectOption(value);
    else await field.fill(value);
  }
  await page.getByTestId('sheet-save').click();
}

async function saved(page: Page): Promise<string> {
  await page.getByTestId('notice').waitFor();
  // The words only, not the OK button beside them.
  const said = (await page.getByTestId('notice').locator('.notice__text').innerText()).replace(/\s+/g, ' ').trim();
  await untilQuiet(page);
  return said;
}

async function expectSameAs(page: Page, twin: Life, where: string): Promise<void> {
  await expect.poll(async () => readSettings(page), { message: where }).toEqual(settingsOf(twin.book, twin.today));
}

describe.each(ENGINES)('Settings in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it.each(['normal', 'settings-busy', 'settings-first-sync', 'big', 'payday-paid', 'mismatch', 'bank-not-read'])('0.2 13.1 9.5 every setting shown is the book\'s, in the life "%s"', async (name) => {
    const twin = life(name);
    const page = await openSettings(await browser().newContext(phone()), base(), name);
    expect(await readSettings(page)).toEqual(settingsOf(twin.book, twin.today));
    await page.context().close();
  });

  it('13.1 the busy life shows this pay period next to the next paycheck, and says which change, in words', async () => {
    const page = await openSettings(await browser().newContext(phone()), base(), 'settings-busy');
    const shown = await readSettings(page);
    expect(shown.split.savings).toEqual({ now: '50%', next: '40%', changes: true });
    expect(shown.split.wants).toEqual({ now: '20%', next: '20%', changes: false });
    expect(shown.reserve).toEqual({ now: 150_000, next: 125_000, changes: true });
    expect(await page.getByTestId('split-savings-second').innerText()).toContain('Changes');
    expect(await page.getByTestId('split-wants-second').innerText()).not.toContain('Changes');
    expect(await textAt(page, 'split-note')).toBe('Your changes start at your next paycheck, Fri, Oct 16. This pay period keeps what it started with.');
    await page.context().close();
  });

  it('13.1 0.3 a new split: the setting changes now, this pay period keeps its split, and no bucket moves', async () => {
    const twin = life('normal');
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    const watch = watchChoices(page);
    await change(page, 'row-split', { 'field-savings': '40', 'field-needs': '40', 'field-wants': '20' });
    expect(await saved(page)).toBe('Saved. It starts at your next paycheck, Fri, Oct 16.');
    expect(JSON.parse(watch.posts[0]?.postData() ?? '{}')).toEqual({ id: watch.ids()[0], settings: { split: { savings: 40, needs: 40, wants: 20 } } });
    twin.book.changeSettings({ split: { savings: 40, needs: 40, wants: 20 } }, twin.today);
    await expectSameAs(page, twin, 'after the split');
    expect((await readSettings(page)).split.needs).toEqual({ now: '30%', next: '40%', changes: true });
    // Nothing moved (13.1, 0.3).
    await page.getByTestId('tab-buckets').click();
    await page.getByTestId('buckets-total').waitFor();
    expect(await readBuckets(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('13.1 the mom reserve and its cap, in dollars and cents, become whole cents', async () => {
    const twin = life('normal');
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    const watch = watchChoices(page);
    await change(page, 'row-reserve', { 'field-reserve': '1,250.01', 'field-cap': '2999.99' });
    await saved(page);
    expect(JSON.parse(watch.posts[0]?.postData() ?? '{}').settings).toEqual({ momReservePerPaycheck: 125_001, momReserveCap: 299_999 });
    twin.book.changeSettings({ momReservePerPaycheck: 125_001, momReserveCap: 299_999 }, twin.today);
    await expectSameAs(page, twin, 'after the reserve');
    await page.context().close();
  });

  // Each of the other settings in section 2, from its own sheet.
  const EACH: readonly (readonly [string, string, Readonly<Record<string, string>>, Partial<Settings>])[] = [
    ['the mom monthly target', 'row-target', { 'field-target-low': '1,800.00', 'field-target-high': '2,800.50' }, { momMonthlyTarget: { low: 180_000, high: 280_050 } }],
    ['the low-bucket alert', 'row-low-alert', { 'field-low-alert': '35' }, { lowBucketAlertPercent: 35 }],
    ['the card reminder days', 'row-reminders', { 'field-reminders': '10, 5 1' }, { cardReminderDaysBefore: [10, 5, 1] }],
    ['no card reminders at all', 'row-reminders', { 'field-reminders': '' }, { cardReminderDaysBefore: [] }],
    ['the daily review time', 'row-review-time', { 'field-review-time': '07:45' }, { dailyReviewTime: '07:45' }],
    ['the home time zone', 'row-time-zone', { 'field-time-zone': 'America/Chicago' }, { homeTimeZone: 'America/Chicago' }],
    ['10.8 quiet hours', 'row-quiet-hours', { 'field-quiet-from': '23:00', 'field-quiet-to': '06:30' }, { quietHours: { from: '23:00', to: '06:30' } }],
    ['10.8 no quiet hours, the same time twice', 'row-quiet-hours', { 'field-quiet-from': '07:00', 'field-quiet-to': '07:00' }, { quietHours: { from: '07:00', to: '07:00' } }],
    ['10.7 the bank-not-read alert', 'row-not-read', { 'field-not-read': '36' }, { bankNotReadAlertHours: 36 }],
    ['10.10 amounts on the lock screen', 'row-lock-amounts', { 'field-lock-amounts': 'on' }, { amountsOnLockScreen: true }],
    ['the leftover at payday, each bucket on its own', 'row-leftover', { 'field-leftover-needs': 'roll-over', 'field-leftover-wants': 'move-to-savings' }, { leftoverAtPayday: { needs: 'roll-over', wants: 'move-to-savings' } }],
    ['the pay schedule', 'row-pay-schedule', { 'field-pay-schedule': '7' }, { payScheduleDays: 7 }],
    ['the 10 days of rule 3.7', 'row-early-days', { 'field-early-days': '12' }, { earlyPaycheckDays: 12 }],
  ];
  it.each(EACH)('0.2 %s, and the screen then shows what the twin has', async (_what, row, fields, patch) => {
    const twin = life('normal');
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    const watch = watchChoices(page);
    await change(page, row, fields);
    expect(await saved(page)).toBe('Saved.');
    expect(JSON.parse(watch.posts[0]?.postData() ?? '{}').settings).toEqual(patch);
    twin.book.changeSettings(patch, twin.today);
    await expectSameAs(page, twin, row);
    await page.context().close();
  });

  it('11.2 a new pay schedule moves the next payday on Home at once', async () => {
    const twin = life('normal');
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    await change(page, 'row-pay-schedule', { 'field-pay-schedule': '7' });
    await saved(page);
    twin.book.changeSettings({ payScheduleDays: 7 }, twin.today);
    expect(await textAt(page, 'value-pay-schedule')).toBe('Every 7 days');
    await page.getByTestId('tab-home').click();
    await page.getByTestId('safe-to-spend').waitFor();
    const days = twin.book.safeToSpend(twin.today).daysToPayday;
    await expect.poll(async () => textAt(page, 'payday')).toContain(String(Math.abs(days)));
    await page.context().close();
  });

  it('0.2 a setting the money math refuses changes nothing and says why, in the sheet', async () => {
    const twin = life('normal');
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    await change(page, 'row-split', { 'field-savings': '50', 'field-needs': '40', 'field-wants': '30' });
    await page.getByTestId('sheet-problem').waitFor();
    expect(await textAt(page, 'sheet-problem')).toBe('Split must add up to 100, not 120. Nothing was changed.');
    await page.keyboard.press('Escape');
    await change(page, 'row-target', { 'field-target-low': '3,000.00', 'field-target-high': '2,000.00' });
    await page.getByTestId('sheet-problem').waitFor();
    expect(await textAt(page, 'sheet-problem')).toBe('Mom monthly target low end must not be above the high end. Nothing was changed.');
    await page.keyboard.press('Escape');
    expect(await readSettings(page)).toEqual(settingsOf(twin.book, twin.today));
    await page.context().close();
  });

  it('0.1 what cannot be read as whole numbers or dollars and cents is said, and Save waits', async () => {
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    const watch = watchChoices(page);
    await page.getByTestId('row-split').click();
    await page.getByTestId('field-savings').fill('50.5');
    expect(await textAt(page, 'sheet-reading')).toBe('Enter whole numbers, like 30');
    expect(await page.getByTestId('sheet-save').isDisabled()).toBe(true);
    await page.keyboard.press('Escape');
    await page.getByTestId('row-reserve').click();
    await page.getByTestId('field-reserve').fill('1500.5');
    expect(await textAt(page, 'sheet-reading')).toBe('Enter amounts like 1,500.00');
    expect(await page.getByTestId('sheet-save').isDisabled()).toBe(true);
    expect(watch.posts.length).toBe(0);
    await page.context().close();
  });

  it('B101 saving a setting as it already is changes nothing, logs nothing, and says so', async () => {
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    await page.getByTestId('row-low-alert').click();
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('sheet-problem').waitFor();
    expect(await textAt(page, 'sheet-problem')).toBe('That is already the setting. Nothing was changed.');
    await page.keyboard.press('Escape');
    expect((await readSettings(page)).log).toEqual([]);
    await page.context().close();
  });

  it('A9 13.2 the paycheck rule asks first, shows what it would do from the money math, and with his yes does exactly that', async () => {
    const twin = life('settings-first-sync');
    const page = await openSettings(await browser().newContext(phone()), base(), 'settings-first-sync');
    const watch = watchChoices(page);
    await change(page, 'row-paycheck-rule', { 'field-paycheck-rule': '  MADE UP EMPLOYER PAYROLL ' });
    await page.getByTestId('preview').waitFor();
    expect(await textAt(page, 'confirm-ask')).toBe('Setting the paycheck rule sorts what is waiting for good, so it needs your OK first. Nothing was changed.');
    const patch = { paycheckRule: { contains: 'MADE UP EMPLOYER PAYROLL' } };
    const preview = twin.book.previewSettingsChange(patch, twin.today);
    // What it would do, item by item, and every bucket after, as the money math has it.
    expect(await page.locator('[data-testid^="preview-item-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual(preview.items.map((i) => `preview-item-${i.id}`));
    expect(await textAt(page, 'preview-item-demo-pay')).toContain('Becomes your paycheck');
    for (const pot of ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers'] as const) expect(await centsAt(page, `preview-after-${pot}`), pot).toBe(preview.potsAfter[pot]);
    expect(Number(await textAt(page, 'preview-after-waiting'))).toBe(preview.waitingAfter);
    // Nothing has changed yet.
    await page.getByTestId('confirm-cancel').click();
    await page.keyboard.press('Escape');
    expect(await readSettings(page)).toEqual(settingsOf(twin.book, twin.today));
    // Again, and yes.
    await change(page, 'row-paycheck-rule', { 'field-paycheck-rule': 'MADE UP EMPLOYER PAYROLL' });
    await page.getByTestId('confirm-yes').click();
    expect(await saved(page)).toBe('Saved. A deposit that was waiting is now your paycheck.');
    twin.book.changeSettings(patch, twin.today);
    await expectSameAs(page, twin, 'after the paycheck rule');
    // The yes carried the preview he saw, and the same decision number as the question.
    const sent = watch.posts.map((p) => JSON.parse(p.postData() ?? '{}') as { id: string; confirmed?: boolean; seen?: string });
    expect(sent.at(-1)).toMatchObject({ confirmed: true, seen: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(sent.at(-1)?.id).toBe(sent.at(-2)?.id);
    // Review and Buckets follow the book.
    await page.getByTestId('tab-buckets').click();
    await page.getByTestId('buckets-total').waitFor();
    await expect.poll(async () => readBuckets(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('A9 8.1 the mom rule asks first too, and says what the reserve covers', async () => {
    const twin = life('settings-first-sync');
    const page = await openSettings(await browser().newContext(phone()), base(), 'settings-first-sync');
    await change(page, 'row-mom-rule', { 'field-mom-rule': 'MADE UP MOM' });
    await page.getByTestId('preview').waitFor();
    expect(await textAt(page, 'preview-item-demo-mom')).toContain('Comes out of the mom reserve.');
    await page.getByTestId('confirm-yes').click();
    expect(await saved(page)).toBe('Saved. A payment that was waiting came out of the mom reserve.');
    twin.book.changeSettings({ momRule: { contains: 'MADE UP MOM' } }, twin.today);
    await expectSameAs(page, twin, 'after the mom rule');
    await page.context().close();
  });

  it('A9 clearing the paycheck rule asks first, and nothing waiting changes', async () => {
    const twin = life('normal');
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    await page.getByTestId('row-paycheck-rule').click();
    await page.getByTestId('sheet-clear').click();
    await page.getByTestId('preview-none').waitFor();
    expect(await textAt(page, 'confirm-ask')).toBe('Clearing the paycheck rule needs your OK first: paychecks will wait in review until you set it again. Nothing was changed.');
    expect(await textAt(page, 'confirm-yes')).toBe('Yes, clear it');
    await page.getByTestId('confirm-yes').click();
    await saved(page);
    twin.book.changeSettings({ paycheckRule: null }, twin.today);
    await expectSameAs(page, twin, 'after clearing');
    expect(await textAt(page, 'value-paycheck-rule')).toBe('Not set');
    await page.context().close();
  });

  it('9.5 a promo end date turns the payoff countdown on, with the money math\'s amount; clearing it turns it off', async () => {
    const twin = life('normal');
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    expect(await textAt(page, 'payoff-text')).toBe('Off until you enter the promo end date');
    await change(page, 'row-promo', { 'field-promo': '2027-04-30' });
    await saved(page);
    twin.book.changeSettings({ oldCardPromoEndDate: '2027-04-30' }, twin.today);
    await expectSameAs(page, twin, 'with the date');
    expect(await textAt(page, 'value-promo')).toBe('Apr 30, 2027');
    expect(await textAt(page, 'payoff-text')).toMatch(/^\d+ paydays left before Apr 30, 2027$/);
    await page.getByTestId('row-promo').click();
    await page.getByTestId('sheet-clear').click();
    await saved(page);
    twin.book.changeSettings({ oldCardPromoEndDate: null }, twin.today);
    await expectSameAs(page, twin, 'cleared');
    expect(await textAt(page, 'payoff-text')).toBe('Off until you enter the promo end date');
    await page.context().close();
  });

  it('13.2 a new rule goes to the end of its list and sorts what waits in Review that it matches', async () => {
    const twin = life('normal');
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    const watch = watchChoices(page);
    await change(page, 'row-add-rule', { 'field-rule-kind': 'purchase', 'field-rule-text': 'corner store', 'field-rule-to': 'wants' });
    expect(await saved(page)).toBe('Rule added: “corner store” → Wants. It sorted 1 item that was waiting.');
    const id = watch.ids()[0];
    twin.book.addRule({ id: `rule-${id}`, for: 'purchase', contains: 'corner store', bucket: 'wants' }, twin.today);
    await expectSameAs(page, twin, 'after the new rule');
    expect((await readSettings(page)).rules.purchase.at(-1)).toBe(`6. rule-${id}: Wants`);
    expect(await page.getByTestId('review-badge').innerText()).toBe(String(twin.book.reviewItems().length));
    await page.context().close();
  });

  it('6.2 7.4 a rule for money in and one for a person offer only what those rules can pick', async () => {
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    await page.getByTestId('row-add-rule').click();
    await page.getByTestId('field-rule-to').waitFor();
    const options = async (): Promise<string[]> => page.getByTestId('field-rule-to').locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    expect(await options()).toEqual(['needs', 'wants']);
    await page.getByTestId('field-rule-kind').selectOption('deposit');
    expect(await options()).toEqual(['other-income', 'savings', 'needs', 'wants', 'momReserve', 'not-mine']);
    await page.getByTestId('field-rule-kind').selectOption('person');
    expect(await options()).toEqual(['needs', 'wants', 'not-mine', 'mom']);
    await page.context().close();
  });

  it('13.2 changing a rule keeps its place; removing one asks first, and Cancel keeps it', async () => {
    const twin = life('normal');
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    await page.getByTestId('rule-coffee').click();
    await page.getByTestId('field-rule-to').selectOption('needs');
    await page.getByTestId('sheet-save').click();
    expect(await saved(page)).toBe('Rule changed: “COFFEE” → Needs.');
    twin.book.changeRule({ id: 'coffee', for: 'purchase', contains: 'COFFEE', bucket: 'needs' }, twin.today);
    await expectSameAs(page, twin, 'after the change');
    await page.getByTestId('notice-dismiss').click();
    await page.getByTestId('rule-streaming').click();
    await page.getByTestId('sheet-remove').click();
    await page.getByTestId('confirm-yes').waitFor();
    expect(await textAt(page, 'confirm-ask')).toBe('Removing the rule "STREAMING" needs your OK first. What it already sorted stays where it is. Nothing was changed.');
    await page.getByTestId('confirm-cancel').click();
    await page.keyboard.press('Escape');
    await expectSameAs(page, twin, 'after cancel');
    await page.getByTestId('rule-streaming').click();
    await page.getByTestId('sheet-remove').click();
    await page.getByTestId('confirm-yes').click();
    expect(await saved(page)).toBe('Rule removed: “STREAMING” → Wants. What it sorted stays where it is.');
    twin.book.removeRule('streaming', twin.today);
    await expectSameAs(page, twin, 'after removing');
    await page.context().close();
  });

  it('13.5 the change log shows every change, newest first, with its date', async () => {
    const twin = life('settings-busy');
    const page = await openSettings(await browser().newContext(phone()), base(), 'settings-busy');
    const shown = await readSettings(page);
    expect(shown.log).toEqual(settingsOf(twin.book, twin.today).log);
    expect(shown.log.length).toBeGreaterThanOrEqual(12);
    const first = await textAt(page, shown.log[0] ?? '');
    expect(first).toContain('Split');
    expect(first).toContain('50 / 30 / 20 → 40 / 40 / 20');
    expect(first).toContain('Wed, Oct 7');
    expect(first).toContain('from the next paycheck');
    expect(await page.getByTestId('log').innerText()).toContain('Rule added from a correction');
    expect(await page.getByTestId('log').innerText()).toContain('ahead of “RESTAURANT” → Wants');
    expect(await page.getByTestId('log').innerText()).toContain('The bank took back MAIN ST RESTAURANT');
    // A change made now is the first line.
    await change(page, 'row-low-alert', { 'field-low-alert': '30' });
    await saved(page);
    await expect.poll(async () => textAt(page, (await readSettings(page)).log[0] ?? '')).toContain('25% → 30%');
    await page.context().close();
  });

  it('13.5 with nothing changed, the log says so', async () => {
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    expect(await textAt(page, 'log-empty')).toContain('Nothing changed yet');
    await page.context().close();
  });

  it('B92 a double tap on Save sends one decision', async () => {
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    const watch = watchChoices(page);
    await page.getByTestId('row-low-alert').click();
    await page.getByTestId('field-low-alert').fill('30');
    await page.getByTestId('sheet-save').dblclick();
    await saved(page);
    expect(new Set(watch.ids()).size).toBe(1);
    expect((await readSettings(page)).log).toHaveLength(1);
    await page.context().close();
  });

  it('section 14 before setup day there are no settings to show, and it says so', async () => {
    const page = await openSettings(await browser().newContext(phone()), base(), 'not-set-up');
    expect(await textAt(page, 'settings-not-set-up')).toContain('No settings yet');
    await page.context().close();
  });

  it('0.5 the "totals do not match the bank" banner is on Settings too', async () => {
    const page = await openSettings(await browser().newContext(phone()), base(), 'mismatch');
    expect(await page.getByTestId('mismatch').isVisible()).toBe(true);
    expect(readCents(await textAt(page, 'mismatch-amount'))).toBe(1_234);
    await page.context().close();
  });

  it('13.2 A9 B73 a partly refunded payment to mom stays waiting, and the screen says so before and after the yes', async () => {
    const book = openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 100_000 }, settings: { momRule: null } });
    book.receive(payPerson('z1', '2026-10-10', 4_000, MOM_NAME));
    book.receive(refund('r1', '2026-10-11', 1_000, 'z1', 'checking'));
    const bank = { checking: appSide(book.pots()) - book.inTransit().total, savings: 0, everydayCard: 0 };
    const pots = book.pots();
    const live = await startLive({ book, bank, today: '2026-10-12' });
    const context = await browser().newContext(phone());
    try {
      const page = await openLive(context, live.base, '/settings');
      await change(page, 'row-mom-rule', { 'field-mom-rule': MOM_NAME });
      await page.getByTestId('preview').waitFor();
      expect(await textAt(page, 'preview-item-z1')).toContain('Still waits in Review: part of it was refunded, so it cannot come out of the mom reserve.');
      expect(readCents(await page.getByTestId('preview-item-z1').locator('[data-money]').last().innerText())).toBe(3_000);
      expect(await centsAt(page, 'preview-after-momReserve')).toBe(100_000);
      await page.getByTestId('confirm-yes').click();
      expect(await saved(page)).toBe(`Saved. ZELLE TO ${MOM_NAME} still waits in Review: part of it was refunded, so it cannot come out of the mom reserve.`);
      // Exactly as it was: the $30.00 waits, the reserve and every bucket are as they were.
      expect(book.reviewItems().map((i) => [i.id, i.amount])).toEqual([['z1', 3_000]]);
      expect(book.pots()).toEqual(pots);
      expect(book.recountPots()).toEqual(pots);
      expect(await page.getByTestId('review-badge').innerText()).toBe('1');
    } finally {
      await context.close();
      await close(live.server);
    }
  });

  it('13.2 A22 a rule moves up or down in its list from its sheet, the screen shows the new order, and the log says so', async () => {
    const twin = life('normal');
    const page = await openSettings(await browser().newContext(phone()), base(), 'normal');
    // The first rule cannot move up and the last cannot move down: those buttons are not there.
    await page.getByTestId('rule-grocery').click();
    expect(await page.getByTestId('sheet-move-up').count()).toBe(0);
    expect(await page.getByTestId('sheet-move-down').count()).toBe(1);
    await page.keyboard.press('Escape');
    await page.getByTestId('rule-streaming').click();
    expect(await page.getByTestId('sheet-move-down').count()).toBe(0);
    await page.keyboard.press('Escape');
    // RESTAURANT goes up past COFFEE.
    await page.getByTestId('rule-restaurant').click();
    await page.getByTestId('sheet-move-up').click();
    expect(await saved(page)).toBe('Rule moved up: “RESTAURANT” → Wants.');
    twin.book.moveRule('restaurant', 'up', twin.today);
    await expectSameAs(page, twin, 'after moving up');
    expect((await readSettings(page)).rules.purchase.slice(2, 4)).toEqual(['3. restaurant: Wants', '4. coffee: Wants']);
    expect(await textAt(page, 'log-0-0')).toContain('Rule moved up');
    expect(await textAt(page, 'log-0-0')).toContain('“RESTAURANT” → Wants, now number 3, ahead of “COFFEE” → Wants');
    // And down again.
    await page.getByTestId('notice-dismiss').click();
    await page.getByTestId('rule-restaurant').click();
    await page.getByTestId('sheet-move-down').click();
    expect(await saved(page)).toBe('Rule moved down: “RESTAURANT” → Wants.');
    twin.book.moveRule('restaurant', 'down', twin.today);
    await expectSameAs(page, twin, 'after moving down');
    await page.context().close();
  });
});
