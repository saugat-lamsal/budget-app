import type { BankBalances, Book, IsoDate } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { ENGINES, centsAt, openScenario, phone, textAt, useEngine } from './harness.js';

// Home, used in a browser like a person would, with every number it shows
// compared to the money math for the same made-up life. The expected
// numbers come straight from the book (the money package), not from the
// Home view the server sends.

function life(name: string): { readonly book: Book; readonly bank: BankBalances; readonly today: IsoDate } {
  const input = demoScenario(name)?.input?.();
  if (input === undefined || input.book === null || input.bank === null) throw new Error(`no made-up life called ${name}`);
  return { book: input.book, bank: input.bank, today: input.today };
}

describe.each(ENGINES)('Home in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('11.1 safe to spend on the screen is wants left minus unsorted spending, from the money math', async () => {
    const { book, bank, today } = life('normal');
    expect(book.selfCheck(bank).ok).toBe(true);
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    expect(await centsAt(page, 'safe-to-spend')).toBe(book.safeToSpend(today).amount);
    expect(await centsAt(page, 'safe-to-spend')).toBe(book.pots().wants - book.pots().unsortedOut);
    await page.context().close();
  });

  it('11.2 the days to payday and the date, from the pay schedule', async () => {
    const { book, today } = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    const { daysToPayday } = book.safeToSpend(today);
    expect(daysToPayday).toBe(9);
    expect(await textAt(page, 'payday')).toBe('9 days to payday · Fri, Oct 16');
    await page.context().close();
  });

  it('11.2 on payday it says so, and a late paycheck says late (B35)', async () => {
    const context = await browser().newContext(phone());
    const payday = await openScenario(context, base(), 'payday');
    expect(life('payday').book.safeToSpend(life('payday').today).daysToPayday).toBe(0);
    expect(await textAt(payday, 'payday')).toBe('Payday is today · Fri, Oct 16');
    const late = await openScenario(context, base(), 'late');
    expect(life('late').book.safeToSpend(life('late').today).daysToPayday).toBe(-2);
    expect(await textAt(late, 'payday')).toBe('Paycheck is 2 days late · Fri, Oct 16');
    await context.close();
  });

  it('10.1 the bucket bars show what is left in needs and wants', async () => {
    const { book } = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    expect(await centsAt(page, 'bucket-needs-left')).toBe(book.pots().needs);
    expect(await centsAt(page, 'bucket-wants-left')).toBe(book.pots().wants);
    expect(await page.getByTestId('bucket-needs').getAttribute('data-level')).toBe('ok');
    await page.context().close();
  });

  it('10.1 a low bucket says Low, with an icon, not only a color', async () => {
    const { book } = life('low');
    const started = book.startedPeriodWith().wants;
    const left = book.pots().wants;
    // Below 20% of what wants started the pay period with.
    expect(left * 100 < started * 20 && left > 0).toBe(true);
    const page = await openScenario(await browser().newContext(phone()), base(), 'low');
    const wants = page.getByTestId('bucket-wants');
    expect(await wants.getAttribute('data-level')).toBe('low');
    expect(await wants.locator('[data-status="low"]').innerText()).toBe('Low');
    expect(await wants.locator('[data-status="low"] [data-icon="low"]').count()).toBe(1);
    expect(await centsAt(page, 'bucket-wants-left')).toBe(left);
    expect(await page.getByTestId('bucket-needs').locator('[data-status]').count()).toBe(0);
    await page.context().close();
  });

  it('10.2 an overspent bucket says Empty and shows the negative with a minus sign (3.5)', async () => {
    const { book, today } = life('overspent');
    expect(book.pots().wants).toBeLessThan(0);
    const page = await openScenario(await browser().newContext(phone()), base(), 'overspent');
    const wants = page.getByTestId('bucket-wants');
    expect(await wants.locator('[data-status="empty"]').innerText()).toBe('Empty');
    expect(await centsAt(page, 'bucket-wants-left')).toBe(book.pots().wants);
    expect(await page.getByTestId('bucket-wants-left').innerText()).toMatch(/^−\$/);
    // B34: safe to spend below zero is shown as the negative number.
    expect(await centsAt(page, 'safe-to-spend')).toBe(book.safeToSpend(today).amount);
    expect(await page.getByTestId('safe-to-spend').getAttribute('aria-label')).toMatch(/^minus \$/);
    await page.context().close();
  });

  it('10.3 what waits in review: the count, the spending held back, and the Review badge', async () => {
    const { book } = life('normal');
    const waiting = book.reviewItems().length;
    expect(waiting).toBe(2);
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    expect(await page.getByTestId('attention-review').locator('.row__title').innerText()).toBe(`${waiting} waiting in review`);
    expect(await centsAt(page, 'held-back')).toBe(book.pots().unsortedOut);
    expect(await page.getByTestId('review-badge').innerText()).toBe(String(waiting));
    // A screen reader hears the count with the tab's name.
    expect(await page.getByRole('link', { name: new RegExp(`^Review\\s*, ${waiting} waiting$`) }).count()).toBe(1);
    await page.context().close();
  });

  it('3.8 the money to move into savings, and the numbers behind it', async () => {
    const { book, bank } = life('normal');
    const move = book.savingsTransfer(bank.savings);
    expect(move.stillToMove).toBeGreaterThan(0);
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    expect(await centsAt(page, 'move-amount')).toBe(move.stillToMove);
    await page.getByTestId('attention-move-to-savings').click();
    await expect.poll(() => page.getByTestId('savings-sheet').isVisible()).toBe(true);
    expect(await centsAt(page, 'savings-should')).toBe(move.shouldBeInSavings);
    expect(await centsAt(page, 'savings-holds')).toBe(move.savingsAccountBalance);
    expect(await centsAt(page, 'savings-to-move')).toBe(move.stillToMove);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect.poll(() => page.getByTestId('savings-sheet').isVisible()).toBe(false);
    await page.context().close();
  });

  it('9.1 the everyday card reminder shows the statement balance, minimum, and due date', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    expect(await textAt(page, 'attention-card-due-everyday-card')).toBe('Everyday card due in 7 days Wed, Oct 14. Statement $612.48, minimum $35.00.');
    await page.context().close();
  });

  it('9.4 10.5 an overdue card says Overdue, and the bank login comes first', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'trouble');
    const rows = await page.getByTestId('attention').locator('[data-testid^="attention-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(rows).toEqual(['attention-bank-login', 'attention-card-overdue-old-card', 'attention-review', 'attention-move-to-savings']);
    expect(await textAt(page, 'attention-card-overdue-old-card')).toBe('Old card payment Overdue Minimum $40.00 was due Sat, Oct 3.');
    expect(await textAt(page, 'attention-bank-login')).toContain('Log in to the bank again');
    await page.context().close();
  });

  it('Home with nothing to do says so', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'all-clear');
    expect(await textAt(page, 'all-clear')).toBe('Nothing needs you right now');
    expect(await page.getByTestId('review-badge').count()).toBe(0);
    await page.context().close();
  });

  it('0.5 totals that do not match: safe to spend is hidden and the difference cannot be missed (12.3, B37)', async () => {
    const { book, bank, today } = life('mismatch');
    const check = book.selfCheck(bank);
    expect(check.ok).toBe(false);
    expect(check.difference).toBe(-1_234);
    const page = await openScenario(await browser().newContext(phone()), base(), 'mismatch');
    expect(await page.getByTestId('safe-to-spend').count()).toBe(0);
    const banner = page.getByRole('alert');
    expect(await banner.getAttribute('aria-label')).toBe('Totals do not match the bank');
    expect(await centsAt(page, 'mismatch-amount')).toBe(Math.abs(check.difference));
    expect(await textAt(page, 'mismatch')).toContain('Off by $12.34 The bank shows less than your buckets add up to. Safe to spend is hidden until they match.');
    // An icon as well as the words and the color.
    expect(await banner.locator('[data-icon="alert"]').count()).toBe(1);
    // At the top of the screen, big, and without scrolling.
    const box = await banner.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeLessThan(120);
    expect(box!.height).toBeGreaterThan(150);
    expect(box!.width).toBeGreaterThan(330);
    // B37: the days to payday still show.
    expect(await textAt(page, 'payday')).toBe(`${book.safeToSpend(today).daysToPayday} days to payday · Fri, Oct 16`);

    await page.getByTestId('see-check').click();
    await expect.poll(() => page.getByTestId('check-sheet').isVisible()).toBe(true);
    expect(await centsAt(page, 'check-bank')).toBe(check.bankSide);
    expect(await centsAt(page, 'check-transit')).toBe(check.inTransit);
    expect(await centsAt(page, 'check-app')).toBe(check.appSide);
    expect(await centsAt(page, 'check-difference')).toBe(check.difference);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.getByTestId('check-sheet').isVisible()).toBe(false);
    await page.context().close();
  });

  it('very large amounts are shown exactly', async () => {
    const { book, today } = life('big');
    const page = await openScenario(await browser().newContext(phone()), base(), 'big');
    expect(await centsAt(page, 'safe-to-spend')).toBe(book.safeToSpend(today).amount);
    expect(await centsAt(page, 'bucket-needs-left')).toBe(book.pots().needs);
    expect(await page.getByTestId('safe-to-spend').innerText()).toMatch(/^\$\d{1,3}(,\d{3}){2,}\.\d{2}$/);
    await page.context().close();
  });

  it('14 before setup day, Home says it is not set up yet', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'not-set-up');
    expect(await textAt(page, 'home-not-set-up')).toContain('Not set up yet');
    expect(await page.getByTestId('safe-to-spend').count()).toBe(0);
    await page.context().close();
  });

  it('the made-up numbers say they are made up', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    expect(await textAt(page, 'made-up')).toBe('Made-up data');
    await page.context().close();
  });

  it('while loading, Home shows a placeholder and no numbers', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    let release: () => void = () => undefined;
    const held = new Promise<void>((done) => (release = done));
    await page.route('**/api/home', async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`${base()}/demo/normal`);
    await page.getByTestId('home-loading').waitFor();
    expect(await page.getByTestId('home').getAttribute('aria-busy')).toBe('true');
    expect(await page.locator('[data-money]').count()).toBe(0);
    release();
    await page.getByTestId('safe-to-spend').waitFor();
    expect(await page.getByTestId('home').getAttribute('aria-busy')).toBe('false');
    await context.close();
  });

  it('when Home cannot load, it says so and Try again loads it', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    let failing = true;
    await page.route('**/api/home', async (route) => {
      if (failing) await route.fulfill({ status: 500, body: '{"error":"home-unavailable"}', contentType: 'application/json' });
      else await route.continue();
    });
    await page.goto(`${base()}/demo/normal`);
    await page.getByTestId('home-error').waitFor();
    expect(await textAt(page, 'home-error')).toBe("Couldn't load your numbers Check your connection, then try again. Try again");
    expect(await page.locator('[data-money]').count()).toBe(0);
    failing = false;
    await page.getByTestId('retry').click();
    await page.getByTestId('safe-to-spend').waitFor();
    expect(await centsAt(page, 'safe-to-spend')).toBe(life('normal').book.safeToSpend(life('normal').today).amount);
    await context.close();
  });

  it('the demo life that cannot load shows the error state', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    await page.goto(`${base()}/demo/error`);
    await page.getByTestId('home-error').waitFor();
    await context.close();
  });
});
