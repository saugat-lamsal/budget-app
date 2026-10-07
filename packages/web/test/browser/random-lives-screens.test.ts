import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { Random } from '../../../money/test/sim/random.js';
import { ENGINES, close, phone, readCents, useEngine } from './harness.js';
import { openLive, startLive } from './live.js';
import { FIRST_SEED, LIVES, randomDay } from './random-day.js';
import { bucketsOf, item, listed, readBuckets, watchChoices } from './screens.js';

// Random made-up lives (the Phase 2 simulator), each stopped on a random day
// and shown on Buckets and Review. Whatever the day looks like, every number
// on the screens must be what the money math says for that book, and a few
// random taps must do exactly what the same answers do to a twin of the book
// given straight to the money math.
// WEB_LIVES and WEB_FIRST_SEED run more, or replay one.

describe.each(ENGINES)('random lives on Buckets and Review in %s', (_name, engine) => {
  const { browser } = useEngine(engine);

  const seeds = Array.from({ length: LIVES }, (_, i) => FIRST_SEED + i);
  it.each(seeds)('12.2 8.2 7.3 10.1 every number on Buckets matches the money math, life %i', async (seed) => {
    const life = randomDay(seed);
    const where = `seed ${life.seed}, day ${life.day} (${life.today})`;
    const live = await startLive(life);
    const context = await browser().newContext(phone());
    try {
      const page = await openLive(context, live.base, '/buckets');
      expect(await readBuckets(page), where).toEqual(bucketsOf(life.book));
      // The simulator's bank always agrees with the book (section 12).
      expect(life.book.selfCheck(life.bank).ok, where).toBe(true);
      expect(await page.getByTestId('check-line').innerText(), where).toBe('Matches your bank, to the cent');

      const book = life.book;
      const month = book.momSentInMonth(life.today.slice(0, 7));
      expect(readCents(await page.getByTestId('mom-sent').innerText()), where).toBe(month.sent);
      expect(await page.getByTestId('mom').getAttribute('data-position'), where).toBe(month.sent < month.target.low ? 'under' : month.sent > month.target.high ? 'over' : 'within');
      expect(readCents(await page.getByTestId('old-card-debt').innerText()), where).toBe(book.oldCardDebt());
      const started = book.startedPeriodWith();
      expect(readCents(await page.getByTestId('bucket-needs-of').innerText()), where).toBe(started.needs);
      expect(readCents(await page.getByTestId('bucket-wants-of').innerText()), where).toBe(started.wants);
      // The parts add up to the total on the screen (12.2), added up here by hand.
      const n = await readBuckets(page);
      expect(n.needs + n.wants + n.savings + n.momReserve + n.heldForOthers + n.waitingIn - n.waitingOut, where).toBe(n.total);
    } finally {
      await context.close();
      await close(live.server);
    }
  });

  it.each(seeds)('10.3 B32 4.2 6.1 7.6 every item on Review is the money math\'s, and random taps do what the twin does, life %i', async (seed) => {
    const life = randomDay(seed);
    const twin = randomDay(seed);
    const where = `seed ${life.seed}, day ${life.day} (${life.today})`;
    const live = await startLive(life);
    const context = await browser().newContext(phone());
    try {
      const page = await openLive(context, live.base, '/review');
      page.setDefaultTimeout(20_000);
      const watch = watchChoices(page);

      const details = twin.book.reviewDetails();
      expect([...(await listed(page))].sort(), where).toEqual(details.map((d) => d.item.id).sort());
      expect(await page.getByTestId('review-count').innerText(), where).toBe(String(details.length));
      if (twin.book.pots().unsortedOut > 0) expect(readCents(await page.getByTestId('held-back').innerText()), where).toBe(twin.book.pots().unsortedOut);
      for (const d of details.slice(0, 25)) {
        expect(readCents(await item(page, d.item.id).getByTestId('item-amount').innerText()), `${where} ${d.item.id}`).toBe(d.item.amount);
      }

      // A few random taps on random items, each an offered choice that asks nothing first.
      const random = new Random(seed * 31);
      let taps = 0;
      for (let attempt = 0; attempt < 12 && taps < 3; attempt += 1) {
        const waiting = twin.book.reviewDetails();
        const d = waiting[random.int(0, waiting.length - 1)];
        if (d === undefined) break;
        const o = d.options;
        const card = item(page, d.item.id);
        if (o.type === 'acknowledge') {
          await card.getByTestId('acknowledge').click();
          twin.book.acknowledge(d.item.id, twin.today);
        } else if (o.type === 'leftover') {
          const answer = random.pick(o.answers);
          await card.getByTestId(`answer-${answer}`).click();
          await page.getByTestId('confirm-yes').click();
          twin.book.answerLeftover(d.item.id, answer, twin.today);
        } else {
          const pick = random.pick(o.picks.filter((p) => !p.final));
          await card.getByTestId('more').click();
          await page.getByTestId(`choice-${pick.to}`).click();
          twin.book.sort(d.item.id, { to: pick.to }, twin.today);
        }
        await card.waitFor({ state: 'detached' });
        taps += 1;
      }
      expect(watch.posts.length, where).toBe(taps);
      expect(new Set(watch.ids()).size, where).toBe(taps);

      await expectSameAsTwin(page, twin.book, where);
      // The server's book and the twin agree on everything that is left, too.
      expect(life.book.reviewItems(), where).toEqual(twin.book.reviewItems());
      expect(life.book.pots(), where).toEqual(twin.book.pots());
      expect(life.book.recountPots(), where).toEqual(life.book.pots());
      expect(life.book.selfCheck(life.bank).ok, where).toBe(true);
    } finally {
      await context.close();
      await close(live.server);
    }
  });
});

async function expectSameAsTwin(page: Page, twin: ReturnType<typeof randomDay>['book'], where: string): Promise<void> {
  expect(await page.getByTestId('review-count').innerText(), where).toBe(String(twin.reviewItems().length));
  await page.getByTestId('tab-buckets').click();
  await page.getByTestId('buckets-total').waitFor();
  expect(await readBuckets(page), where).toEqual(bucketsOf(twin));
}
