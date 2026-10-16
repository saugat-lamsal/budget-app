import type { BankBalances, Book, IsoDate } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { ENGINES, centsAt, openScenario, phone, showScenario, textAt, useEngine } from './harness.js';

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

  it('Step 3 Checked at says when the bank was last read, in his home time zone, with a clock: the time only, on the same day', async () => {
    const input = demoScenario('normal')!.input!();
    expect(input.checkedAt).toEqual({ at: '2026-10-07T09:41:00-04:00', timeZone: 'America/New_York' });
    // The phone is in Chicago here (harness.ts): the time is still New York's.
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    expect(await textAt(page, 'checked-at')).toBe('Checked at 9:41 AM');
    expect(await page.getByTestId('checked-at').locator('[data-icon="clock"]').count()).toBe(1);
    // When the bank cannot be read it stays, at the last read, next to the last checked safe to spend.
    // (The same page, moved to that life: showLive in live.ts says why.)
    await showScenario(page, base(), 'bank-not-read');
    expect(await textAt(page, 'checked-at')).toBe('Checked at 7:15 AM');
    expect(await textAt(page, 'as-of')).toBe("As of Wed, Oct 7, 7:15 AM. Can't reach the bank to check it now.");
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
    const page = await openScenario(context, base(), 'payday');
    expect(life('payday').book.safeToSpend(life('payday').today).daysToPayday).toBe(0);
    expect(await textAt(page, 'payday')).toBe('Payday is today · Fri, Oct 16');
    // The same page, moved to the other life (showLive in live.ts says why).
    await showScenario(page, base(), 'late');
    expect(life('late').book.safeToSpend(life('late').today).daysToPayday).toBe(-2);
    expect(await textAt(page, 'payday')).toBe('Paycheck is 2 days late · Fri, Oct 16');
    await context.close();
  });

  it('10.1 the bucket bars show what is left in needs and wants', async () => {
    const { book } = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    expect(await centsAt(page, 'bucket-needs-left')).toBe(book.pots().needs);
    expect(await centsAt(page, 'bucket-wants-left')).toBe(book.pots().wants);
    expect(await page.getByTestId('bucket-needs').getAttribute('data-level')).toBe('ok');
    // Under each amount: left of what the bucket started the pay period with.
    expect(await centsAt(page, 'bucket-needs-of')).toBe(book.startedPeriodWith().needs);
    expect(await centsAt(page, 'bucket-wants-of')).toBe(book.startedPeriodWith().wants);
    expect(await textAt(page, 'bucket-needs')).toBe('Needs $930.75 left of $1,058.38');
    const amount = await page.getByTestId('bucket-needs-left').boundingBox();
    const of = await page.getByTestId('bucket-needs-of').boundingBox();
    expect(of!.y).toBeGreaterThan(amount!.y + amount!.height - 1);
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

  it('9.8 A52 a card whose reminders are off says so in Needs attention, and why; the one the days would fix opens Settings', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'cards-off');
    const rows = await page.getByTestId('attention').locator('[data-testid^="attention-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(rows.slice(0, 2)).toEqual(['attention-card-reminders-off-everyday-card', 'attention-card-reminders-off-old-card']);
    // No due line for a card whose reminders are off.
    expect(rows.filter((r) => r?.startsWith('attention-card-due'))).toEqual([]);
    expect(await textAt(page, 'attention-card-reminders-off-everyday-card')).toBe('Card reminders are off for the everyday card The bank sent a statement for it that cannot be read.');
    expect(await textAt(page, 'attention-card-reminders-off-old-card')).toBe('Card reminders are off for the old card The bank did not send its statement date. Enter the day its statement closes in Settings.');
    await page.getByTestId('attention-card-reminders-off-old-card').click();
    await page.waitForURL(/\/settings$/);
    await page.context().close();
  });

  it('10.6 a take-back stays in Needs attention until he says he has seen it (B84)', async () => {
    const { book } = life('took-back');
    const entry = book.changeLog().find((e) => e.kind === 'bank-took-back');
    if (entry?.kind !== 'bank-took-back') throw new Error('no take-back in the made-up life');
    const page = await openScenario(await browser().newContext(phone()), base(), 'took-back');
    const row = page.getByTestId(`attention-bank-took-back-${entry.id}`);
    expect(await textAt(page, `attention-bank-took-back-${entry.id}`)).toBe('The bank took back a transaction MAIN ST RESTAURANT, $38.90, on Tue, Oct 6.');
    expect(await row.locator('[data-money]').innerText()).toBe('$38.90');
    // Still there after a refresh.
    await page.reload();
    await row.waitFor();
    await row.click();
    const sheet = page.getByTestId(`took-back-sheet-${entry.id}`);
    await sheet.waitFor();
    expect((await sheet.innerText()).replace(/\s+/g, ' ')).toContain('What MAIN ST RESTAURANT Amount $38.90 When Tue, Oct 6');
    await sheet.getByTestId('seen').click();
    await row.waitFor({ state: 'detached' });
    // The rest of Needs attention is still there.
    expect(await page.getByTestId('attention-review').count()).toBe(1);
    // Seen stays seen.
    await page.reload();
    await page.getByTestId('safe-to-spend').waitFor();
    expect(await row.count()).toBe(0);
    await page.context().close();
  });

  it('10.6 if marking it seen does not save, it says so and the take-back stays', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'took-back');
    await page.route('**/api/seen', (route) => route.fulfill({ status: 500, body: '' }));
    const row = page.locator('[data-testid^="attention-bank-took-back-"]');
    await row.click();
    await page.getByTestId('seen').click();
    await page.getByTestId('seen-failed').waitFor();
    expect(await page.getByTestId('seen-failed').innerText()).toContain("Couldn't save that");
    await page.keyboard.press('Escape');
    expect(await row.count()).toBe(1);
    await page.context().close();
  });

  it('0.5 when the bank cannot be read, the last checked safe to spend shows greyed, as of when it was checked (B82)', async () => {
    const input = demoScenario('bank-not-read')!.input!();
    const { book, today } = input;
    if (book === null) throw new Error('no book');
    expect(input.bank).toBeNull();
    const page = await openScenario(await browser().newContext(phone()), base(), 'bank-not-read');
    expect(await page.getByTestId('safe-to-spend').count()).toBe(0);
    expect(await centsAt(page, 'safe-to-spend-stale')).toBe(input.lastChecked!.amount);
    expect(input.lastChecked!.amount).not.toBe(book.safeToSpend(today).amount);
    expect(await textAt(page, 'as-of')).toBe("As of Wed, Oct 7, 7:15 AM. Can't reach the bank to check it now.");
    expect(await page.getByTestId('as-of').locator('[data-icon="clock"]').count()).toBe(1);
    // Greyed: the secondary text color, not the main one.
    const colors = await page.evaluate(() => ({
      number: getComputedStyle(document.querySelector('[data-testid="safe-to-spend-stale"]')!).color,
      label: getComputedStyle(document.querySelector('.hero__label')!).color,
      body: getComputedStyle(document.body).color,
    }));
    expect(colors.number).toBe(colors.label);
    expect(colors.number).not.toBe(colors.body);
    expect(await textAt(page, 'payday')).toBe('9 days to payday · Fri, Oct 16');
    await page.context().close();
  });

  it('Home with nothing to do says so', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'all-clear');
    expect(await textAt(page, 'all-clear')).toBe('Nothing needs you right now');
    expect(await page.getByTestId('review-badge').count()).toBe(0);
    await page.context().close();
  });

  it('10.4 A47 a difference younger than 12 hours: the bank is still catching up, with the difference, and safe to spend hidden (0.5)', async () => {
    const { book, bank } = life('catching-up');
    const check = book.selfCheck(bank);
    expect(check.difference).toBe(-4_210);
    const page = await openScenario(await browser().newContext(phone()), base(), 'catching-up');
    expect(await page.getByTestId('safe-to-spend').count()).toBe(0);
    expect(await page.getByTestId('mismatch').count()).toBe(0);
    expect(await centsAt(page, 'mismatch-amount')).toBe(4_210);
    expect(await textAt(page, 'catching-up')).toContain('The bank is still catching up');
    expect(await textAt(page, 'catching-up')).toContain('Off by $42.10 for now The bank shows less than your buckets add up to.');
    // Words and an icon, not color alone.
    expect(await page.getByTestId('catching-up').locator('[data-icon="clock"]').count()).toBe(1);
    await page.getByTestId('see-check').click();
    await expect.poll(() => page.getByTestId('check-sheet').isVisible()).toBe(true);
    expect(await centsAt(page, 'check-bank')).toBe(check.bankSide);
    // Why it doesn't match: each account as the made-up bank gave it, and when it began.
    expect(await centsAt(page, 'check-checking-posted')).toBe(bank.checking + 4_210);
    expect(await centsAt(page, 'check-checking-available')).toBe(bank.checking);
    expect(await centsAt(page, 'check-checking-counted')).toBe(bank.checking);
    expect(await centsAt(page, 'check-everyday-card-counted')).toBe(bank.everydayCard);
    expect(await page.getByTestId('check-everyday-card-available').count()).toBe(0);
    expect(await textAt(page, 'check-since')).toMatch(/^The difference began .*9:41 AM\.$/);
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
