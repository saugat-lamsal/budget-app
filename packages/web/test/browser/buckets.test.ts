import type { BankBalances, Book, IsoDate } from '@budget-app/money';
import type { Server } from 'node:http';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MOM_NAME, START_DATE, appSide, openTestBook, payPerson, purchase, refund } from '../../../money/test/helpers.js';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { ENGINES, centsAt, close, openScenario, phone, textAt, useEngine } from './harness.js';
import { openLive, startLive } from './live.js';

// Buckets, used in a browser like a person would, with every number it shows
// compared to the money math for the same book. The expected numbers come
// straight from the book (the money package), not from the view the server
// sends.

function life(name: string): { readonly book: Book; readonly bank: BankBalances; readonly today: IsoDate } {
  const input = demoScenario(name)?.input?.();
  if (input === undefined || input.book === null || input.bank === null) throw new Error(`no made-up life called ${name}`);
  return { book: input.book, bank: input.bank, today: input.today };
}

describe.each(ENGINES)('Buckets in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('12.2 the total is what the buckets add up to, and every part adds up on the screen', async () => {
    const { book, bank } = life('normal');
    expect(book.selfCheck(bank).ok).toBe(true);
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    const total = await centsAt(page, 'buckets-total');
    expect(total).toBe(book.appSide());
    expect(total).toBe(book.selfCheck(bank).appSide);
    // The parts as shown, added up here by hand (12.2).
    const parts =
      (await centsAt(page, 'bucket-needs-left')) +
      (await centsAt(page, 'bucket-wants-left')) +
      (await centsAt(page, 'savings')) +
      (await centsAt(page, 'mom-reserve')) +
      (await centsAt(page, 'held-for-others')) -
      (await centsAt(page, 'waiting-out'));
    expect(parts).toBe(total);
    expect(await textAt(page, 'check-line')).toBe('Matches your bank, to the cent');
    await page.context().close();
  });

  it('10.1 needs and wants show what is left, and what they started the pay period with', async () => {
    const { book } = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    expect(await centsAt(page, 'bucket-needs-left')).toBe(book.pots().needs);
    expect(await centsAt(page, 'bucket-wants-left')).toBe(book.pots().wants);
    expect(await centsAt(page, 'bucket-needs-of')).toBe(book.startedPeriodWith().needs);
    expect(await centsAt(page, 'bucket-wants-of')).toBe(book.startedPeriodWith().wants);
    expect(await textAt(page, 'bucket-needs')).toBe('Needs $930.75 left of $1,058.38');
    expect(await page.getByTestId('bucket-needs').getAttribute('data-level')).toBe('ok');
    await page.context().close();
  });

  it('10.1 10.2 a low bucket says Low and an overspent one says Empty, with a minus sign', async () => {
    const context = await browser().newContext(phone());
    const low = await openScenario(context, base(), 'low', '/buckets');
    expect(await low.getByTestId('bucket-wants').locator('[data-status="low"]').innerText()).toBe('Low');
    expect(await centsAt(low, 'bucket-wants-left')).toBe(life('low').book.pots().wants);
    const over = await openScenario(context, base(), 'overspent', '/buckets');
    expect(await over.getByTestId('bucket-wants').locator('[data-status="empty"]').innerText()).toBe('Empty');
    expect(await over.getByTestId('bucket-wants-left').innerText()).toMatch(/^−\$/);
    expect(await centsAt(over, 'bucket-wants-left')).toBe(life('overspent').book.pots().wants);
    await context.close();
  });

  it('3.2 savings is the savings bucket', async () => {
    const { book } = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    expect(await centsAt(page, 'savings')).toBe(book.pots().savings);
    expect(await centsAt(page, 'mom-reserve')).toBe(book.pots().momReserve);
    await page.context().close();
  });

  it('8.2 the mom reserve shows this month so far against the target, in words as well as a bar', async () => {
    const { book, today } = life('normal');
    const month = book.momSentInMonth(today.slice(0, 7));
    expect(month.sent).toBe(50_000);
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    expect(await centsAt(page, 'mom-sent')).toBe(month.sent);
    expect(await centsAt(page, 'mom-target-low')).toBe(month.target.low);
    expect(await centsAt(page, 'mom-target-high')).toBe(month.target.high);
    expect(await textAt(page, 'mom')).toBe('Mom reserve $2,200.00 Sent in October: $500.00. Target $2,000.00 to $3,000.00. Under target');
    expect(await page.getByTestId('mom').getAttribute('data-position')).toBe('under');
    expect(await page.getByTestId('mom').locator('[data-status="under-target"] [data-icon]').count()).toBe(1);
    await page.context().close();
  });

  it('8.2 sent 2,500.00 is within the target', async () => {
    const { book, today } = life('buckets-busy');
    const month = book.momSentInMonth(today.slice(0, 7));
    expect(month.sent).toBe(250_000);
    const page = await openScenario(await browser().newContext(phone()), base(), 'buckets-busy', '/buckets');
    expect(await centsAt(page, 'mom-sent')).toBe(250_000);
    expect(await page.getByTestId('mom').getAttribute('data-position')).toBe('within');
    expect(await page.getByTestId('mom').locator('[data-status="in-target"]').innerText()).toBe('In the target');
    await page.context().close();
  });

  it('7.3 B22 held for others says what it means: settled, holding, or someone owes you', async () => {
    const context = await browser().newContext(phone());
    const settled = await openScenario(context, base(), 'normal', '/buckets');
    expect(await centsAt(settled, 'held-for-others')).toBe(0);
    expect(await textAt(settled, 'row-held')).toBe('Held for others Settled: nothing held either way $0.00');
    const holding = await openScenario(context, base(), 'buckets-busy', '/buckets');
    expect(await centsAt(holding, 'held-for-others')).toBe(life('buckets-busy').book.othersMoney().heldForOthers);
    expect(await textAt(holding, 'row-held')).toBe("Held for others Holding money that isn't yours $120.00");
    await context.close();
  });

  it('12.4 the old card debt is shown on its own, not part of the total', async () => {
    const { book } = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    expect(await centsAt(page, 'old-card-debt')).toBe(book.oldCardDebt());
    expect(await textAt(page, 'row-old-card')).toBe('Debt on the old card Not part of your buckets. $2,980.00');
    await page.context().close();
  });

  it('4.3 what waits in review is shown apart, and links to Review', async () => {
    const { book } = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    expect(await page.getByTestId('row-waiting').locator('.row__title').innerText()).toBe('2 waiting in review');
    expect(await centsAt(page, 'waiting-out')).toBe(book.pots().unsortedOut);
    expect(await page.getByTestId('waiting-in').count()).toBe(0);
    await page.getByTestId('row-waiting').click();
    await page.getByTestId('review').waitFor();
    expect(new URL(page.url()).pathname).toBe('/review');
    await page.context().close();
  });

  it('nothing waiting: the row is not there at all', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'all-clear', '/buckets');
    expect(await page.getByTestId('waiting').count()).toBe(0);
    await page.context().close();
  });

  it('0.5 totals that do not match the bank: a banner that cannot be missed, with the difference (12.3)', async () => {
    const { book, bank } = life('mismatch');
    const check = book.selfCheck(bank);
    expect(check.difference).toBe(-1_234);
    const page = await openScenario(await browser().newContext(phone()), base(), 'mismatch', '/buckets');
    const banner = page.getByRole('alert');
    expect(await banner.getAttribute('aria-label')).toBe('Totals do not match the bank');
    expect(await centsAt(page, 'mismatch-amount')).toBe(Math.abs(check.difference));
    expect(await textAt(page, 'mismatch')).toContain('Off by $12.34 The bank shows less than your buckets add up to.');
    expect(await banner.locator('[data-icon="alert"]').count()).toBe(1);
    const box = await banner.boundingBox();
    expect(box!.y).toBeLessThan(120);
    // The buckets still show.
    expect(await centsAt(page, 'buckets-total')).toBe(book.appSide());
    await page.getByTestId('see-home').click();
    await page.getByTestId('home').waitFor();
    expect(new URL(page.url()).pathname).toBe('/home');
    await page.context().close();
  });

  it('0.5 when the bank cannot be read, it says so and the buckets still show', async () => {
    const input = demoScenario('bank-not-read')!.input!();
    const book = input.book!;
    expect(input.bank).toBeNull();
    const page = await openScenario(await browser().newContext(phone()), base(), 'bank-not-read', '/buckets');
    expect(await textAt(page, 'check-line')).toBe("Can't reach the bank to check this now");
    expect(await centsAt(page, 'buckets-total')).toBe(book.appSide());
    await page.context().close();
  });

  it('very large amounts are shown exactly', async () => {
    const { book } = life('big');
    const page = await openScenario(await browser().newContext(phone()), base(), 'big', '/buckets');
    expect(await centsAt(page, 'buckets-total')).toBe(book.appSide());
    expect(await centsAt(page, 'savings')).toBe(book.pots().savings);
    expect(await centsAt(page, 'old-card-debt')).toBe(book.oldCardDebt());
    await page.context().close();
  });

  it('14 before setup day, Buckets says it is not set up yet', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'not-set-up', '/buckets');
    expect(await textAt(page, 'buckets-not-set-up')).toContain('No buckets yet');
    expect(await page.getByTestId('buckets-total').count()).toBe(0);
    await page.context().close();
  });

  it('while loading, Buckets shows a placeholder and no numbers; when it cannot load, it says so and Try again loads it', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    let release: () => void = () => undefined;
    const held = new Promise<void>((done) => (release = done));
    let failing = true;
    await page.route('**/api/buckets', async (route) => {
      await held;
      if (failing) await route.fulfill({ status: 500, body: '{"error":"buckets-unavailable"}', contentType: 'application/json' });
      else await route.continue();
    });
    await page.goto(`${base()}/demo/normal`);
    await page.goto(`${base()}/buckets`);
    await page.getByTestId('buckets-loading').waitFor();
    expect(await page.getByTestId('buckets').getAttribute('aria-busy')).toBe('true');
    expect(await page.locator('main [data-money]').count()).toBe(0);
    release();
    await page.getByTestId('buckets-error').waitFor();
    expect(await textAt(page, 'buckets-error')).toBe("Couldn't load your buckets Check your connection, then try again. Try again");
    expect(await page.locator('main [data-money]').count()).toBe(0);
    failing = false;
    await page.getByTestId('retry').click();
    await page.getByTestId('buckets-total').waitFor();
    expect(await centsAt(page, 'buckets-total')).toBe(life('normal').book.appSide());
    await context.close();
  });

  it('every tab leads to its screen from here, and Buckets opens from Home', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal');
    await page.getByTestId('all-buckets').click();
    await page.getByTestId('buckets-total').waitFor();
    expect(new URL(page.url()).pathname).toBe('/buckets');
    expect(await page.title()).toBe('Buckets · Budget');
    await page.context().close();
  });
});

