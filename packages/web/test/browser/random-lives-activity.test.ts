import { MOVABLE_POTS, type Pot } from '@budget-app/money';
import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { Random } from '../../../money/test/sim/random.js';
import { activityOf, amountAt, numbersOf, pathOfPot, readActivity } from './activity-screens.js';
import { ENGINES, close, phone, untilQuiet, useEngine } from './harness.js';
import { openLive, showLive, startLive } from './live.js';
import { FIRST_SEED, LIVES, randomDay } from './random-day.js';
import { watchChoices } from './screens.js';

// Random made-up lives (the Phase 2 simulator), each stopped on a random day
// and shown on the list of each bucket and on Payday. Whatever the day looks
// like, every number and row on the screens must be what the money math says
// for that book, the lists must add up, and a few random taps (sorting
// something again, moving money by hand) must do exactly what the same answers
// do to a twin of the book given straight to the money math.
// Each test opens one page and moves it from screen to screen, each loaded
// afresh (showLive in live.ts says why). WEB_LIVES and WEB_FIRST_SEED run
// more, or replay one.

describe.each(ENGINES)('random lives on the bucket lists and Payday in %s', (_name, engine) => {
  const { browser } = useEngine(engine);
  const seeds = Array.from({ length: LIVES }, (_, i) => FIRST_SEED + i);

  it.each(seeds)('12.2 B97 B98 every bucket\'s list is the money math\'s and adds up, life %i', async (seed) => {
    const life = randomDay(seed);
    const where = `seed ${life.seed}, day ${life.day} (${life.today})`;
    const live = await startLive(life);
    const context = await browser().newContext(phone());
    try {
      let page: Page | null = null;
      for (const pot of MOVABLE_POTS) {
        if (page === null) {
          page = await openLive(context, live.base, pathOfPot(pot));
          page.setDefaultTimeout(20_000);
        } else await showLive(page, live.base, pathOfPot(pot));
        const shown = await readActivity(page);
        expect(numbersOf(shown), `${where} ${pot}`).toEqual(numbersOf(activityOf(life.book, pot)));
        // Added up here by hand, from what is on the screen.
        expect(shown.opening + shown.in + shown.out, `${where} ${pot}`).toBe(shown.closing);
        expect(shown.rows.reduce((sum, r) => sum + r.amount, 0), `${where} ${pot}`).toBe(shown.in + shown.out);
        expect(shown.now, `${where} ${pot}`).toBe(life.book.pots()[pot]);
      }
      await page?.close();
    } finally {
      await context.close();
      await close(live.server);
    }
  });

  it.each(seeds)('3.2 3.3 3.8 3.4 B104 B105 B106 Payday is the money math\'s, life %i', async (seed) => {
    const life = randomDay(seed);
    const where = `seed ${life.seed}, day ${life.day} (${life.today})`;
    const live = await startLive(life);
    const context = await browser().newContext(phone());
    try {
      const page = await openLive(context, live.base, '/payday');
      page.setDefaultTimeout(20_000);
      const report = life.book.paydayReport();
      const move = life.book.savingsTransfer(life.bank.savings);
      expect(await amountAt(page, 'savings-to-move'), where).toBe(move.stillToMove);
      expect(await amountAt(page, 'savings-should'), where).toBe(move.shouldBeInSavings);
      if (report.paycheck === null) {
        expect(await page.getByTestId('payday-none').count(), where).toBe(1);
        return;
      }
      const split = report.paycheck.split;
      expect(await amountAt(page, 'paycheck-amount'), where).toBe(report.paycheck.amount);
      expect(await amountAt(page, 'reserve-taken'), where).toBe(split.detail.reserveTaken);
      expect(await amountAt(page, 'split-rest'), where).toBe(split.detail.rest);
      const got = [await amountAt(page, 'got-mom'), await amountAt(page, 'got-savings'), await amountAt(page, 'got-needs'), await amountAt(page, 'got-wants')];
      expect(got, where).toEqual([split.momReserve, split.savings, split.needs, split.wants]);
      // The parts add up to the paycheck on the screen (3.3).
      expect(got.reduce((sum, c) => sum + c, 0), where).toBe(await amountAt(page, 'got-total'));
      // The questions still open are exactly the ones the report says.
      const asked = report.leftovers.filter((l) => l.outcome === 'waiting');
      expect(await page.locator('[data-testid^="item-leftover"]').count(), where).toBe(asked.length);
      for (const l of report.leftovers) expect(await page.getByTestId(l.question === null ? `leftover-${l.bucket}` : `item-${l.question}`).count(), `${where} ${l.bucket}`).toBe(1);
      if (report.ended !== null) {
        expect(await amountAt(page, 'ended-needs-spent'), where).toBe(report.ended.byKind.needs.spending);
        expect(await amountAt(page, 'ended-wants-left'), where).toBe(report.ended.closing.wants);
      }
    } finally {
      await context.close();
      await close(live.server);
    }
  });

  it.each(seeds)('4.7 13.3 random taps on the lists do what the twin does, life %i', async (seed) => {
    const life = randomDay(seed);
    const twin = randomDay(seed);
    const where = `seed ${life.seed}, day ${life.day} (${life.today})`;
    const live = await startLive(life);
    const context = await browser().newContext(phone());
    try {
      const random = new Random(seed * 53);
      let taps = 0;
      // One page, moved from list to list; what it sends to /api/choice is watched throughout.
      const one: { opened: { readonly page: Page; readonly watch: ReturnType<typeof watchChoices> } | null } = { opened: null };
      const show = async (pot: Pot): Promise<Page> => {
        if (one.opened === null) {
          const first = await openLive(context, live.base, pathOfPot(pot));
          first.setDefaultTimeout(20_000);
          one.opened = { page: first, watch: watchChoices(first) };
        } else await showLive(one.opened.page, live.base, pathOfPot(pot));
        return one.opened.page;
      };
      for (let attempt = 0; attempt < 10 && taps < 4; attempt += 1) {
        const pot = random.pick<Pot>(['needs', 'wants', 'savings', 'momReserve', 'heldForOthers']);
        const page = await show(pot);
        const rows = twin.book.activity(pot).rows;
        // A row that can be sorted again, with a choice that asks nothing and is not where it already is.
        const options = rows.flatMap((r) => {
          if (!r.resort.resortable) return [];
          const now = r.resort.now;
          const picks = r.resort.options.picks.filter((p) => !p.final && !('to' in now && now.to === p.to));
          return picks.length === 0 ? [] : [{ row: r, picks }];
        });
        if (options.length > 0 && random.chance(2, 3)) {
          const { row, picks } = random.pick(options);
          const pick = random.pick(picks);
          await page.getByTestId(`row-${row.id}`).click();
          await page.getByTestId('activity-sheet').getByTestId(`choice-${pick.to}`).click();
          await page.getByTestId('notice').waitFor();
          twin.book.sort(row.id, { to: pick.to }, twin.today);
        } else {
          // Move something between needs and wants, which asks nothing.
          const cents = random.int(1, 5_000);
          await page.getByTestId('move-open').click();
          await page.getByTestId('move-from').selectOption('wants');
          await page.getByTestId('move-to').selectOption('needs');
          await page.getByTestId('move-amount').fill((cents / 100).toFixed(2));
          const asked = twin.book.pots().wants - cents < 0;
          await page.getByTestId('move-submit').click();
          if (asked) {
            // It would leave wants below zero, so it asks first (13.4): he says yes.
            await page.getByTestId('move-confirm-yes').click();
          }
          await page.getByTestId('notice').waitFor();
          twin.book.moveMoney({ from: 'wants', to: 'needs', amount: cents, confirmed: asked }, twin.today);
        }
        taps += 1;
        await untilQuiet(page);
      }
      // Each tap was one decision, with a decision number of its own, however many requests it took.
      expect(new Set(one.opened?.watch.ids() ?? []).size, where).toBe(taps);
      expect(life.book.pots(), where).toEqual(twin.book.pots());
      expect(life.book.recountPots(), where).toEqual(life.book.pots());
      expect(life.book.changeLog(), where).toEqual(twin.book.changeLog());
      expect(life.book.selfCheck(life.bank).ok, where).toBe(true);
      for (const pot of MOVABLE_POTS) {
        const page = await show(pot);
        expect(numbersOf(await readActivity(page)), `${where} ${pot}`).toEqual(numbersOf(activityOf(twin.book, pot)));
      }
    } finally {
      await context.close();
      await close(live.server);
    }
  });
});
