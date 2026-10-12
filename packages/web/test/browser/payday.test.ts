import type { BankBalances, Book, IsoDate } from '@budget-app/money';
import type { Server } from 'node:http';
import type { Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { START_DATE, appSide, openTestBook, paycheck, purchase, takenBack } from '../../../money/test/helpers.js';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { moneyText } from '../../src/ui/money-format.js';
import { amountAt } from './activity-screens.js';
import { ENGINES, launch, close, openScenario, phone, showScenario, textAt, useEngine } from './harness.js';
import { openLive, startLive } from './live.js';
import { sheetGapsAfterAnAnswer, watchChoices, watchSheetsAfterAnAnswer } from './screens.js';

// Payday, used in a browser like a person would (QUESTIONS.md B104 to B107):
// what the last paycheck did, how much is still to move to savings, what
// became of each leftover, and how the pay period that ended went. Every
// number is compared with the money math for the same book; a tap is
// compared with the same answer given to a twin of the book directly.

interface Life {
  readonly book: Book;
  readonly bank: BankBalances;
  readonly today: IsoDate;
}

function life(name: string): Life {
  const input = demoScenario(name)?.input?.();
  if (input === undefined || input.book === null) throw new Error(`no made-up life called ${name}`);
  return { book: input.book, bank: input.bank as BankBalances, today: input.today };
}

describe.each(ENGINES)('Payday in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('3.2 3.3 B104 the mom reserve comes off first, then the split: every step is the money math\'s, and the parts add up to the paycheck on the screen', async () => {
    const { book } = life('payday-paid');
    const report = book.paydayReport().paycheck!;
    const d = report.split.detail;
    const page = await openScenario(await browser().newContext(phone()), base(), 'payday-paid', '/payday');
    expect(await amountAt(page, 'paycheck-amount')).toBe(report.amount);
    expect(await textAt(page, 'paycheck-when')).toBe('Fri, Oct 16');
    expect(await amountAt(page, 'reserve-taken')).toBe(d.reserveTaken);
    expect(await amountAt(page, 'reserve-in')).toBe(report.split.momReserve);
    expect(await amountAt(page, 'reserve-before')).toBe(report.reserveBefore);
    // The part that did not fit under the cap went to savings.
    expect(d.overflowToSavings).toBeGreaterThan(0);
    expect(await amountAt(page, 'reserve-overflow')).toBe(d.overflowToSavings);
    expect(await amountAt(page, 'split-rest')).toBe(d.rest);
    expect(await amountAt(page, 'split-savings')).toBe(d.savingsShare);
    expect(await amountAt(page, 'split-needs')).toBe(report.split.needs);
    expect(await amountAt(page, 'split-wants')).toBe(report.split.wants);
    expect(await page.getByTestId('split-rounding').count()).toBe(d.roundingToSavings > 0 ? 1 : 0);
    const got = [await amountAt(page, 'got-mom'), await amountAt(page, 'got-savings'), await amountAt(page, 'got-needs'), await amountAt(page, 'got-wants')];
    expect(got).toEqual([report.split.momReserve, report.split.savings, report.split.needs, report.split.wants]);
    expect(got.reduce((sum, c) => sum + c, 0)).toBe(await amountAt(page, 'got-total'));
    expect(await amountAt(page, 'got-total')).toBe(report.amount);
    // The percentages shown are the ones this paycheck was worked out with.
    const split = await textAt(page, 'payday-split');
    expect(split).toContain(`Savings, ${report.percent.savings}%`);
    expect(split).toContain(`Needs, ${report.percent.needs}%`);
    expect(split).toContain(`Wants, ${report.percent.wants}%`);
    await page.context().close();
  });

  it('3.3 the cents left over from rounding go to savings, and the screen says how many', async () => {
    const book = openTestBook({ pots: { savings: 100_000 } });
    book.receive(paycheck('p1', '2026-10-09', 234_567));
    const { page, context } = await show(await browser().newContext(phone()), book, '/payday', '2026-10-12');
    expect(await amountAt(page, 'split-rounding')).toBe(1);
    expect(await amountAt(page, 'got-savings')).toBe(42_284);
    await context.close();
  });

  it('11.2 B35 the days to the next payday are in words, and a late paycheck says so', async () => {
    const context = await browser().newContext(phone());
    const page = await openScenario(context, base(), 'payday-paid', '/payday');
    expect(await textAt(page, 'next-payday')).toBe('14 days to payday');
    // The same page, moved to the other life (showLive in live.ts says why).
    await showScenario(page, base(), 'late', '/payday');
    expect(await textAt(page, 'next-payday')).toBe('Paycheck is 2 days late');
    await context.close();
  });

  it('3.8 how much to move to savings is the money math\'s: what it should hold, what it holds, what is still to move', async () => {
    const { book, bank } = life('payday-paid');
    const move = book.savingsTransfer(bank.savings);
    const page = await openScenario(await browser().newContext(phone()), base(), 'payday-paid', '/payday');
    expect(await amountAt(page, 'savings-should')).toBe(move.shouldBeInSavings);
    expect(await amountAt(page, 'savings-holds')).toBe(move.savingsAccountBalance);
    expect(await amountAt(page, 'savings-to-move')).toBe(move.stillToMove);
    expect(move.stillToMove).toBeGreaterThan(0);
    expect(await textAt(page, 'payday-savings')).toContain("Move it from checking to savings in your bank's app. This app never moves money.");
    expect(await page.getByTestId('savings-extra').count()).toBe(0);
    await page.context().close();
  });

  it('0.5 when the bank cannot be read, it says so instead of an amount to move', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'bank-not-read', '/payday');
    expect(await textAt(page, 'savings-not-read')).toContain("Can't reach the bank to check the savings account now");
    expect(await page.getByTestId('savings-to-move').count()).toBe(0);
    await page.context().close();
  });

  it('3.4 B106 once a leftover answer has gone through, the sheet never shows a button that could send it again', async () => {
    const twin = life('payday-paid');
    const context = await browser().newContext(phone());
    await watchSheetsAfterAnAnswer(context, '[data-testid="confirm-yes"], [data-testid="confirm-cancel"]');
    const page = await openScenario(context, base(), 'payday-paid', '/payday');
    const [needsId] = twin.book.paydayReport().leftovers.map((l) => l.question!);
    await page.getByTestId(`item-${needsId}`).getByTestId('answer-roll-over').click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('leftover-needs').waitFor();
    const seen = await sheetGapsAfterAnAnswer(page);
    expect(seen.answered).toBe(true);
    expect(seen.gaps).toEqual([]);
    await page.context().close();
  });

  // The same moment as Review's (B92): the answer is back, and Payday still
  // shows the numbers from before it, with the question's card still there.
  // Its buttons stay off until the numbers asked for after it are shown.
  it('3.4 B92 an answer already given cannot be sent again while Payday still shows the numbers from before it', async () => {
    const twin = life('payday-paid');
    const page = await openScenario(await browser().newContext(phone()), base(), 'payday-paid', '/payday');
    const watch = watchChoices(page);
    const [needsId] = twin.book.paydayReport().leftovers.map((l) => l.question!);
    const button = page.getByTestId(`item-${needsId}`).getByTestId('answer-roll-over');
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let asked = false;
    await page.route('**/api/payday', async (route) => {
      asked = true;
      await held;
      await route.continue();
    });
    await button.click();
    await page.getByTestId('confirm-yes').click();
    await expect.poll(() => asked).toBe(true);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)))));
    expect(await button.isDisabled()).toBe(true);
    await button.click({ force: true });
    expect(await page.getByTestId('confirm-yes').count()).toBe(0);
    release();
    await page.getByTestId('leftover-needs').waitFor();
    await page.unrouteAll({ behavior: 'wait' });
    expect(watch.posts.length).toBe(1);
    twin.book.answerLeftover(needsId!, 'roll-over', twin.today);
    expect(await page.getByTestId(`item-${needsId}`).count()).toBe(0);
    await page.context().close();
  });

  it('3.4 B106 the two questions waiting are answered here: each asks first, then does what the money math does, and is no longer asked', async () => {
    const twin = life('payday-paid');
    const page = await openScenario(await browser().newContext(phone()), base(), 'payday-paid', '/payday');
    const watch = watchChoices(page);
    const [needsId, wantsId] = twin.book.paydayReport().leftovers.map((l) => l.question!);
    expect(await page.getByTestId(`item-${needsId}`).count()).toBe(1);
    expect(await page.getByTestId(`item-${wantsId}`).count()).toBe(1);

    await page.getByTestId(`item-${needsId}`).getByTestId('answer-roll-over').click();
    expect(await textAt(page, 'confirm-title')).toBe('Answer for good?');
    expect(await textAt(page, 'confirm-ask')).toContain('for this pay period?');
    await page.getByTestId('confirm-cancel').click();
    expect(watch.posts.length).toBe(0);
    await page.keyboard.press('Escape');

    await page.getByTestId(`item-${needsId}`).getByTestId('answer-roll-over').click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('leftover-needs').waitFor();
    expect(watch.posts.length).toBe(1);
    expect(JSON.parse(watch.posts[0]?.postData() ?? '{}')).toMatchObject({ item: needsId, choice: { leftover: 'roll-over' }, confirmed: true });
    twin.book.answerLeftover(needsId!, 'roll-over', twin.today);

    await page.getByTestId(`item-${wantsId}`).getByTestId('answer-move-to-savings').click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('leftover-wants').waitFor();
    twin.book.answerLeftover(wantsId!, 'move-to-savings', twin.today);

    const report = twin.book.paydayReport();
    expect(await textAt(page, 'leftover-needs')).toBe(`Needs: kept ${moneyText(report.leftovers[0]!.amount)} Rolled over into this pay period, by your answer.`);
    expect(await textAt(page, 'leftover-wants')).toBe(`Wants: ${moneyText(report.leftovers[1]!.amount)} moved to Savings By your answer. ${moneyText(report.leftovers[1]!.leftAtPayday)} at payday, less ${moneyText(report.leftovers[1]!.lessSincePayday)} spent before payday and sorted since.`);
    expect(await page.getByTestId(`item-${needsId}`).count()).toBe(0);
    // The same answer is gone from Review too (B107).
    await page.getByTestId('tab-review').click();
    await page.getByTestId('review-count').waitFor();
    expect(await page.getByTestId('review-count').innerText()).toBe(String(twin.book.reviewItems().length));
    await page.context().close();
  });

  it('3.4 B4 B109 the question that late spending made smaller says why, in words, and the one it did not touch says nothing', async () => {
    const { book } = life('payday-paid');
    const [needs, wants] = book.paydayReport().leftovers;
    const page = await openScenario(await browser().newContext(phone()), base(), 'payday-paid', '/payday');
    // Worked example 14: 657.11 at payday, 34.67 of spending from before payday sorted since.
    expect(await page.getByTestId(`item-${wants!.question}`).getByTestId('leftover-why').innerText()).toBe('$657.11 at payday, less $34.67 spent before payday and sorted since.');
    expect(await page.getByTestId(`item-${wants!.question}`).getByTestId('item-amount').innerText()).toBe('$622.44');
    expect(await page.getByTestId(`item-${needs!.question}`).getByTestId('leftover-why').count()).toBe(0);
    await page.context().close();
  });

  it('3.4 B4 B109 an answered question keeps saying why, with the amount it was answered for', async () => {
    const twin = life('payday-paid');
    const [needsId, wantsId] = twin.book.paydayReport().leftovers.map((l) => l.question!);
    const page = await openScenario(await browser().newContext(phone()), base(), 'payday-paid', '/payday');
    await page.getByTestId(`item-${wantsId}`).getByTestId('answer-roll-over').click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('leftover-wants').waitFor();
    twin.book.answerLeftover(wantsId!, 'roll-over', twin.today);
    const wants = twin.book.paydayReport().leftovers[1]!;
    expect(wants).toMatchObject({ outcome: 'kept', amount: 62_244, lessSincePayday: 3_467 });
    expect(await textAt(page, 'leftover-wants')).toBe(`Wants: kept $622.44 Rolled over into this pay period, by your answer. ${moneyText(wants.leftAtPayday)} at payday, less ${moneyText(wants.lessSincePayday)} spent before payday and sorted since.`);
    expect(await page.getByTestId(`item-${needsId}`).getByTestId('leftover-why').count()).toBe(0);
    await page.context().close();
  });

  it('3.4 B107 an answer given in Review is already answered on Payday', async () => {
    const twin = life('payday-paid');
    const [needsId] = twin.book.paydayReport().leftovers.map((l) => l.question!);
    const page = await openScenario(await browser().newContext(phone()), base(), 'payday-paid', '/review');
    await page.getByTestId(`item-${needsId}`).getByTestId('answer-roll-over').click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId(`item-${needsId}`).waitFor({ state: 'detached' });
    twin.book.answerLeftover(needsId!, 'roll-over', twin.today);
    await page.goto(`${base()}/payday`);
    await page.locator('main[aria-busy="false"]').waitFor();
    expect(await page.getByTestId(`item-${needsId}`).count()).toBe(0);
    expect(await textAt(page, 'leftover-needs')).toContain('Needs: kept');
    await page.context().close();
  });

  it('B105 the pay period that just ended: what was spent, what was sent to mom, and what was left at payday', async () => {
    const { book } = life('payday-paid');
    const s = book.paydayReport().ended!;
    const page = await openScenario(await browser().newContext(phone()), base(), 'payday-paid', '/payday');
    expect(await textAt(page, 'ended-dates')).toBe('Fri, Oct 2 to Fri, Oct 16');
    expect(await amountAt(page, 'ended-needs-spent')).toBe(s.byKind.needs.spending);
    expect(await amountAt(page, 'ended-wants-spent')).toBe(s.byKind.wants.spending);
    expect(await amountAt(page, 'ended-mom')).toBe(s.byKind.momReserve.mom);
    expect(await amountAt(page, 'ended-needs-left')).toBe(s.closing.needs);
    expect(await amountAt(page, 'ended-wants-left')).toBe(s.closing.wants);
    // What was left is what the questions asked about.
    const asked = book.paydayReport().leftovers;
    expect(s.closing.needs).toBe(asked[0]!.leftAtPayday);
    expect(await page.locator('[data-testid="ended-needs-spent"].is-negative').count()).toBe(1);
    await page.context().close();
  });

  it('B104 before the first paycheck there is nothing to report, and it says when the next one is expected', async () => {
    const book = openTestBook({ pots: { needs: 1_000 } });
    const { page, context } = await show(await browser().newContext(phone()), book, '/payday', '2026-10-05');
    expect(await textAt(page, 'payday-none')).toContain('No paycheck yet');
    expect(await textAt(page, 'payday-none')).toContain('Fri, Oct 9');
    expect(await page.getByTestId('paycheck-amount').count()).toBe(0);
    expect(await page.getByTestId('payday-ended').count()).toBe(0);
    await context.close();
  });

  it('14 before setup day, Payday says it has nothing yet', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'not-set-up', '/payday');
    expect(await textAt(page, 'payday-not-set-up')).toContain('No paydays yet');
    await page.context().close();
  });

  it('while loading, Payday shows a placeholder and no numbers; when it cannot load, it says so and Try again loads it', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    let release: () => void = () => undefined;
    const held = new Promise<void>((done) => (release = done));
    let failing = true;
    await page.route('**/api/payday', async (route) => {
      await held;
      if (failing) await route.fulfill({ status: 500, body: '{"error":"payday-unavailable"}', contentType: 'application/json' });
      else await route.continue();
    });
    await page.goto(`${base()}/demo/payday-paid`);
    await page.locator('main[aria-busy="false"]').waitFor();
    await page.goto(`${base()}/payday`);
    await page.getByTestId('payday-loading').waitFor();
    expect(await page.locator('main [data-money]').count()).toBe(0);
    release();
    await page.getByTestId('payday-error').waitFor();
    expect(await textAt(page, 'payday-error')).toBe("Couldn't load payday Check your connection, then try again. Try again");
    failing = false;
    await page.getByTestId('retry').click();
    await page.getByTestId('paycheck-amount').waitFor();
    expect(await amountAt(page, 'paycheck-amount')).toBe(life('payday-paid').book.paydayReport().paycheck!.amount);
    await context.close();
  });

  // ----- Getting there, and back -----

  it('B104 B107 Payday opens from Home and from Buckets, and back goes to the one it came from', async () => {
    const context = await browser().newContext(phone());
    const page = await openScenario(context, base(), 'payday-paid');
    await page.getByTestId('home-payday').click();
    await page.getByTestId('paycheck-amount').waitFor();
    expect(new URL(page.url()).pathname).toBe('/payday');
    expect(await page.title()).toBe('Payday · Budget');
    expect(await page.getByTestId('tab-buckets').getAttribute('aria-current')).toBe('page');
    expect(await page.getByTestId('back').innerText()).toBe('Home');
    await page.getByTestId('back').click();
    await page.getByTestId('safe-to-spend').waitFor();
    expect(new URL(page.url()).pathname).toBe('/home');

    // The same page each time, the life started over and the address opened
    // afresh, a new document as in a new page (showLive in live.ts says why).
    await showScenario(page, base(), 'payday-paid', '/buckets');
    await page.getByTestId('row-payday').click();
    await page.getByTestId('paycheck-amount').waitFor();
    expect(await page.getByTestId('back').innerText()).toBe('Buckets');
    await page.getByTestId('back').click();
    await page.getByTestId('buckets-total').waitFor();
    expect(new URL(page.url()).pathname).toBe('/buckets');

    // Opened by its address, with nothing before it in the app: back goes to Buckets.
    await showScenario(page, base(), 'payday-paid', '/payday');
    expect(await page.getByTestId('back').innerText()).toBe('Buckets');
    await page.getByTestId('back').click();
    await page.getByTestId('buckets-total').waitFor();
    expect(new URL(page.url()).pathname).toBe('/buckets');
    await context.close();
  });
});

