import { describe, expect, it } from 'vitest';
import { EXAMPLE_LIVES, checksOf } from '../worked-examples.js';
import { amountAt } from './activity-screens.js';
import { ENGINES, centsAt, openScenario, phone, readCents, untilQuiet, useEngine } from './harness.js';
import { openSettings } from './settings-screens.js';

// Examples 12 to 14 in packages/web/worked-examples.txt, against what the
// screen shows a person for the same made-up life: what went in and out of
// Needs, moving money by hand, and Payday.

describe.each(ENGINES)('worked examples on the screen, the lists, moves and Payday, in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('example 12: the list of Needs shows every number worked out by hand, and has the 8 rows', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), EXAMPLE_LIVES[12] ?? '', '/buckets/needs');
    const testIds: Record<string, string> = { 'carried in': 'activity-opening', 'came in': 'activity-in', 'went out': 'activity-out', now: 'activity-closing' };
    for (const [label, expected] of checksOf(12)) {
      if (label === 'rows') {
        expect(await page.locator('.row[data-testid^="row-"]').count(), label).toBe(expected);
        continue;
      }
      const testId = testIds[label];
      if (testId === undefined) throw new Error(`example 12: no way to read "${label}" off the list`);
      expect(await amountAt(page, testId), label).toBe(expected);
    }
    // The gas station run is not on the list, and the refunded grocery run says so.
    expect(await page.getByText('CORNER GAS STATION').count()).toBe(0);
    expect(await page.getByText('Refunded $15.00').count()).toBe(1);
    await page.context().close();
  });

  it('example 13: the three steps, as a person takes them: one that asks nothing, one that asks and is told yes, one that asks and is told no', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), EXAMPLE_LIVES[13] ?? '', '/buckets');
    const move = async (from: string, to: string, amount: string): Promise<void> => {
      await page.getByTestId('move-open').click();
      await page.getByTestId('move-from').selectOption(from);
      await page.getByTestId('move-to').selectOption(to);
      await page.getByTestId('move-amount').fill(amount);
      await page.getByTestId('move-submit').click();
    };
    await move('wants', 'needs', '25.00');
    await page.getByTestId('notice').waitFor();
    await page.getByTestId('notice-dismiss').click();
    await move('savings', 'needs', '100.00');
    await page.getByTestId('move-confirm-title').waitFor();
    await page.getByTestId('move-confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    await page.getByTestId('notice-dismiss').click();
    await move('wants', 'needs', '700.00');
    await page.getByTestId('move-confirm-title').waitFor();
    expect(await page.getByTestId('move-confirm-ask').innerText()).toContain('would leave Wants below zero');
    await page.getByTestId('move-confirm-cancel').click();
    await page.keyboard.press('Escape');
    const checks = checksOf(13);
    await expect.poll(async () => centsAt(page, 'bucket-needs-left')).toBe(checks.get('needs'));
    expect(await centsAt(page, 'bucket-wants-left'), 'wants').toBe(checks.get('wants'));
    expect(await centsAt(page, 'savings'), 'savings').toBe(checks.get('savings'));
    expect(await centsAt(page, 'buckets-total'), 'total').toBe(checks.get('total'));
    await page.getByTestId('tab-home').click();
    await page.getByTestId('safe-to-spend').waitFor();
    await expect.poll(async () => centsAt(page, 'safe-to-spend')).toBe(checks.get('safe to spend'));
    await page.context().close();
  });

  it('example 15: the list of Needs shows the marked payment, and after picking Wants for it, the numbers worked out by hand', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), EXAMPLE_LIVES[15] ?? '', '/buckets/needs');
    const checks = checksOf(15);
    expect(await amountAt(page, 'activity-closing'), 'now').toBe(checks.get('now'));
    expect(await page.locator('.row[data-testid^="row-"]').count(), 'rows').toBe(checks.get('rows'));
    expect(await page.getByTestId('row-act-landlord').innerText()).toContain('Payment to the old card');
    await page.getByTestId('row-act-landlord').click();
    await page.getByTestId('activity-sheet').getByTestId('choice-wants').click();
    await page.getByTestId('notice').waitFor();
    await expect.poll(async () => amountAt(page, 'activity-closing'), { message: 'now after wants' }).toBe(checks.get('now after wants'));
    expect(await page.locator('.row[data-testid^="row-"]').count(), 'rows after wants').toBe(checks.get('rows after wants'));
    await page.context().close();
  });

  it('example 14: Payday shows every number worked out by hand', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), EXAMPLE_LIVES[14] ?? '', '/payday');
    const testIds: Record<string, string> = {
      paycheck: 'paycheck-amount',
      'reserve before': 'reserve-before',
      'into reserve': 'reserve-in',
      'did not fit': 'reserve-overflow',
      'to savings': 'got-savings',
      'to needs': 'got-needs',
      'to wants': 'got-wants',
      'still to move': 'savings-to-move',
      'needs spent': 'ended-needs-spent',
      'wants spent': 'ended-wants-spent',
      'sent to mom': 'ended-mom',
      'needs left': 'ended-needs-left',
      'wants left': 'ended-wants-left',
    };
    for (const [label, expected] of checksOf(14)) {
      if (label === 'needs asked' || label === 'wants asked') {
        const bucket = label.split(' ')[0];
        expect(await page.getByTestId(`item-leftover:demo-pay-2:${bucket}`).getByTestId('item-amount').innerText(), label).toBe(`$${(expected / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
        continue;
      }
      if (label === 'needs less since payday' || label === 'wants less since payday') {
        // The card says it in words, when something was taken off; nothing is said when not.
        const why = page.getByTestId(`item-leftover:demo-pay-2:${label.split(' ')[0]}`).getByTestId('leftover-why');
        if (expected === 0) {
          expect(await why.count(), label).toBe(0);
          continue;
        }
        const said = /less \$([\d,]+\.\d{2}) spent before payday and sorted since\.$/.exec(await why.innerText());
        expect(said, label).not.toBeNull();
        expect(Math.round(Number((said?.[1] ?? '').replaceAll(',', '')) * 100), label).toBe(expected);
        continue;
      }
      const testId = testIds[label];
      if (testId === undefined) throw new Error(`example 14: no way to read "${label}" off Payday`);
      expect(await amountAt(page, testId), label).toBe(expected);
    }
    await page.context().close();
  });

  it('example 16: Settings shows this pay period next to the next paycheck, the countdown, and the log, as worked out by hand', async () => {
    const page = await openSettings(await browser().newContext(phone()), base(), EXAMPLE_LIVES[16] ?? '');
    const checks = checksOf(16);
    const cell = async (testId: string): Promise<number> => readCents(await page.getByTestId(testId).locator('.compare__value').innerText());
    expect(await cell('split-reserve-first'), 'reserve this pay period').toBe(checks.get('reserve this pay period'));
    expect(await cell('split-reserve-second'), 'reserve from next paycheck').toBe(checks.get('reserve from next paycheck'));
    expect(await cell('split-cap-second'), 'cap').toBe(checks.get('cap'));
    expect(await centsAt(page, 'payoff-per-payday'), 'per payday').toBe(checks.get('per payday'));
    expect(await page.getByTestId('payoff-text').innerText()).toBe(`${checks.get('paydays')} paydays left before Jun 30, 2027`);
    expect(await page.getByTestId('log').locator('[data-testid^="log-"]').count(), 'log lines').toBe(checks.get('log lines'));
    for (const bucket of ['savings', 'needs'] as const) expect(await page.getByTestId(`split-${bucket}-second`).innerText()).toContain('Changes');
    await page.getByTestId('tab-buckets').click();
    await page.getByTestId('old-card-debt').waitFor();
    expect(await centsAt(page, 'old-card-debt'), 'owed').toBe(checks.get('owed'));
    await page.context().close();
  });

  it('example 17: setting the paycheck rule, then the mom rule, as a person does it, with the numbers worked out by hand', async () => {
    const page = await openSettings(await browser().newContext(phone()), base(), EXAMPLE_LIVES[17] ?? '');
    const checks = checksOf(17);
    await page.getByTestId('row-paycheck-rule').click();
    await page.getByTestId('field-paycheck-rule').fill('MADE UP EMPLOYER PAYROLL');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('preview').waitFor();
    for (const [label, testId] of [['after savings', 'preview-after-savings'], ['after needs', 'preview-after-needs'], ['after wants', 'preview-after-wants'], ['after mom reserve', 'preview-after-momReserve']] as const) {
      expect(await centsAt(page, testId), label).toBe(checks.get(label));
    }
    expect(Number(await page.getByTestId('preview-after-waiting').innerText()), 'waiting after').toBe(checks.get('waiting after'));
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    await untilQuiet(page);
    await page.getByTestId('notice-dismiss').click();
    await page.getByTestId('row-mom-rule').click();
    await page.getByTestId('field-mom-rule').fill('MADE UP MOM');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    await untilQuiet(page);
    await expect.poll(async () => page.getByTestId('review-badge').innerText(), { message: 'waiting after the mom rule' }).toBe(String(checks.get('waiting after the mom rule')));
    await page.getByTestId('tab-buckets').click();
    await page.getByTestId('mom-reserve').waitFor();
    await expect.poll(async () => centsAt(page, 'mom-reserve'), { message: 'mom reserve after the mom rule' }).toBe(checks.get('mom reserve after the mom rule'));
    await page.context().close();
  });
});
