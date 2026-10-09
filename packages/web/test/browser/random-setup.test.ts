import { DEFAULT_SETTINGS, addDays, formatDollars, type AccountId, type Pot } from '@budget-app/money';
import type { Server } from 'node:http';
import { describe, expect, it } from 'vitest';
import { checkBankRules } from '../../../server/src/bank/reading.js';
import { madeUpHistory, type MadeUpBank, type MadeUpItem } from '../../../server/src/demo/made-up-bank.js';
import { createAppServer } from '../../../server/src/http/server.js';
import { SetupDesk } from '../../../server/src/setup-desk.js';
import { homeView } from '../../../server/src/views/home.js';
import { ENGINES, WEB_ROOT, centsAt, close, listen, phone, textAt, useEngine } from './harness.js';
import { openLive } from './live.js';
import { answerHalf, pickPaycheck, putTheRest, readAssign, ready, settled, tell, typeAmount } from './setup-screens.js';

// Random banks, set up through the screens with random answers and random
// assignments (rulebook 14.2, 14.3; QUESTIONS.md B43, B48): every number
// shown is the money math's (a twin desk given the same answers directly),
// starting is refused unless it adds up to the cent, and once it starts Home
// shows safe to spend backed by the self-check. Every number is made up.
// WEB_LIVES sets how many banks, WEB_FIRST_SEED where the seeds start.

