import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoServer } from '../src/demo/demo-server.js';
import { DEMO_SCENARIOS, SETUP_SCENARIOS, demoScenario } from '../src/demo/scenarios.js';
import type { SetupResponse, SetupStep } from '../src/views/choice.js';
import type { HomeView } from '../src/views/home.js';
import type { SetupReadyView, SetupView } from '../src/views/setup.js';

// The demo's lives that are not set up yet (rulebook section 14): Setup day
// on a made-up bank, through the same addresses as the real screens. Every
// name and number is made up.

let server: Server;
let base: string;
let folder: string;

beforeAll(async () => {
  // A stand-in for the built screens: these tests are about the addresses and numbers.
  folder = mkdtempSync(join(tmpdir(), 'budget-setup-'));
  mkdirSync(join(folder, 'dist'), { recursive: true });
  writeFileSync(join(folder, 'dist', 'index.html'), '<!doctype html><title>app</title>');
  server = createDemoServer({ webRoot: join(folder, 'dist') });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(folder, { recursive: true, force: true });
});

async function json<T>(path: string, life: string): Promise<T> {
  return (await (await fetch(`${base}${path}`, { headers: { cookie: `demo=${life}` } })).json()) as T;
}

async function ready(life: string): Promise<SetupReadyView> {
  const view = await json<SetupView>('/api/setup', life);
  if (view.state !== 'not-set-up' || !view.ready) throw new Error(`not ready: ${JSON.stringify(view)}`);
  return view;
}

