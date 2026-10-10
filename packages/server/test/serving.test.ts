import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryLog } from '../src/log.js';
import { serveBooks } from '../src/serve/serving.js';
import type { SyncTimer } from '../src/serve/sync-timer.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { FakeClock } from './fake-clock.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { loginForTests } from './login-for-tests.js';

// serveBooks (serve/serving.ts): what npm run serve runs once the books are
// open, and what the full pay period through the screens runs too: the
// screens behind the login, and the timer that syncs with the bank by itself
// (Step 3). Here with a made-up bank and a clock that moves only when the
// test moves it. Every name and number is made up.

const HOUR = 3_600_000;
const E = ACCOUNT_IDS.everyday;

const running: { life: Life; server: Server; timer: SyncTimer }[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) {
    await r.timer.stop();
    await new Promise<void>((resolve) => r.server.close(() => resolve()));
    r.life.done();
  }
});

async function served(): Promise<{ life: Life; clock: FakeClock; timer: SyncTimer; base: string }> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-02');
  const clock = new FakeClock(life);
  let base = '';
  const { server, timer } = serveBooks({ keeper: life.keeper, bank: { plaid: life.h.plaid, box: life.h.box, log: memoryLog([]), pageSize: 3 }, clock, webRoot: 'C:/made-up/no-screens/', origin: () => base });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  base = `http://localhost:${typeof address === 'object' && address !== null ? address.port : 0}`;
  running.push({ life, server, timer });
  return { life, clock, timer, base };
}

describe('npm run serve, once the books are open (serveBooks)', () => {
  it('section 2 Step 3 its timer syncs at once when started, then only once each interval of the clock it is given; each sync reads the bank into the books', async () => {
    const { life, clock, timer } = await served();
    timer.start();
    await timer.idle();
    const first = life.keeper.lastRead();
    expect(first).toBe(life.now.toISOString());
    // Something new at the bank: not read until the hour is up.
    life.h.fake.addPosted({ id: 'cafe-1', account: E, amount: 1_150, date: '2026-10-02', description: 'MADE UP CAFE' });
    await clock.advance(HOUR - 1, () => timer.idle());
    expect(life.keeper.lastRead()).toBe(first);
    expect(life.keeper.book()?.purchases().some((p) => p.id === 'cafe-1')).toBe(false);
    await clock.advance(1, () => timer.idle());
    expect(life.keeper.lastRead()).toBe(new Date(Date.parse(first ?? '') + HOUR).toISOString());
    expect(life.keeper.book()?.purchases().some((p) => p.id === 'cafe-1')).toBe(true);
  });

  it('Step 2 its server keeps every screen\'s numbers behind the login, and serves them to a login', async () => {
    const { life, base } = await served();
    expect((await fetch(`${base}/api/home`)).status).toBe(401);
    const cookie = loginForTests(life.h.db, life.now);
    const answer = await fetch(`${base}/api/home`, { headers: { cookie } });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toMatchObject({ state: 'tracking' });
  });
});
