import type { Browser, BrowserContext, Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loginCookieForTests } from '../../../server/test/login-for-tests.js';
import { ENGINES, WEB_ROOT, centsAt, close, launch, listen, phone, textAt, untilQuiet, waitOrReport } from './harness.js';
import { byHand } from './pay-period/by-hand.js';
import { SCREENS, apiOf, differences, expectedViews, realViews, sameRuleIds } from './pay-period/expected.js';
import { period, simulatorBookAt, type PeriodDay } from './pay-period/period.js';
import { RealServer, ZELLE_FROM_CHECKING, atNewYork } from './pay-period/real-server.js';
import { ShouldShow, answerOnTheScreens, noticeText, readScreen, screenDifference, typed } from './pay-period/screens.js';
import { answerHalf, pickPaycheck, putTheRest, settled, typeAmount } from './setup-screens.js';

// Phase 4's finish line: one full pay period through the screens, on the real
// server, with every number checked against the simulator's own book.
//
// - The real server is npm run serve's code (serving.ts) with its books in a
//   database file, and the made-up bank in Plaid's format. It starts empty:
//   no books, no passkey, only the bank connection. Time moves only when the
//   test moves it, and the bank's activity reaches the books only by the
//   server's own sync timer (real-server.ts).
// - What happens is the simulator's planned pay period
//   (packages/money/test/sim/pay-period.ts): its bank's activity day by day,
//   and each answer its simulated person gave, which here are given on the
//   screens, tap by tap: Review, sorting again from a bucket's list, a move by
//   hand, settings, a sorting rule added and moved, the payday questions.
// - Logged in with the first one-time code and a passkey (Chromium's virtual
//   passkey); WebKit has none, so it uses the tests' own way in
//   (login-for-tests.ts, the one the login guard allows).
// - Setup day through its screens: a bank rule, the transfer on its way, the
//   last paycheck, the starting money, the check.
// - Stopped and started again from the database twice along the way.
// - Every day, every screen the real server sends is compared with what the
//   same code works out from the simulator's own book, number by number; then
//   every screen is read off the page and compared with the same screen given
//   the simulator's numbers. Any difference fails with the day, the screen and
//   both numbers. The self-check passes every day.
// - One tap is refused because a sync changed the item after the screen showed
//   it (13.7, A31), and the take-back is marked seen on Home (10.6).
// Each test is a few days; together, in order, they are the whole pay period.
// Every name and number is made up.

const P = period();
const DAYS = P.days;
// Stopped and started again from the database after these days.
const RESTART_AFTER = new Set(['2026-10-05', '2026-10-12']);
// 13.7 (A31): the day Review is open when a sync brings the cinema's posting.
const A31_DAY = '2026-10-07';
const A31_ITEM = 'p19';
// Each day after setup day, in two tests (its answers, then every screen): two
// whole days in one test took up to 24 s in WebKit on this fast PC, and the CI
// machines are slower; one half-day takes at most 13 s here.
const ONE_DAY_EACH: readonly number[] = DAYS.slice(1).map((d) => d.index);
// What each day has in it, by the rules it shows (sim/pay-period.ts).
const WHAT: Readonly<Record<string, string>> = {
  '2026-10-02': '3.1 3.2 3.3 3.8 the paycheck, 12.5 the card payment lands',
  '2026-10-03': '14.2 a charge from setup day posts with a tip, 3.4 B4 the payday questions on Payday',
  '2026-10-04': '4.4 a split on Review',
  '2026-10-05': '4.6 a pending charge posts with a tip, 8.1 a payment to mom',
  '2026-10-06': '4.2 4.3 purchases waiting in Review',
  '2026-10-07': '13.7 A31 a tap refused because a sync changed the item, 13.3 a hand move',
  '2026-10-08': '4.5 A18 a refund on the everyday card matched on Review',
  '2026-10-09': '7.5 a friend pays back, 5.2 12.5 an old card payment on its way, 13.1 a new split on Settings',
  '2026-10-10': '4.10 10.6 the bank takes a charge back, seen on Home; 13.2 a sorting rule added and moved',
  '2026-10-11': '4.7 B7 sorting again from a bucket\'s list',
  '2026-10-12': 'B13 an old card refund, 12.5 an everyday card payment on its way',
  '2026-10-13': '4.5 6.1 A29 a debit card refund matched to its purchase',
  '2026-10-14': '12.5 the card payment lands',
  '2026-10-15': '4.6 a charge still pending at the end',
  '2026-10-16': '3.1 3.2 the next paycheck, the mom reserve at its cap, 13.1 the new split, 3.4 the payday questions',
};