let n = 0;
async function answer(life: string, setup: SetupStep, more: object = {}): Promise<{ status: number; body: SetupResponse }> {
  const res = await fetch(`${base}/api/choice`, {
    method: 'POST',
    headers: { cookie: `demo=${life}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: `demo-setup-${(n += 1)}`, setup, ...more }),
  });
  return { status: res.status, body: (await res.json()) as SetupResponse };
}

async function startOver(life: string): Promise<void> {
  await fetch(`${base}/demo/${life}`, { redirect: 'manual' });
}

describe('14 the demo lives not set up yet', () => {
  it('14 they are their own list, each with a made-up bank and no book', () => {
    expect(SETUP_SCENARIOS.map((s) => s.name)).toEqual(['setup-day', 'setup-suggest', 'setup-owes-more']);
    for (const s of SETUP_SCENARIOS) {
      expect(s.setup, s.name).toBeDefined();
      expect(s.input?.().book, s.name).toBeNull();
      expect(demoScenario(s.name)).toBe(s);
    }
    for (const s of DEMO_SCENARIOS) expect(s.setup, s.name).toBeUndefined();
  });

  it('14.1 12.4 A10 "setup-day": the balances with pending charges, and the old card apart', async () => {
    await startOver('setup-day');
    const v = await ready('setup-day');
    expect(v.madeUpData).toBe(true);
    // Checking 3,214.56 less 86.43 pending; savings 8,000.00 less 64.10; the card owes 612.48 + 41.20 + 6.25.
    expect(v.checking).toEqual({ posted: 321_456, pending: 8_643, withPending: 312_813 });
    expect(v.savings).toEqual({ posted: 800_000, pending: 6_410, withPending: 793_590 });
    expect(v.everydayCard).toEqual({ posted: 61_248, pending: 4_745, withPending: 65_993 });
    expect(v.oldCard).toEqual({ posted: 298_000, pending: 1_999, debt: 299_999 });
    expect(v.pendingCharges.map((c) => c.id)).toEqual(['su-p-grocery', 'su-p-gas', 'su-p-coffee', 'su-p-water', 'su-p-hardware']);
    // 3,128.13 + 7,935.90 - 659.93 = 10,404.10; the refund still pending is not in it (B36).
    expect(v.bankSide).toBe(1_040_410);
    expect(v.startingMoney).toBe(1_040_410);
    expect(v.halves.map((h) => [h.id, h.effect, h.rule?.id])).toEqual([
      ['su-old-left', 0, 'chk-pays-old'],
      ['su-card-left', 30_000, 'chk-pays-everyday'],
      ['su-sav-landed', -15_000, 'sav-from-chk'],
    ]);
  });

  it('B43 "setup-owes-more": the starting money is below zero', async () => {
    await startOver('setup-owes-more');
    const v = await ready('setup-owes-more');
    // 412.30 + 150.00 - 2,318.77 = -1,756.47
    expect(v).toMatchObject({ startingMoney: -175_647, leftToAssign: -175_647, halves: [], pendingCharges: [] });
  });

  it('14.3 the whole of setup day through the addresses: then Home has the book, and says what is still to set', async () => {
    const life = 'setup-day';
    await startOver(life);
    for (const half of (await ready(life)).halves) expect((await answer(life, { onItsWay: { half: half.id, answer: true } })).status).toBe(200);
    expect((await answer(life, { lastPaycheck: '2026-10-02' })).status).toBe(200);
    // 10,404.10 + 300.00 - 150.00 = 10,554.10
    expect((await ready(life)).startingMoney).toBe(1_055_410);
    await answer(life, { assign: { pot: 'savings', amount: 800_000 } });
    await answer(life, { assign: { pot: 'momReserve', amount: 120_000 } });
    await answer(life, { assign: { pot: 'wants', amount: 40_000 } });
    expect((await answer(life, { assign: { pot: 'needs', amount: 95_409 } })).body).toMatchObject({ ok: true, done: { leftToAssign: 1 } });
    // One cent short: refused, nothing changes.
    const short = await answer(life, { start: true }, { confirmed: true, seen: (await ready(life)).key });
    expect(short.status).toBe(422);
    expect(short.body).toMatchObject({ ok: false, why: '$0.01 is still to assign. Nothing was changed.' });
    expect((await json<HomeView>('/api/home', life)).state).toBe('not-set-up');
    await answer(life, { assign: { pot: 'needs', rest: true } });
    // Asks first.
    expect((await answer(life, { start: true })).body).toMatchObject({ ok: false, code: 'needs-confirmation' });
    const started = await answer(life, { start: true }, { confirmed: true, seen: (await ready(life)).key });
    expect(started.body).toMatchObject({ ok: true, done: { step: 'started', startingMoney: 1_055_410, stillToSet: ['paycheckRule', 'momRule'] } });
    const home = await json<HomeView>('/api/home', life);
    if (home.state !== 'tracking') throw new Error('Home is not tracking');
    expect(home.safeToSpend).toEqual({ shown: true, amount: 40_000 });
    // Savings and the mom reserve were given 9,200.00, and the savings
    // account holds 7,935.90 with its charge pending: 1,264.10 to move (3.8).
    expect(home.attention).toEqual([
      { kind: 'still-to-set', settings: ['paycheckRule', 'momRule'] },
      { kind: 'move-to-savings', stillToMove: 126_410, shouldBeInSavings: 920_000, savingsAccountBalance: 793_590 },
    ]);
    expect(await json<SetupView>('/api/setup', life)).toEqual({ state: 'tracking', madeUpData: true });
    // Setting up twice is refused.
    expect((await answer(life, { start: true }, { confirmed: true, seen: 'abc' })).body).toMatchObject({ ok: false, why: 'Setup day is done already. Nothing was changed.' });
    // Picking the life again starts it over.
    await startOver(life);
    expect((await json<HomeView>('/api/home', life)).state).toBe('not-set-up');
    expect((await ready(life)).unanswered).toBe(3);
  });

  it('14 the life before the bank is connected cannot do setup day, and lives with a book are set up', async () => {
    expect(await json<SetupView>('/api/setup', 'not-set-up')).toEqual({ state: 'not-set-up', madeUpData: true, ready: false, why: 'there is no bank connection yet' });
    expect((await answer('not-set-up', { lastPaycheck: '2026-10-02' })).body).toMatchObject({ ok: false, why: 'There is no bank connection yet. Nothing was changed.' });
    expect(await json<SetupView>('/api/setup', 'normal')).toEqual({ state: 'tracking', madeUpData: true });
    expect((await answer('normal', { start: true }, { confirmed: true, seen: 'abc' })).body).toMatchObject({ ok: false, why: 'Setup day is done already. Nothing was changed.' });
  });

  it('14 the Setup day addresses give the app', async () => {
    for (const step of ['bank', 'transfers', 'paycheck', 'assign', 'check']) {
      const res = await fetch(`${base}/setup/${step}`);
      expect(res.status, step).toBe(200);
      expect(res.headers.get('content-type'), step).toMatch(/text\/html/);
    }
    expect((await fetch(`${base}/setup/nowhere`)).status).toBe(404);
  });

  it('14 the demo page lists the lives not set up yet', async () => {
    const page = await (await fetch(`${base}/demo`)).text();
    for (const s of SETUP_SCENARIOS) expect(page).toContain(`/demo/${s.name}`);
  });
});