// A book made for the test, so each outcome is exact.
describe.each(ENGINES)('Payday: books made for the test, in %s', (_name, engine) => {
  let browser: Browser;
  const servers: Server[] = [];
  beforeAll(async () => {
    browser = await launch(engine);
  });
  afterAll(async () => {
    await browser?.close();
    for (const server of servers) await close(server);
  });

  async function show(book: Book, today: IsoDate = START_DATE, inSavings = 0) {
    const bank: BankBalances = { checking: appSide(book.pots()) - book.inTransit().total - inSavings, savings: inSavings, everydayCard: 0 };
    const live = await startLive({ book, bank, today });
    servers.push(live.server);
    const context = await browser.newContext(phone());
    return { page: await openLive(context, live.base, '/payday'), context };
  }

  const RULES = [{ id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' }] as const;

  it('3.8 B46 when what is on its way covers what was left to move, it says nothing more is to move, not that the account already holds it', async () => {
    const book = openTestBook({ pots: { savings: 200_000, momReserve: 50_000, wants: 1_000 } });
    book.receive(paycheck('pay', '2026-10-09', 300_000));
    const should = book.pots().savings + book.pots().momReserve;
    // The account holds all but 120,000.00 of it; that much is on its way.
    book.receive({ kind: 'transfer-sent', id: 'to-savings', from: 'checking', to: 'savings', date: '2026-10-09', amount: 120_000, description: 'TRANSFER TO SAVINGS' });
    const { page, context } = await show(book, '2026-10-09', should - 120_000);
    expect(await amountAt(page, 'savings-to-move')).toBe(0);
    expect(await amountAt(page, 'savings-on-its-way')).toBe(120_000);
    expect(await textAt(page, 'payday-savings')).toContain('Nothing more to move: the rest is on its way to the account.');
    expect(await textAt(page, 'payday-savings')).not.toContain('already holds');
    await context.close();
  });

  it('3.5 a bucket with nothing left, or overspent, asks nothing and carries over, and the screen says so', async () => {
    const book = openTestBook({ pots: { needs: 0, wants: -2_500 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    const { page, context } = await show(book, '2026-10-12');
    expect(await textAt(page, 'leftover-needs')).toBe('Needs: nothing to ask about It held $0.00 at payday. Nothing left, or overspent, carries over as it is.');
    expect(await textAt(page, 'leftover-wants')).toBe('Wants: nothing to ask about It held −$25.00 at payday. Nothing left, or overspent, carries over as it is.');
    expect(await page.locator('[data-testid^="item-leftover"]').count()).toBe(0);
    await context.close();
  });

  it('3.4 the setting says always move to savings or always roll over: no question, and the screen says which setting did it', async () => {
    const book = openTestBook({ pots: { needs: 5_000, wants: 7_000 }, settings: { leftoverAtPayday: { needs: 'move-to-savings', wants: 'roll-over' } } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    const { page, context } = await show(book, '2026-10-12');
    expect(await textAt(page, 'leftover-needs')).toBe('Needs: $50.00 moved to Savings By your setting.');
    expect(await textAt(page, 'leftover-wants')).toBe('Wants: kept $70.00 Rolled over into this pay period, by your setting.');
    await context.close();
  });

  it('3.8 an account that holds more than it should: nothing to move, and the extra is shown on its own', async () => {
    const book = openTestBook({ pots: { savings: 100_000 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    const should = book.savingsTransfer(0).shouldBeInSavings;
    const { page, context } = await show(book, '2026-10-12', should + 2_500);
    expect(await amountAt(page, 'savings-to-move')).toBe(0);
    expect(await amountAt(page, 'savings-extra')).toBe(2_500);
    expect(await textAt(page, 'payday-savings')).toContain('The account already holds what it should.');
    await context.close();
  });

  it('4.10 a paycheck the bank took back says so, and its pay period stays', async () => {
    const book = openTestBook({ pots: { needs: 5_000 } });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    book.receive(takenBack('t1', 'p1', '2026-10-10'));
    const { page, context } = await show(book, '2026-10-12');
    expect(await textAt(page, 'paycheck-taken-back')).toContain('The bank took this paycheck back');
    expect(book.period().number).toBe(1);
    await context.close();
  });

  it('B4 spending from before payday that showed up after it lowers the question, and Payday shows what is asked now', async () => {
    const book = openTestBook({ pots: { needs: 50_000 }, rules: RULES });
    book.receive(paycheck('p1', '2026-10-09', 400_000));
    book.receive(purchase('g1', '2026-10-07', 3_250, 'MADE UP GROCERY'));
    const { page, context } = await show(book, '2026-10-12');
    const question = page.getByTestId('item-leftover:p1:needs');
    expect(await question.getByTestId('item-amount').innerText()).toBe('$467.50');
    expect(await page.getByTestId('item-leftover:p1:needs').count()).toBe(1);
    await context.close();
  });
});

// Books made for a test, shown on their own servers, which are closed at the end.
const liveServers: Server[] = [];
afterAll(async () => {
  for (const server of liveServers) await close(server);
});

async function show(context: Awaited<ReturnType<Browser['newContext']>>, book: Book, path: string, today: IsoDate) {
  const bank: BankBalances = { checking: appSide(book.pots()) - book.inTransit().total, savings: 0, everydayCard: 0 };
  const live = await startLive({ book, bank, today });
  liveServers.push(live.server);
  return { page: await openLive(context, live.base, path), context };
}

describe.each(ENGINES)('money already on its way to savings, on Payday and Home, in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('3.8 B46 Payday shows what is on its way to savings next to what is still to move, so they add up on the screen', async () => {
    const { book, bank } = life('on-its-way');
    const transfer = book.savingsTransfer(bank.savings);
    const page = await openScenario(await browser().newContext(phone()), base(), 'on-its-way', '/payday');
    expect(await amountAt(page, 'savings-on-its-way')).toBe(100_000);
    expect(await amountAt(page, 'savings-to-move')).toBe(transfer.stillToMove);
    // Should be, less what the account holds, less what is on its way: what is still to move (B46).
    expect((await amountAt(page, 'savings-should')) - (await amountAt(page, 'savings-holds')) - (await amountAt(page, 'savings-on-its-way'))).toBe(transfer.stillToMove);
    await page.context().close();
  });

  it('3.8 B46 Home\'s sheet for money to move shows what is on its way too', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'on-its-way');
    await page.getByTestId('attention-move-to-savings').click();
    const sheet = page.getByTestId('savings-sheet');
    await sheet.waitFor();
    expect(await amountAt(page, 'savings-on-its-way')).toBe(100_000);
    expect((await amountAt(page, 'savings-should')) - (await amountAt(page, 'savings-holds')) - (await amountAt(page, 'savings-on-its-way'))).toBe(await amountAt(page, 'savings-to-move'));
    await page.context().close();
  });

  it('3.8 with nothing on its way to savings, Payday does not show a line for it', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'payday-paid', '/payday');
    expect(await page.getByTestId('savings-on-its-way').count()).toBe(0);
    await page.context().close();
  });
});
