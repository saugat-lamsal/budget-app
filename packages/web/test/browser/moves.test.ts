import { MOVABLE_POTS, formatDollars, type BankBalances, type Book, type IsoDate } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { moneyText } from '../../src/ui/money-format.js';
import { POT_NAMES } from '../../src/ui/names.js';
import { activityOf, amountAt, numbersOf, readActivity } from './activity-screens.js';
import { ENGINES, openScenario, phone, textAt, useEngine } from './harness.js';
import { bucketsOf, readBuckets, watchChoices } from './screens.js';

// Moving money between buckets by hand, used in a browser like a person
// would (rules 13.3, 13.4, 13.5; QUESTIONS.md B103). A move is compared with
// the same move given to a twin of the book directly. The expected numbers
// come straight from the book (the money package).

interface Life {
  readonly book: Book;
  readonly bank: BankBalances;
  readonly today: IsoDate;
}

function life(name: string): Life {
  const input = demoScenario(name)?.input?.();
  if (input === undefined || input.book === null || input.bank === null) throw new Error(`no made-up life called ${name}`);
  return { book: input.book, bank: input.bank, today: input.today };
}

// "25.00": what he would type for this many cents.
const typed = (cents: number): string => formatDollars(cents).replace('$', '').replaceAll(',', '');