// Books made here, so each state of the mom target and of held money is shown exactly.
describe.each(ENGINES)('Buckets, books made for the test, in %s', (_name, engine) => {
  let browser: Browser;
  const servers: Server[] = [];
  beforeAll(async () => {
    browser = await engine.launch();
  });
  afterAll(async () => {
    await browser?.close();
    for (const server of servers) await close(server);
  });

  async function show(book: Book, today: IsoDate = START_DATE) {
    const bank: BankBalances = { checking: appSide(book.pots()) - book.inTransit().total, savings: 0, everydayCard: 0 };
    const live = await startLive({ book, bank, today });
    servers.push(live.server);
    const context = await browser.newContext(phone());
    return { page: await openLive(context, live.base, '/buckets'), context };
  }

  it('8.2 sent more than the high end is over the target', async () => {
    const book = openTestBook({ pots: { momReserve: 3_000_000 } });
    book.receive(payPerson('m1', '2026-10-03', 300_001, MOM_NAME));
    const { page, context } = await show(book);
    expect(await page.getByTestId('mom').getAttribute('data-position')).toBe('over');
    expect(await page.getByTestId('mom').locator('[data-status="over-target"]').innerText()).toBe('Over target');
    expect(await centsAt(page, 'mom-sent')).toBe(300_001);
    await context.close();
  });

  it('8.2 exactly the low end and exactly the high end are both within', async () => {
    for (const cents of [200_000, 300_000]) {
      const book = openTestBook({ pots: { momReserve: 3_000_000 } });
      book.receive(payPerson('m1', '2026-10-03', cents, MOM_NAME));
      const { page, context } = await show(book);
      expect(await page.getByTestId('mom').getAttribute('data-position'), String(cents)).toBe('within');
      await context.close();
    }
  });

  it('8.2 one cent under the low end is under, and nothing sent is $0.00 under', async () => {
    const book = openTestBook({ pots: { momReserve: 3_000_000 } });
    book.receive(payPerson('m1', '2026-10-03', 199_999, MOM_NAME));
    const first = await show(book);
    expect(await first.page.getByTestId('mom').getAttribute('data-position')).toBe('under');
    await first.context.close();
    const second = await show(openTestBook({ pots: { momReserve: 3_000_000 } }));
    expect(await centsAt(second.page, 'mom-sent')).toBe(0);
    expect(await second.page.getByTestId('mom').getAttribute('data-position')).toBe('under');
    await second.context.close();
  });

  it('7.3 someone owes you shows as a negative with words, not color alone', async () => {
    const book = openTestBook({ pots: { heldForOthers: -3_500 } });
    const { page, context } = await show(book);
    expect(await textAt(page, 'row-held')).toBe('Held for others Someone owes you −$35.00');
    expect(await page.getByTestId('held-for-others').getAttribute('aria-label')).toBe('minus $35.00');
    expect(await centsAt(page, 'held-for-others')).toBe(-3_500);
    await context.close();
  });

  it('B14 an old card paid past what it owed is a credit, in words', async () => {
    const book = openTestBook({ oldCardDebt: 1_000 });
    book.receive(refund('r1', START_DATE, 1_500, undefined, 'old-card'));
    const { page, context } = await show(book);
    expect(await centsAt(page, 'old-card-debt')).toBe(-500);
    expect(await textAt(page, 'row-old-card')).toContain("You've paid more than it owed, so this is a credit.");
    await context.close();
  });

  it('12.2 money waiting in review: coming in and going out are each shown, and add up with the buckets', async () => {
    const book = openTestBook({ pots: { savings: 100_000 } });
    book.receive({ kind: 'deposit', id: 'd1', account: 'checking', date: START_DATE, amount: 25_000, description: 'MADE UP TAX REFUND' });
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    const { page, context } = await show(book);
    expect(await centsAt(page, 'waiting-in')).toBe(25_000);
    expect(await centsAt(page, 'waiting-out')).toBe(1_150);
    expect(await centsAt(page, 'buckets-total')).toBe(100_000 + 25_000 - 1_150);
    await context.close();
  });
});

