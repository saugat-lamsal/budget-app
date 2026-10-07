import { bucketLevel, startTracking, type BankBalances, type Book, type IsoDate, type SetupInput } from '@budget-app/money';
import type { Server } from 'node:http';
import type { Browser, BrowserContext } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { liveALife, type RecordedBankDay } from '../../../money/test/sim/life.js';
import { Random } from '../../../money/test/sim/random.js';
import { createAppServer } from '../../../server/src/http/server.js';
import { homeView, type HomeInput } from '../../../server/src/views/home.js';
import { ENGINES, WEB_ROOT, centsAt, close, listen, phone, waitOrReport, watchPage } from './harness.js';

// Random made-up lives (the Phase 2 simulator), each stopped on a random day
// and shown on Home. Whatever the day looks like, every number on the
// screen must be what the money math says for that book.
// WEB_LIVES and WEB_FIRST_SEED run more, or replay one.

const LIVES = Number(process.env['WEB_LIVES'] ?? 6);
const FIRST_SEED = Number(process.env['WEB_FIRST_SEED'] ?? 1);

interface Day {
  readonly seed: number;
  readonly day: number;
  readonly book: Book;
  readonly today: IsoDate;
  readonly bank: BankBalances;
}

// The simulator's bank, day by day, played into a fresh book up to a random
// day. Nobody answers anything in review, so things pile up there, which is
// a fine thing for Home to show too.
function randomDay(seed: number): Day {
  let setup: SetupInput | undefined;
  const days: RecordedBankDay[] = [];
  const result = liveALife({ seed, years: 0.4, record: { setupDay: (s) => (setup = s.input), day: (d) => days.push(d) } });
  if (!result.ok || setup === undefined) throw new Error(`life ${seed} did not finish`);
  const started = startTracking(setup);
  if (!started.ok) throw new Error(`life ${seed} could not start tracking`);
  const stopAt = new Random(seed * 7919).int(0, days.length - 1);
  for (const day of days.slice(0, stopAt + 1)) for (const txn of day.feed) started.book.receive(txn);
  const day = days[stopAt] as RecordedBankDay;
  return { seed, day: stopAt, book: started.book, today: day.date, bank: day.balances };
}

// 11.2, written out here on its own.
function paydayWords(days: number): string {
  if (days === 0) return 'Payday is today';
  if (days < 0) return `Paycheck is ${-days} day${days === -1 ? '' : 's'} late`;
  return `${days} day${days === 1 ? '' : 's'} to payday`;
}

describe.each(ENGINES)('random lives on Home in %s', (_name, engine) => {
  let server: Server;
  let base = '';
  let browser: Browser;
  let context: BrowserContext;
  // Each life is served at its own address, so no life can be shown in
  // place of another.
  const showing = new Map<string, HomeInput>();
  beforeAll(async () => {
    server = createAppServer({
      webRoot: WEB_ROOT,
      home: (request) => {
        const life = /(?:^|; )life=(\d+)/.exec(request.headers.cookie ?? '')?.[1];
        const input = life === undefined ? undefined : showing.get(life);
        if (input === undefined) throw new Error(`no life ${String(life)} to show`);
        return homeView(input);
      },
    });
    base = await listen(server);
    browser = await engine.launch();
    context = await browser.newContext(phone());
  });
  afterAll(async () => {
    await browser?.close();
    await close(server);
  });

  const seeds = Array.from({ length: LIVES }, (_, i) => FIRST_SEED + i);
  it.each(seeds)('11.1 11.2 10.1 10.3 12.3 every number on Home matches the money math, life %i', async (seed) => {
    const life = randomDay(seed);
    const where = `seed ${life.seed}, day ${life.day} (${life.today})`;
    const { book, today, bank } = life;
    showing.set(String(seed), { today, book, bank, needsLogin: false, statements: [], madeUpData: true });
    await context.addCookies([{ name: 'life', value: String(seed), url: base }]);
    const page = await context.newPage();
    // A stuck wait names what it waited for, well inside the test's own limit.
    page.setDefaultTimeout(15_000);
    try {
      watchPage(page);
      await page.goto(`${base}/home?life=${seed}`);
      await waitOrReport(page, base, '[data-testid="safe-to-spend"], [data-testid="mismatch"], [data-testid="home-error"]');
      expect(await page.getByTestId('home-error').count(), `${where}: Home could not load`).toBe(0);

      // The simulator's bank always agrees with the book (section 12).
      const check = book.selfCheck(bank);
      expect(check.ok, where).toBe(true);
      expect(await centsAt(page, 'safe-to-spend'), where).toBe(book.safeToSpend(today).amount);
      const days = book.safeToSpend(today).daysToPayday;
      expect((await page.getByTestId('payday').innerText()).startsWith(paydayWords(days)), where).toBe(true);

      const pots = book.pots();
      const started = book.startedPeriodWith();
      const percent = book.settings().lowBucketAlertPercent;
      for (const bucket of ['needs', 'wants'] as const) {
        expect(await centsAt(page, `bucket-${bucket}-left`), `${where} ${bucket}`).toBe(pots[bucket]);
        expect(await page.getByTestId(`bucket-${bucket}`).getAttribute('data-level'), `${where} ${bucket}`).toBe(bucketLevel(pots[bucket], started[bucket], percent));
      }

      const waiting = book.reviewItems().length;
      if (waiting === 0) expect(await page.getByTestId('attention-review').count(), where).toBe(0);
      else {
        expect(await page.getByTestId('attention-review').locator('.row__title').innerText(), where).toBe(`${waiting} waiting in review`);
        if (pots.unsortedOut > 0) expect(await centsAt(page, 'held-back'), where).toBe(pots.unsortedOut);
        expect(await page.getByTestId('review-badge').innerText(), where).toBe(waiting > 99 ? '99+' : String(waiting));
      }
    } finally {
      await page.close();
    }
  });
});