const TODAY = '2026-10-07';
const LIVES = Number(process.env['WEB_LIVES'] ?? 2);
const FIRST_SEED = Number(process.env['WEB_FIRST_SEED'] ?? 1);
const POTS: readonly Pot[] = ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers'];
const RULES = checkBankRules([
  { id: 'chk-to-card', account: 'checking', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' },
  { id: 'card-from-chk', account: 'everyday-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
  { id: 'sav-from-chk', account: 'savings', contains: 'transfer from CHK', means: 'transfer', other: 'checking' },
  { id: 'chk-to-old', account: 'checking', contains: 'payment to CRD 4444', means: 'transfer', other: 'old-card' },
]);
const HALVES = [
  { account: 'checking', description: 'Online payment to CRD 3333', sign: 1 },
  { account: 'everyday-card', description: 'PAYMENT - THANK YOU', sign: -1 },
  { account: 'savings', description: 'Online Banking transfer from CHK', sign: -1 },
  { account: 'checking', description: 'Online payment to CRD 4444', sign: 1 },
] as const;

// A small seeded random number source, so a failing seed can be replayed.
function random(seed: number): (below: number) => number {
  let s = seed >>> 0;
  return (below) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % below;
  };
}

function randomBank(seed: number): MadeUpBank {
  const r = random(seed);
  const accounts: AccountId[] = ['checking', 'savings', 'everyday-card', 'old-card'];
  const items: MadeUpItem[] = [];
  for (let i = 0, n = r(4); i < n; i += 1) {
    items.push({ id: `p${i}`, account: accounts[r(4)] as AccountId, amount: 1 + r(50_000), date: addDays(TODAY, -r(4)), description: 'MADE UP STORE', pending: true });
  }
  for (let i = 0, n = r(4); i < n; i += 1) {
    const half = HALVES[r(HALVES.length)];
    if (half !== undefined) items.push({ id: `h${i}`, account: half.account, amount: half.sign * (1 + r(200_000)), date: addDays(TODAY, -r(9)), description: half.description });
  }
  // Sometimes the card owes more than the accounts hold (B43).
  const card = r(3) === 0 ? 1_000_000 + r(500_000) : r(300_000);
  return { balances: { checking: r(800_000) - 20_000, savings: r(1_500_000), 'everyday-card': card, 'old-card': r(400_000) }, rules: RULES, items };
}

async function startLive(bank: MadeUpBank): Promise<{ readonly server: Server; readonly base: string }> {
  const desk = new SetupDesk({ bank: madeUpHistory(bank), today: () => TODAY, settings: DEFAULT_SETTINGS, halvesWithinDays: 10, madeUpData: true });
  const server = createAppServer({
    webRoot: WEB_ROOT,
    home: () => {
      const started = desk.started();
      return homeView({ today: TODAY, book: started?.book ?? null, bank: started?.bank ?? null, needsLogin: false, statements: [], madeUpData: true, seenTakeBacks: new Set(), lastChecked: null });
    },
    setupView: () => desk.view(),
    setup: (_request, answer) => desk.decide(answer),
  });
  return { server, base: await listen(server) };
}

const typed = (cents: number): string => formatDollars(cents).replace('$', '');

describe.each(ENGINES)('random banks set up through the screens in %s', (_name, engine) => {
  const { browser } = useEngine(engine);

  it.each(Array.from({ length: LIVES }, (_, i) => FIRST_SEED + i))('14.3 B48 seed %i: every number is the money math\'s, refused unless exact, and Home is backed by the self-check', async (seed) => {
    const bank = randomBank(seed);
    const r = random(seed * 7919);
    const twin = new SetupDesk({ bank: madeUpHistory(bank), today: () => TODAY, settings: DEFAULT_SETTINGS, halvesWithinDays: 10, madeUpData: true });
    const { server, base } = await startLive(bank);
    const context = await browser().newContext(phone());
    const where = `seed ${seed}`;
    try {
      const page = await openLive(context, base, '/setup/transfers');
      for (const half of ready(twin).halves) {
        const onItsWay = r(2) === 0;
        await answerHalf(page, half.id, onItsWay);
        tell(twin, { onItsWay: { half: half.id, answer: onItsWay } });
        expect(await centsAt(page, 'starting-money'), where).toBe(ready(twin).startingMoney);
      }
      await page.getByTestId('next').click();
      const paid = addDays(TODAY, -r(20));
      expect(await pickPaycheck(page, paid), where).toBeNull();
      tell(twin, { lastPaycheck: paid });
      await page.getByTestId('next').click();
      await settled(page);
      // Four random amounts, then the last bucket: exact, or a cent or two off.
      for (const pot of POTS.slice(0, 4)) {
        const cents = r(300_000) - 50_000;
        expect(await typeAmount(page, pot, typed(cents)), where).toBe(cents === 0 ? 'That is already the amount. Nothing was changed.' : null);
        if (cents !== 0) {
          tell(twin, { assign: { pot, amount: cents } });
        } else await page.getByRole('button', { name: 'Close' }).click();
        const v = ready(twin);
        expect(await readAssign(page), where).toEqual({ left: v.leftToAssign, assigned: v.assigned, startingMoney: v.startingMoney, pots: v.assignment });
      }
      const off = r(3) - 1;
      if (off === 0) {
        expect(await putTheRest(page, 'heldForOthers'), where).toBe(ready(twin).leftToAssign === 0 ? 'Nothing is left to assign. Nothing was changed.' : null);
        if (ready(twin).leftToAssign !== 0) tell(twin, { assign: { pot: 'heldForOthers', rest: true } });
        else await page.getByRole('button', { name: 'Close' }).click();
      } else {
        const amount = ready(twin).leftToAssign + off;
        const answer = await typeAmount(page, 'heldForOthers', typed(amount));
        if (amount === 0) {
          expect(answer, where).toBe('That is already the amount. Nothing was changed.');
          await page.getByRole('button', { name: 'Close' }).click();
        } else tell(twin, { assign: { pot: 'heldForOthers', amount } });
      }
      const left = ready(twin).leftToAssign;
      expect(await centsAt(page, 'left-to-assign'), where).toBe(left);
      await page.getByTestId('next').click();
      await settled(page);
      await page.getByTestId('start').click();
      if (left !== 0) {
        await page.getByTestId('setup-problem').waitFor();
        expect(await textAt(page, 'setup-problem'), where).toBe(left > 0 ? `${formatDollars(left)} is still to assign. Nothing was changed.` : `${formatDollars(-left)} more is assigned than there is. Nothing was changed.`);
        await settled(page);
        return;
      }
      await page.getByTestId('confirm-yes').click();
      await page.waitForURL(/\/home$/);
      await page.locator('main[data-testid="home"][aria-busy="false"]').waitFor();
      await settled(page);
      const assignment = ready(twin).assignment;
      expect(tell(twin, { start: true }, { confirmed: true, seen: ready(twin).key }).ok, where).toBe(true);
      const started = twin.started();
      if (started === null) throw new Error('the twin did not start');
      expect(started.book.selfCheck(started.bank).ok, where).toBe(true);
      // The buckets are what was handed out.
      expect(started.book.pots(), where).toEqual({ ...assignment, unsortedIn: 0, unsortedOut: 0 });
      // Safe to spend is shown only when the self-check backs it (0.5).
      expect(await centsAt(page, 'safe-to-spend'), where).toBe(started.book.safeToSpend(TODAY).amount);
    } finally {
      await context.close();
      await close(server);
    }
  });
});
