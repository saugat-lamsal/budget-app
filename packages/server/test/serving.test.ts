import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryLog } from '../src/log.js';
import { serveBooks } from '../src/serve/serving.js';
import type { AlertTimer } from '../src/serve/alert-timer.js';
import type { SyncTimer } from '../src/serve/sync-timer.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { FakeClock } from './fake-clock.js';
import { FakePhone } from './fake-phone.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { loginForTests } from './login-for-tests.js';

// serveBooks (serve/serving.ts): what npm run serve runs once the books are
// open, and what the full pay period through the screens runs too: the
// screens behind the login, and the timer that syncs with the bank by itself
// (Step 3). Here with a made-up bank and a clock that moves only when the
// test moves it. Every name and number is made up.

const HOUR = 3_600_000;
const E = ACCOUNT_IDS.everyday;

const running: { life: Life; server: Server; timer: SyncTimer; alerts: AlertTimer }[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) {
    await r.timer.stop();
    await r.alerts.stop();
    await new Promise<void>((resolve) => r.server.close(() => resolve()));
    r.life.done();
  }
});

async function served(): Promise<{ life: Life; clock: FakeClock; timer: SyncTimer; alerts: AlertTimer; phone: FakePhone; base: string }> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-02');
  const clock = new FakeClock(life);
  let base = '';
  const phone = new FakePhone(() => life.now);
  const { server, timer, alerts } = serveBooks({ keeper: life.keeper, bank: { plaid: life.h.plaid, box: life.h.box, log: memoryLog([]), pageSize: 3 }, clock, webRoot: 'C:/made-up/no-screens/', origin: () => base, sender: phone });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  base = `http://localhost:${typeof address === 'object' && address !== null ? address.port : 0}`;
  running.push({ life, server, timer, alerts });
  return { life, clock, timer, alerts, phone, base };
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

  it('Phase 5 10.6 its alert timer starts the alerts, and a sync that brings an alert sends it in the same moment', async () => {
    const { life, clock, timer, alerts, phone } = await served();
    alerts.start();
    await alerts.idle();
    expect(life.keeper.alertsView()).toMatchObject({ state: 'tracking', alerts: [], total: 0 });
    timer.start();
    await timer.idle();
    life.h.fake.addPosted({ id: 'copy-1', account: E, amount: 1_150, date: '2026-10-02', description: 'MADE UP CAFE' });
    await clock.advance(HOUR, async () => {
      await timer.idle();
      await alerts.idle();
    });
    life.h.fake.removePosted('copy-1', { keepBalance: false });
    const syncedAt = new Date(life.now.getTime() + HOUR).toISOString();
    await clock.advance(HOUR, async () => {
      await timer.idle();
      await alerts.idle();
    });
    expect(phone.shown.map((s) => [s.id, s.title, s.at])).toEqual([['bank-took-back copy-1', 'The bank took something back', syncedAt]]);
    expect(life.keeper.alertsView()).toMatchObject({ state: 'tracking', total: 1, alerts: [{ key: 'bank-took-back copy-1', sentAt: '2026-10-02T14:00:00-04:00', dueAt: '2026-10-02T14:00:00-04:00' }] });
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