describe.each(ENGINES)('Buckets, the target bar, in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);
  let custom: Browser;
  const servers: Server[] = [];
  beforeAll(async () => {
    custom = await engine.launch();
  });
  afterAll(async () => {
    await custom?.close();
    for (const server of servers) await close(server);
  });

  async function bar(book: Book) {
    const bank: BankBalances = { checking: appSide(book.pots()) - book.inTransit().total, savings: 0, everydayCard: 0 };
    const live = await startLive({ book, bank, today: START_DATE });
    servers.push(live.server);
    const context = await custom.newContext(phone());
    const page = await openLive(context, live.base, '/buckets');
    const style = await page.getByTestId('mom').locator('.bar__fill').evaluate((e) => (e as HTMLElement).style.width);
    await context.close();
    return style;
  }

  it('8.2 the mom bar fills toward the high end of the target, with a tick at the low end', async () => {
    const { book, today } = life('normal');
    const month = book.momSentInMonth(today.slice(0, 7));
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    const fill = await page.getByTestId('mom').locator('.bar__fill').evaluate((e) => (e as HTMLElement).style.width);
    const tick = await page.getByTestId('mom').locator('.bar__tick').evaluate((e) => (e as HTMLElement).style.left);
    // 500.00 of the 3,000.00 high end, and the 2,000.00 low end.
    expect(Number.parseFloat(fill)).toBeCloseTo((month.sent / month.target.high) * 100, 1);
    expect(Number.parseFloat(tick)).toBeCloseTo((month.target.low / month.target.high) * 100, 1);
    expect(fill).toBe('16.67%');
    expect(tick).toBe('66.67%');
    await page.context().close();
  });

  it('8.2 the bar is empty when nothing was sent, half full at half the high end, and full at the high end or over it', async () => {
    const sent = async (cents: number): Promise<string> => {
      const book = openTestBook({ pots: { momReserve: 3_000_000 } });
      if (cents > 0) book.receive(payPerson('m1', '2026-10-03', cents, MOM_NAME));
      return bar(book);
    };
    // (The browser writes 50.00% as 50%.)
    expect(await sent(0)).toBe('0%');
    expect(await sent(150_000)).toBe('50%');
    expect(await sent(300_000)).toBe('100%');
    expect(await sent(450_000)).toBe('100%');
  });
});
