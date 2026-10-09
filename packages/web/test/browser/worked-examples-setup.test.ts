import { describe, expect, it } from 'vitest';
import { checksOf } from '../worked-examples.js';
import { ENGINES, centsAt, phone, textAt, useEngine } from './harness.js';
import { answerHalf, openSetup, pickPaycheck, putTheRest, settled, typeAmount } from './setup-screens.js';

// Worked examples 18 and 19 (packages/web/worked-examples.txt), done on the
// Setup day screens as a person does them; each number read off the screen
// is compared with the Check lines worked out by hand.

describe.each(ENGINES)('worked examples on the Setup day screens, in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('example 18: setup day step by step, then Home, every number as worked out by hand', async () => {
    const checks = checksOf(18);
    const got = new Map<string, number>();
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-day', 'bank');
    got.set('bank side', await centsAt(page, 'bank-side'));
    got.set('old card debt', await centsAt(page, 'old-debt'));
    await page.getByTestId('next').click();
    await settled(page);
    for (const half of ['su-old-left', 'su-card-left', 'su-sav-landed']) await answerHalf(page, half, true);
    got.set('starting money', await centsAt(page, 'starting-money'));
    await page.getByTestId('next').click();
    expect(await pickPaycheck(page, '2026-10-02')).toBeNull();
    expect(await textAt(page, 'next-payday')).toBe('Fri, Oct 16');
    await page.getByTestId('next').click();
    await settled(page);
    expect(await typeAmount(page, 'savings', '8,000.00')).toBeNull();
    expect(await typeAmount(page, 'momReserve', '1,200.00')).toBeNull();
    expect(await typeAmount(page, 'wants', '400.00')).toBeNull();
    expect(await putTheRest(page, 'needs')).toBeNull();
    got.set('needs', await centsAt(page, 'assigned-needs'));
    got.set('left to assign', await centsAt(page, 'left-to-assign'));
    await page.getByTestId('next').click();
    await settled(page);
    await page.getByTestId('self-check-passes').waitFor();
    await page.getByTestId('start').click();
    await page.getByTestId('confirm-yes').click();
    await page.waitForURL(/\/home$/);
    await page.locator('main[data-testid="home"][aria-busy="false"]').waitFor();
    await settled(page);
    got.set('safe to spend', await centsAt(page, 'safe-to-spend'));
    got.set('still to move', await centsAt(page, 'move-amount'));
    got.set('days to payday', Number(/(\d+) days to payday/.exec(await textAt(page, 'home'))?.[1]));
    expect(await textAt(page, 'attention-still-to-set')).toContain('Still to set: the paycheck rule and the mom rule');
    expect(Object.fromEntries(got)).toEqual(Object.fromEntries(checks));
    await page.context().close();
  });

  it('example 19: below zero, typed with a minus sign, and Home after', async () => {
    const checks = checksOf(19);
    const got = new Map<string, number>();
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-owes-more', 'paycheck');
    expect(await pickPaycheck(page, '2026-10-02')).toBeNull();
    await page.getByTestId('next').click();
    await settled(page);
    got.set('starting money', await centsAt(page, 'starting-money'));
    expect(await typeAmount(page, 'savings', '150.00')).toBeNull();
    expect(await typeAmount(page, 'needs', '-1,500.00')).toBeNull();
    expect(await putTheRest(page, 'wants')).toBeNull();
    got.set('wants', await centsAt(page, 'assigned-wants'));
    got.set('left to assign', await centsAt(page, 'left-to-assign'));
    await page.getByTestId('next').click();
    await settled(page);
    await page.getByTestId('start').click();
    await page.getByTestId('confirm-yes').click();
    await page.waitForURL(/\/home$/);
    await page.locator('main[data-testid="home"][aria-busy="false"]').waitFor();
    await settled(page);
    expect(await page.getByTestId('safe-to-spend').innerText()).toBe('−$406.47');
    got.set('safe to spend', await centsAt(page, 'safe-to-spend'));
    expect(Object.fromEntries(got)).toEqual(Object.fromEntries(checks));
    await page.context().close();
  });
});