describe.each(ENGINES)('moving money by hand, in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('13.3 the form lists the five buckets, each with what it holds now, and starts from wants to needs', async () => {
    const { book } = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    await page.getByTestId('move-open').click();
    const pots = book.pots();
    const expected = MOVABLE_POTS.map((pot) => `${POT_NAMES[pot]} · ${moneyText(pots[pot])}`);
    expect(await page.getByTestId('move-from').locator('option').allInnerTexts()).toEqual(expected);
    expect(await page.getByTestId('move-to').locator('option').allInnerTexts()).toEqual(expected);
    expect(await page.getByTestId('move-from').inputValue()).toBe('wants');
    expect(await page.getByTestId('move-to').inputValue()).toBe('needs');
    expect(await page.getByTestId('move-submit').isDisabled()).toBe(true);
    await page.context().close();
  });

  it('13.3 wants to needs: one tap asks nothing, moves it, says so, and every number is what the same move gives a twin', async () => {
    const twin = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    const watch = watchChoices(page);
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('25.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('notice').waitFor();
    expect(await textAt(page, 'notice')).toContain('Moved $25.00 from Wants to Needs.');
    expect(watch.posts.length).toBe(1);
    expect(JSON.parse(watch.posts[0]?.postData() ?? '{}')).toEqual({ id: watch.ids()[0], move: { from: 'wants', to: 'needs', amount: 2_500 } });
    twin.book.moveMoney({ from: 'wants', to: 'needs', amount: 2_500 }, twin.today);
    await page.getByTestId('bucket-needs-left').waitFor();
    await expect.poll(async () => (await readBuckets(page)).needs).toBe(twin.book.pots().needs);
    expect(await readBuckets(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('11.1 a move out of wants lowers safe to spend on Home, right away', async () => {
    const twin = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('25.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('notice').waitFor();
    twin.book.moveMoney({ from: 'wants', to: 'needs', amount: 2_500 }, twin.today);
    await page.getByTestId('tab-home').click();
    await page.getByTestId('safe-to-spend').waitFor();
    await expect.poll(async () => amountAt(page, 'safe-to-spend')).toBe(twin.book.safeToSpend(twin.today).amount);
    await page.context().close();
  });

  it('13.4 out of savings it asks first, says why, and nothing moves until he says yes; the same decision goes through', async () => {
    const twin = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    const watch = watchChoices(page);
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-from').selectOption('savings');
    await page.getByTestId('move-to').selectOption('needs');
    await page.getByTestId('move-amount').fill('100.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('move-confirm-title').waitFor();
    expect(await textAt(page, 'move-confirm-title')).toBe('Move $100.00 out of Savings?');
    expect(await textAt(page, 'move-confirm-ask')).toBe('Moving $100.00 out of Savings needs your OK first: it takes money out of Savings. Nothing was changed.');
    expect(watch.posts.length).toBe(1);
    expect(JSON.parse(watch.posts[0]?.postData() ?? '{}')).not.toHaveProperty('confirmed');
    // Nothing moved behind the sheet.
    expect(twin.book.pots().savings).toBe(life('normal').book.pots().savings);
    // Cancel goes back to the form, with what was typed.
    await page.getByTestId('move-confirm-cancel').click();
    expect(await page.getByTestId('move-amount').inputValue()).toBe('100.00');
    expect(await page.getByTestId('move-from').inputValue()).toBe('savings');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('move-confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    expect(await textAt(page, 'notice')).toContain('Moved $100.00 from Savings to Needs.');
    // The same decision number all the way through, and the last one carries his yes.
    expect(new Set(watch.ids()).size).toBe(1);
    expect(JSON.parse(watch.posts.at(-1)?.postData() ?? '{}')).toMatchObject({ move: { from: 'savings', to: 'needs', amount: 10_000 }, confirmed: true });
    twin.book.moveMoney({ from: 'savings', to: 'needs', amount: 10_000, confirmed: true }, twin.today);
    await expect.poll(async () => (await readBuckets(page)).savings).toBe(twin.book.pots().savings);
    expect(await readBuckets(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('13.4 out of the mom reserve asks too', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-from').selectOption('momReserve');
    await page.getByTestId('move-to').selectOption('wants');
    await page.getByTestId('move-amount').fill('10.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('move-confirm-title').waitFor();
    expect(await textAt(page, 'move-confirm-ask')).toContain('it takes money out of the Mom reserve');
    await page.context().close();
  });

  it('13.4 B51 a move that would leave the bucket below zero asks, saying that is usually a typo; leaving exactly zero asks nothing', async () => {
    const twin = life('normal');
    const wants = twin.book.pots().wants;
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill(typed(wants + 1));
    await page.getByTestId('move-submit').click();
    await page.getByTestId('move-confirm-title').waitFor();
    expect(await textAt(page, 'move-confirm-ask')).toBe(`Moving ${moneyText(wants + 1)} out of Wants needs your OK first: it would leave Wants below zero, which is usually a typo. Nothing was changed.`);
    await page.getByTestId('move-confirm-cancel').click();
    // Exactly what it holds: no question.
    await page.getByTestId('move-amount').fill(typed(wants));
    await page.getByTestId('move-submit').click();
    await page.getByTestId('notice').waitFor();
    twin.book.moveMoney({ from: 'wants', to: 'needs', amount: wants }, twin.today);
    await expect.poll(async () => (await readBuckets(page)).wants).toBe(0);
    expect(await readBuckets(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('13.3 the amount must be a number of dollars and cents more than zero: anything else is said inline and sends nothing', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    const watch = watchChoices(page);
    await page.getByTestId('move-open').click();
    for (const [text, says] of [
      ['abc', 'Enter an amount like 25.00'],
      ['1.005', 'Enter an amount like 25.00'],
      ['0', 'Enter more than zero'],
      ['0.00', 'Enter more than zero'],
    ] as const) {
      await page.getByTestId('move-amount').fill(text);
      expect(await textAt(page, 'move-reading'), text).toBe(says);
      expect(await page.getByTestId('move-submit').isDisabled(), text).toBe(true);
    }
    await page.getByTestId('move-amount').fill('');
    expect(await page.getByTestId('move-reading').count()).toBe(0);
    expect(await page.getByTestId('move-submit').isDisabled()).toBe(true);
    await page.getByTestId('move-amount').fill('0.01');
    expect(await page.getByTestId('move-submit').isDisabled()).toBe(false);
    expect(watch.posts.length).toBe(0);
    await page.context().close();
  });

  it('13.3 the same bucket twice is refused in words and changes nothing', async () => {
    const twin = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-from').selectOption('needs');
    await page.getByTestId('move-to').selectOption('needs');
    await page.getByTestId('move-amount').fill('1.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('move-problem').waitFor();
    expect(await textAt(page, 'move-problem')).toBe('Pick two different buckets to move money between. Nothing was changed.');
    await page.getByTestId('move-from').selectOption('wants');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('notice').waitFor();
    twin.book.moveMoney({ from: 'wants', to: 'needs', amount: 100 }, twin.today);
    await expect.poll(async () => (await readBuckets(page)).needs).toBe(twin.book.pots().needs);
    expect(await readBuckets(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('13.3 a double tap sends one request and moves it once', async () => {
    const twin = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    const watch = watchChoices(page);
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('25.00');
    await page.getByTestId('move-submit').dblclick();
    await page.getByTestId('notice').waitFor();
    expect(watch.posts.length).toBe(1);
    twin.book.moveMoney({ from: 'wants', to: 'needs', amount: 2_500 }, twin.today);
    await expect.poll(async () => (await readBuckets(page)).needs).toBe(twin.book.pots().needs);
    expect(await readBuckets(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('13.3 two taps in the same instant, before the screen has redrawn, send one request and move it once', async () => {
    const twin = life('normal');
    const page = await openScenario(await browser().newContext(phone()), base(), 'normal', '/buckets');
    const watch = watchChoices(page);
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('25.00');
    // Both clicks happen in one go, so the button is not yet drawn as disabled for the second one.
    await page.getByTestId('move-submit').evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await page.getByTestId('notice').waitFor();
    expect(watch.posts.length).toBe(1);
    twin.book.moveMoney({ from: 'wants', to: 'needs', amount: 2_500 }, twin.today);
    await expect.poll(async () => (await readBuckets(page)).needs).toBe(twin.book.pots().needs);
    expect(await readBuckets(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('B103 no signal: it says so, and trying again is the same decision, which moves it once', async () => {
    const twin = life('normal');
    const context = await browser().newContext(phone());
    const page = await openScenario(context, base(), 'normal', '/buckets');
    const watch = watchChoices(page);
    let failed = false;
    await page.route('**/api/choice', async (route) => {
      if (!failed) {
        failed = true;
        // The server gets it and moves it, but the answer is lost on the way.
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort();
      } else await route.continue();
    });
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('25.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('move-problem').waitFor();
    expect(await textAt(page, 'move-problem')).toBe("Couldn't save that. Check your connection and try again. Nothing is counted twice.");
    await page.getByTestId('move-submit').click();
    await page.getByTestId('notice').waitFor();
    expect(watch.posts.length).toBe(2);
    expect(new Set(watch.ids()).size).toBe(1);
    // Moved once, though it was sent twice.
    twin.book.moveMoney({ from: 'wants', to: 'needs', amount: 2_500 }, twin.today);
    await expect.poll(async () => (await readBuckets(page)).needs).toBe(twin.book.pots().needs);
    expect(await readBuckets(page)).toEqual(bucketsOf(twin.book));
    await context.close();
  });

  it('13.3 held for others can be moved, and a roommate\'s money that is kept can go to a bucket', async () => {
    const twin = life('buckets-busy');
    const held = twin.book.pots().heldForOthers;
    const page = await openScenario(await browser().newContext(phone()), base(), 'buckets-busy', '/buckets');
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-from').selectOption('heldForOthers');
    await page.getByTestId('move-to').selectOption('wants');
    await page.getByTestId('move-amount').fill(typed(held));
    await page.getByTestId('move-submit').click();
    await page.getByTestId('notice').waitFor();
    twin.book.moveMoney({ from: 'heldForOthers', to: 'wants', amount: held }, twin.today);
    await expect.poll(async () => (await readBuckets(page)).heldForOthers).toBe(0);
    expect(await readBuckets(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });

  it('13.3 very large amounts move exactly', async () => {
    const twin = life('big');
    const page = await openScenario(await browser().newContext(phone()), base(), 'big', '/buckets');
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('1.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('notice').waitFor();
    twin.book.moveMoney({ from: 'wants', to: 'needs', amount: 100 }, twin.today);
    await expect.poll(async () => (await readBuckets(page)).needs).toBe(twin.book.pots().needs);
    expect(await readBuckets(page)).toEqual(bucketsOf(twin.book));
    await page.context().close();
  });
});

describe.each(ENGINES)('moving money from a bucket\'s own list, in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('13.3 the form starts from that bucket, the move shows in both lists, and each is what the same move gives a twin', async () => {
    const twin = life('activity-busy');
    const context = await browser().newContext(phone());
    const page = await openScenario(context, base(), 'activity-busy', '/buckets/wants');
    await page.getByTestId('move-open').click();
    expect(await page.getByTestId('move-from').inputValue()).toBe('wants');
    expect(await page.getByTestId('move-to').inputValue()).toBe('needs');
    await page.getByTestId('move-amount').fill('40.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('notice').waitFor();
    expect(await textAt(page, 'notice')).toContain('Moved $40.00 from Wants to Needs.');
    twin.book.moveMoney({ from: 'wants', to: 'needs', amount: 4_000 }, twin.today);
    await expect.poll(async () => (await readActivity(page)).now).toBe(twin.book.pots().wants);
    expect(numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'wants')));
    // The newest move is listed with its own words, and the older one is still there.
    expect((await readActivity(page)).rows.filter((r) => r.id.startsWith('move:')).map((r) => r.text)).toEqual([
      'Moved out to Needs Moved by hand · Wed, Oct 7 −$40.00',
      'Moved out to Needs Moved by hand · Tue, Oct 6 −$25.00',
    ]);
    // The same life, not picked again (that would start it over): the other bucket has the move too.
    await page.goto(`${base()}/buckets/needs`);
    await page.locator('main[aria-busy="false"]').waitFor();
    expect(numbersOf(await readActivity(page))).toEqual(numbersOf(activityOf(twin.book, 'needs')));
    expect((await readActivity(page)).rows.find((r) => r.id === 'move:2')?.text).toBe('Moved in from Wants Moved by hand · Wed, Oct 7 +$40.00');
    await context.close();
  });
});
