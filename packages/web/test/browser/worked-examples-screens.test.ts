import { describe, expect, it } from 'vitest';
import { EXAMPLE_LIVES, checksOf } from '../worked-examples.js';
import { amountAt } from './activity-screens.js';
import { ENGINES, centsAt, openScenario, phone, useEngine } from './harness.js';

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
});