interface State {
  readonly real: RealServer;
  readonly context: BrowserContext;
  readonly page: Page;
  readonly twin: ShouldShow;
  // Take-backs marked seen on Home (10.6).
  readonly seen: Set<string>;
  // The simulator's rule ids, by the text of each rule it added.
  readonly ruleText: Map<string, string>;
}

// A virtual passkey on this browser: Face ID that always says yes.
async function withPasskey(context: BrowserContext, page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

describe.each(ENGINES)('Phase 4 finish line: the full pay period through the screens, on the real server, in %s', (name, engine) => {
  let browser: Browser | undefined;
  let state: State | undefined;
  let broken: string | null = null;

  beforeAll(async () => {
    browser = await launch(engine);
  });
  afterAll(async () => {
    await state?.context.close();
    await state?.real.done();
    await browser?.close();
  });

  // Each part runs on what the parts before it left; once one fails, the rest say so.
  const part = (title: string, run: () => Promise<void>): void => {
    it(title, async () => {
      if (broken !== null) throw new Error(`not lived: an earlier part of the pay period failed ("${broken}")`);
      try {
        await run();
      } catch (error) {
        broken = title;
        throw error;
      }
    });
  };

  const s = (): State => {
    if (state === undefined) throw new Error('no pay period yet');
    return state;
  };

  // Every screen on a day: the real server's numbers against the simulator's,
  // then each screen as read off the page against the same screen given the
  // simulator's numbers. Then the self-check.
  async function compareDay(day: PeriodDay): Promise<void> {
    const { real, page, twin, seen } = s();
    const ours = real.keeper.book();
    if (ours === null) throw new Error(`${day.date}: not tracking`);
    const simulator = simulatorBookAt(day.index);
    const expected = expectedViews(simulator, day.date, day.balances, real, seen);
    const actual = sameRuleIds(realViews(real), ours, simulator);
    const problems: string[] = [];
    for (const path of SCREENS) {
      const api = apiOf(path);
      for (const d of differences(actual[api], JSON.parse(JSON.stringify(expected[api])) as unknown)) problems.push(`${day.date}, ${path}: ${d}`);
    }
    expect(problems, `the real server's screens against the simulator's book`).toEqual([]);
    twin.views = expected;
    for (const path of SCREENS) {
      // The app opened afresh at the first screen, Home, then each screen the way its links go.
      const reload = path === SCREENS[0];
      const [shown, should] = await Promise.all([readScreen(page, real.base, path, reload), readScreen(twin.page, real.base, path, reload)]);
      const difference = screenDifference(shown, should);
      if (difference !== null) problems.push(`${day.date}, ${path}: ${difference}`);
      for (const p of await byHand(page, path, simulator, day.date, day.balances)) problems.push(`${day.date}, ${path}: ${p}`);
      if (path === '/buckets') expect(shown, `${day.date}: the self-check on Buckets`).toContain('Matches your bank, to the cent');
    }
    expect(problems, 'what the screens show against the simulator\'s book').toEqual([]);
    // 12.3: the self-check passes, on the real server's own reading of the bank.
    expect(ours.selfCheck(day.balances), `${day.date}: the self-check`).toMatchObject({ ok: true, difference: 0 });
    expect(real.keeper.home(), `${day.date}: safe to spend is shown (0.5)`).toMatchObject({ state: 'tracking', safeToSpend: { shown: true } });
  }

  // One day of the pay period: the bank's activity by the sync timer, each
  // answer on the screens, then every screen compared.
  async function liveDay(day: PeriodDay): Promise<void> {
    const { real, page, ruleText } = s();
    // The morning: the timer syncs on the way, with nothing new at the bank yet.
    const morning = atNewYork(day.date, 7);
    if (morning > real.clock.now) await real.moveTo(morning);
    let given = 0;
    if (day.date === A31_DAY) {
      // Review is open, showing the cinema charge still pending, when the
      // bank posts it at a new amount and the timer syncs.
      await page.goto(`${real.base}/review`);
      await waitOrReport(page, `[data-testid="item-${A31_ITEM}"]`);
      await untilQuiet(page);
      expect(await textAt(page, `item-${A31_ITEM}`)).toContain('$18.00');
      real.give(day.feed);
      given = day.feed.length;
      await real.untilSynced();
      const events = real.keeper.book()?.changeLog().length;
      const pots = real.keeper.book()?.pots();
      await page.getByTestId(`item-${A31_ITEM}`).getByTestId('pick-wants').click();
      expect(await noticeText(page)).toBe('MADE UP CINEMA changed since you looked: it is now $21.50. Look at it again, then choose. Nothing was changed.');
      expect(real.keeper.book()?.changeLog().length, '13.7 nothing changed').toBe(events);
      expect(real.keeper.book()?.pots(), '13.7 nothing changed').toEqual(pots);
      await untilQuiet(page);
      expect(await textAt(page, `item-${A31_ITEM}`)).toContain('$21.50');
    }
    for (const answer of day.answers) {
      if (answer.afterFeed > given) {
        real.give(day.feed.slice(given, answer.afterFeed));
        given = answer.afterFeed;
        await real.untilSynced();
      }
      await answerOnTheScreens(page, real, answer, ruleText);
      if (answer.method === 'addRule') {
        const rule = answer.args[0] as { readonly id: string; readonly contains: string };
        ruleText.set(rule.id, rule.contains);
      }
    }
    if (given < day.feed.length) {
      real.give(day.feed.slice(given));
      await real.untilSynced();
    }
  }

  // The end of the day: every screen compared, the take-back marked seen, and
  // on some days a restart.
  async function endDay(day: PeriodDay): Promise<void> {
    const { real } = s();
    await compareDay(day);
    await markTakeBacksSeen(day);
    if (RESTART_AFTER.has(day.date)) {
      const before = realViews(real);
      await real.restart();
      expect(differences(realViews(real), before), `${day.date}: every screen the same after a restart`).toEqual([]);
    }
  }

  // 10.6: a take-back stays in Needs attention on Home until he marks it seen.
  async function markTakeBacksSeen(day: PeriodDay): Promise<void> {
    const { real, page, seen } = s();
    const home = real.keeper.home();
    if (home.state !== 'tracking') return;
    for (const item of home.attention) {
      if (item.kind !== 'bank-took-back') continue;
      await page.goto(`${real.base}/home`);
      const row = page.getByTestId(`attention-bank-took-back-${item.id}`);
      await row.click();
      await page.getByTestId(`took-back-sheet-${item.id}`).getByTestId('seen').click();
      await row.waitFor({ state: 'detached' });
      await untilQuiet(page);
      seen.add(item.id);
      expect(day.date, '10.6 the take-back in this pay period').toBe('2026-10-10');
    }
  }

  part('section 14 Step 2 setup day through the screens, from an empty database: the first code and a passkey, a bank rule, the transfer on its way, the last paycheck, the starting money, the check', async () => {
    const setupDay = DAYS[0] as PeriodDay;
    const real = await RealServer.start(P, atNewYork(setupDay.date, 9), { webRoot: WEB_ROOT, listen: async (server) => listen(server), close });
    const context = await browser!.newContext(phone());
    const page = await context.newPage();
    state = { real, context, page, twin: await ShouldShow.open(context), seen: new Set(), ruleText: new Map() };
    expect(real.keeper.hasPasskeys()).toBe(false);
    expect(real.keeper.book()).toBeNull();

    // The first login.
    if (name === 'chromium') {
      await withPasskey(context, page);
      await page.goto(`${real.base}/home`);
      await page.waitForURL(/\/login$/);
      await waitOrReport(page, '[data-testid="login-code"]');
      await page.getByTestId('code').fill(real.keeper.loginCode());
      await page.getByTestId('make-passkey').click();
      await page.waitForURL(/\/home$/);
      expect(real.keeper.hasPasskeys()).toBe(true);
    } else {
      await context.addCookies([loginCookieForTests(real.db, real.clock.now, real.base)]);
      await page.goto(`${real.base}/home`);
    }
    await waitOrReport(page, '[data-testid="start-setup"]');
    await untilQuiet(page);

    // Setup day, step by step.
    await page.getByTestId('start-setup').click();
    await page.waitForURL(/\/setup\/bank$/);
    await waitOrReport(page, 'main[aria-busy="false"]');
    await settled(page);
    await page.getByTestId('next').click();
    await page.waitForURL(/\/setup\/rules$/);
    await waitOrReport(page, '[data-testid="row-add-bank-rule"]');
    await settled(page);
    // Payments to people from checking: a bank rule he adds (it asks first).
    await page.getByTestId('row-add-bank-rule').click();
    await page.getByTestId('field-bank-account').selectOption('checking');
    await page.getByTestId('field-bank-text').fill(ZELLE_FROM_CHECKING.trim());
    await page.getByTestId('field-bank-means').selectOption('payment-to-person');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('confirm-yes').click();
    await page.waitForFunction(() => document.querySelector('dialog[open]') === null);
    await settled(page);
    await page.getByTestId('next').click();
    await page.waitForURL(/\/setup\/transfers$/);
    await waitOrReport(page, '[data-testid="look-back"]');
    await settled(page);
    const onTheirWay = new Set((P.setup.input.transfersInTransit ?? []).map((h) => h.id));
    const halves = await page.locator('[data-testid^="half-"]').evaluateAll((cards) => cards.map((c) => (c.getAttribute('data-testid') ?? '').replace('half-', '')));
    expect(halves.sort()).toEqual([...onTheirWay].sort());
    for (const half of halves) await answerHalf(page, half, onTheirWay.has(half));
    await page.getByTestId('next').click();
    await page.waitForURL(/\/setup\/paycheck$/);
    expect(await pickPaycheck(page, P.setup.input.lastPaycheckDate)).toBeNull();
    await page.getByTestId('next').click();
    await page.waitForURL(/\/setup\/assign$/);
    const assignment = P.setup.input.assignment;
    expect(await typeAmount(page, 'savings', typed(assignment.savings))).toBeNull();
    expect(await typeAmount(page, 'momReserve', typed(assignment.momReserve))).toBeNull();
    expect(await typeAmount(page, 'wants', typed(assignment.wants))).toBeNull();
    expect(await putTheRest(page, 'needs')).toBeNull();
    await page.getByTestId('next').click();
    await page.waitForURL(/\/setup\/check$/);
    await settled(page);
    // 14.3: the check, with the simulator's own numbers.
    const sim = simulatorBookAt(0);
    const check = sim.selfCheck(setupDay.balances);
    expect(await centsAt(page, 'check-app')).toBe(check.appSide);
    expect(await centsAt(page, 'check-transit')).toBe(check.inTransit);
    expect(await centsAt(page, 'check-difference')).toBe(0);
    for (const pot of ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers'] as const) expect(await centsAt(page, `check-${pot}`), pot).toBe(assignment[pot]);
    await page.getByTestId('start').click();
    await page.getByTestId('confirm-yes').click();
    await page.waitForURL(/\/home$/);
    await waitOrReport(page, 'main[data-testid="home"][aria-busy="false"]');
    await untilQuiet(page);
    expect(real.keeper.book()?.pots()).toEqual(sim.pots());
  });

  // Each day in two tests: its bank activity and answers, then every screen.
  const day0 = DAYS[0] as PeriodDay;
  part('13.1 13.2 3.1 8.1 Oct 1, setup day evening: the paycheck rule, the mom rule and three sorting rules, set on Settings', async () => {
    await liveDay(day0);
  });
  part('Oct 1: every screen against the simulator\'s book', async () => {
    await endDay(day0);
  });

  for (const index of ONE_DAY_EACH) {
    const day = DAYS[index] as PeriodDay;
    part(`the pay period, ${day.date}: ${WHAT[day.date] ?? 'the bank by the sync timer'}; the bank by the sync timer, every answer on the screens`, async () => {
      await liveDay(day);
    });
    part(`the pay period, ${day.date}: every screen against the simulator's book${RESTART_AFTER.has(day.date) ? ', then a restart' : ''}`, async () => {
      await endDay(day);
    });
  }

  part('the pay period as a whole: two restarts, a sync timer that brought every bank day, and nothing left over', async () => {
    const { real } = s();
    expect(real.restarts).toBe(2);
    expect(real.syncs).toBeGreaterThanOrEqual(DAYS.filter((d) => d.feed.length > 0).length);
    expect(s().seen.size).toBe(1);
  });
});

