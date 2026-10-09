import { formatDollars, type Pot } from '@budget-app/money';
import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { ENGINES, centsAt, openScenario, phone, readCents, textAt, useEngine } from './harness.js';
import { watchChoices } from './screens.js';
import { answerHalf, openSetup, pickPaycheck, putTheRest, readAssign, ready, settled, tell, twinOf, typeAmount } from './setup-screens.js';

// Setup day (rulebook section 14, with A10, B42, B43, B48), used in a
// browser like a person would. Every number shown is compared with a twin of
// the life's setup desk, given the same answers directly: the money math's
// numbers. Every name and number is made up.

describe.each(ENGINES)('Setup day in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it.each(['setup-day', 'setup-owes-more'])('14.1 12.4 A10 every number on "What the bank shows" is the money math\'s, in the life "%s"', async (life) => {
    const v = ready(twinOf(life));
    const page = await openSetup(await browser().newContext(phone()), base(), life, 'bank');
    for (const [testId, line] of [
      ['checking', v.checking],
      ['savings', v.savings],
      ['everyday-card', v.everydayCard],
    ] as const) {
      expect(await centsAt(page, `${testId}-posted`), testId).toBe(line.posted);
      expect(await centsAt(page, `${testId}-counts`), testId).toBe(line.withPending);
      if (line.pending > 0) expect(await centsAt(page, `${testId}-pending`), testId).toBe(line.pending);
      else expect(await textAt(page, `${testId}-detail`), testId).toContain('nothing pending');
    }
    expect(await centsAt(page, 'bank-side')).toBe(v.bankSide);
    expect(await centsAt(page, 'bank-side-total')).toBe(v.bankSide);
    expect(await centsAt(page, 'old-posted')).toBe(v.oldCard.posted);
    expect(await centsAt(page, 'old-pending')).toBe(v.oldCard.pending);
    expect(await centsAt(page, 'old-debt')).toBe(v.oldCard.debt);
    for (const charge of v.pendingCharges) expect(await centsAt(page, `pending-${charge.id}`), charge.id).toBe(charge.amount);
    if (v.pendingCharges.length === 0) expect(await textAt(page, 'pending-none')).toBe('Nothing is pending.');
    await page.context().close();
  });

  it('B43 a starting money below zero is shown with a minus sign, in words too', async () => {
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-owes-more', 'bank');
    expect(await page.getByTestId('bank-side').innerText()).toBe('−$1,756.47');
    expect(await page.getByTestId('bank-side').getAttribute('aria-label')).toMatch(/minus/);
    await page.context().close();
  });

  it('B48 each answer moves the starting money by what the money math says, and says so in words', async () => {
    const twin = twinOf('setup-day');
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-day', 'transfers');
    expect(await centsAt(page, 'starting-money')).toBe(ready(twin).startingMoney);
    expect(await textAt(page, 'setup-hero')).toContain('3 still to answer');
    for (const half of ready(twin).halves) {
      const card = page.getByTestId(`half-${half.id}`);
      expect(await card.getByTestId('answer').innerText()).toBe('Not answered yet');
      if (half.effect === 0) expect(await card.getByTestId('effect').innerText()).toMatch(/doesn't change the starting money/);
      else expect(readCents((await card.getByTestId('effect-amount').innerText()).replace('+', ''))).toBe(half.effect);
      expect(await card.getByTestId('rule').innerText()).toContain(half.rule?.contains ?? 'No bank rule');
      await answerHalf(page, half.id, true);
      tell(twin, { onItsWay: { half: half.id, answer: true } });
      expect(await centsAt(page, 'starting-money'), half.id).toBe(ready(twin).startingMoney);
    }
    expect(await textAt(page, 'setup-hero')).toContain('Every transfer is answered');
    // He changes his mind about one.
    await answerHalf(page, 'su-card-left', false);
    tell(twin, { onItsWay: { half: 'su-card-left', answer: false } });
    expect(await centsAt(page, 'starting-money')).toBe(ready(twin).startingMoney);
    await page.context().close();
  });

  it('B48 with nothing on its way, the step says so', async () => {
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-owes-more', 'transfers');
    expect(await textAt(page, 'transfers-none')).toContain('Nothing on its way');
    await page.context().close();
  });

  it('B42 the last paycheck: after today is refused in words and nothing changes; a real day shows the next payday', async () => {
    const twin = twinOf('setup-day');
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-day', 'paycheck');
    expect(await textAt(page, 'last-paycheck')).toContain('Not entered yet');
    expect(await pickPaycheck(page, '2026-10-08')).toBe("Your last paycheck can't be after today: that paycheck has not come yet. Nothing was changed.");
    await page.getByTestId('date-sheet').getByRole('button', { name: 'Close' }).click();
    expect(await textAt(page, 'last-paycheck')).toContain('Not entered yet');
    expect(await pickPaycheck(page, '2026-10-02')).toBeNull();
    tell(twin, { lastPaycheck: '2026-10-02' });
    const last = ready(twin).lastPaycheck;
    expect(await textAt(page, 'last-paycheck')).toContain('Oct 2, 2026');
    expect(await textAt(page, 'next-payday')).toBe('Fri, Oct 16');
    expect(last).toMatchObject({ nextPayday: '2026-10-16', daysToPayday: 9 });
    expect(await textAt(page, 'setup-hero')).toContain('9 days to payday');
    await page.context().close();
  });

  it('14.2 after each amount, what is left to assign is the money math\'s: one cent under, one cent over, then exact', async () => {
    const twin = twinOf('setup-day');
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-day', 'assign');
    const money = ready(twin).startingMoney;
    expect(await readAssign(page)).toMatchObject({ left: money, assigned: 0, startingMoney: money });
    const steps: [Pot, string, number][] = [
      ['savings', '8,000.00', 800_000],
      ['momReserve', '1200', 120_000],
      ['needs', '$404.09', 40_409],
      ['needs', '404.11', 40_411],
      ['needs', '404.10', 40_410],
    ];
    for (const [pot, typed, cents] of steps) {
      expect(await typeAmount(page, pot, typed), typed).toBeNull();
      tell(twin, { assign: { pot, amount: cents } });
      const v = ready(twin);
      expect(await readAssign(page), typed).toEqual({ left: v.leftToAssign, assigned: v.assigned, startingMoney: v.startingMoney, pots: v.assignment });
    }
    // 10,404.10 - 8,000.00 - 1,200.00 - 404.10 = 800.00 still to hand out.
    expect(ready(twin).leftToAssign).toBe(80_000);
    expect(await textAt(page, 'setup-hero')).toContain('Still to hand out');
    // Too much: the words say so, not only the minus sign.
    expect(await typeAmount(page, 'wants', '800.01')).toBeNull();
    expect(await page.getByTestId('left-to-assign').innerText()).toBe('−$0.01');
    expect(await textAt(page, 'setup-hero')).toContain('More is handed out than there is');
    // The rest, worked out by the money math: wants takes the cent back.
    expect(await putTheRest(page, 'wants')).toBeNull();
    expect(await centsAt(page, 'assigned-wants')).toBe(80_000);
    expect(await centsAt(page, 'left-to-assign')).toBe(0);
    expect(await textAt(page, 'setup-hero')).toContain('All of it is handed out');
    await page.context().close();
  });

  it('B43 below zero is typed with a minus sign, and the rest can be below zero too', async () => {
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-owes-more', 'assign');
    expect(await typeAmount(page, 'savings', '150.00')).toBeNull();
    expect(await typeAmount(page, 'needs', '-1,500.00')).toBeNull();
    expect(await putTheRest(page, 'wants')).toBeNull();
    expect(await page.getByTestId('assigned-wants').innerText()).toBe('−$406.47');
    expect(await centsAt(page, 'left-to-assign')).toBe(0);
    // The minus sign the app itself shows can be typed back too.
    expect(await typeAmount(page, 'wants', '−406.46')).toBeNull();
    expect(await page.getByTestId('left-to-assign').innerText()).toBe('−$0.01');
    await page.context().close();
  });

  it('14.2 an amount that cannot be read is said on the sheet, and Save waits', async () => {
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-day', 'assign');
    await page.getByTestId('assign-needs').click();
    await page.getByTestId('amount').fill('12.5');
    expect(await textAt(page, 'sheet-reading')).toBe('Enter an amount like 1,500.00');
    expect(await page.getByTestId('sheet-save').isDisabled()).toBe(true);
    await page.context().close();
  });

  it('14.3 refused one cent short in the server\'s words; it asks first; Cancel changes nothing; yes starts and Home shows the money math\'s numbers', async () => {
    const twin = twinOf('setup-day');
    const context = await browser().newContext(phone());
    const page = await openSetup(context, base(), 'setup-day', 'transfers');
    for (const half of ready(twin).halves) {
      await answerHalf(page, half.id, true);
      tell(twin, { onItsWay: { half: half.id, answer: true } });
    }
    await page.getByTestId('next').click();
    expect(await pickPaycheck(page, '2026-10-02')).toBeNull();
    tell(twin, { lastPaycheck: '2026-10-02' });
    await page.getByTestId('next').click();
    const money = ready(twin).startingMoney;
    expect(await typeAmount(page, 'savings', '8,000.00')).toBeNull();
    tell(twin, { assign: { pot: 'savings', amount: 800_000 } });
    const short = money - 800_000 - 1;
    expect(await typeAmount(page, 'needs', formatDollars(short).replace('$', ''))).toBeNull();
    tell(twin, { assign: { pot: 'needs', amount: short } });
    await page.getByTestId('next').click();
    await settled(page);
    expect(await centsAt(page, 'starting-money')).toBe(money);
    expect(await textAt(page, 'missing')).toContain('Hand out the starting money to the cent. Left to assign: $0.01.');
    const posts = watchChoices(page);
    await page.getByTestId('start').click();
    await page.getByTestId('setup-problem').waitFor();
    expect(await textAt(page, 'setup-problem')).toBe('$0.01 is still to assign. Nothing was changed.');
    expect(posts.posts.length).toBe(1);
    // Fixed: the last look says the self-check passes, with the money math's numbers.
    await page.getByTestId('back').click();
    expect(await putTheRest(page, 'needs')).toBeNull();
    tell(twin, { assign: { pot: 'needs', rest: true } });
    await page.getByTestId('next').click();
    await settled(page);
    const check = ready(twin).selfCheck;
    expect(check).toMatchObject({ ok: true, difference: 0 });
    expect(await centsAt(page, 'check-bank')).toBe(check?.bankSide);
    expect(await centsAt(page, 'check-transit')).toBe(check?.inTransit);
    expect(await centsAt(page, 'check-app')).toBe(check?.appSide);
    expect(await centsAt(page, 'check-difference')).toBe(0);
    for (const pot of ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers'] as const) expect(await centsAt(page, `check-${pot}`), pot).toBe(ready(twin).assignment[pot]);
    expect(await centsAt(page, 'check-old-debt')).toBe(ready(twin).oldCard.debt);
    // It asks first, and Cancel changes nothing.
    await page.getByTestId('start').click();
    await page.getByTestId('confirm-yes').waitFor();
    expect(await textAt(page, 'confirm-ask')).toContain('final');
    await page.getByTestId('confirm-cancel').click();
    await settled(page);
    expect(await homeState(page)).toBe('not-set-up');
    // Yes: tracking starts, and Home shows.
    await page.getByTestId('start').click();
    await page.getByTestId('confirm-yes').click();
    await page.waitForURL(/\/home$/);
    await page.locator('main[data-testid="home"][aria-busy="false"]').waitFor();
    await settled(page);
    expect(tell(twin, { start: true }, { confirmed: true, seen: ready(twin).key }).ok).toBe(true);
    const book = twin.started()?.book;
    if (book === undefined) throw new Error('the twin did not start');
    expect(await centsAt(page, 'safe-to-spend')).toBe(book.safeToSpend('2026-10-07').amount);
    expect(await textAt(page, 'attention-still-to-set')).toBe('Still to set: the paycheck rule and the mom rule Until then your paycheck and payments to mom wait in Review. Set them in Settings.');
    expect(await page.getByTestId('attention-still-to-set').getAttribute('href')).toBe('/settings');
    // Setting up twice: the setup screens say it is done.
    await page.goto(`${base()}/setup/check`);
    await page.getByTestId('setup-done').waitFor();
    await settled(page);
    await context.close();
  });

  it('B92 a quick double tap on an answer sends it once', async () => {
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-day', 'transfers');
    const posts = watchChoices(page);
    await page.getByTestId('half-su-card-left').getByTestId('on-its-way').dblclick();
    await page.getByTestId('half-su-card-left').getByTestId('answer').filter({ hasText: 'on its way' }).waitFor();
    await settled(page);
    expect(posts.posts.length).toBe(1);
    await page.context().close();
  });

  it('B92 an answer whose reply was lost is sent again with the same decision number, and counts once', async () => {
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-day', 'assign');
    const posts = watchChoices(page);
    // The first try reaches the server, but its answer never comes back.
    let lost = false;
    await page.route('**/api/choice', async (route) => {
      if (lost) return route.continue();
      lost = true;
      await route.fetch();
      await route.abort('failed');
    });
    await page.getByTestId('assign-savings').click();
    await page.getByTestId('amount').fill('100.00');
    await page.getByTestId('sheet-save').click();
    await page.locator('dialog[open] [data-testid="sheet-problem"]').waitFor();
    expect(await textAt(page, 'sheet-problem')).toContain("Couldn't save that");
    await page.getByTestId('sheet-save').click();
    await page.waitForFunction(() => document.querySelector('dialog[open]') === null);
    await settled(page);
    expect(posts.ids()).toHaveLength(2);
    expect(new Set(posts.ids()).size).toBe(1);
    // Sent twice, counted once.
    expect(await centsAt(page, 'assigned-savings')).toBe(10_000);
    await page.unrouteAll({ behavior: 'wait' });
    await page.context().close();
  });

  it('14 before the bank is connected, setup day says it cannot start yet; Home leads to it', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'not-set-up');
    expect(await page.getByTestId('start-setup').getAttribute('href')).toBe('/setup/bank');
    await page.getByTestId('start-setup').click();
    await page.getByTestId('setup-not-ready').waitFor();
    expect(await textAt(page, 'setup-not-ready')).toContain('There is no bank connection yet.');
    await settled(page);
    await page.context().close();
  });
});

// Whether Home has a book yet, asked of the server the way the screens ask.
async function homeState(page: Page): Promise<string> {
  return page.evaluate(async () => ((await (await fetch('/api/home', { cache: 'no-store' })).json()) as { state: string }).state);
}
