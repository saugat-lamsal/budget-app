import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoServer } from '../src/demo/demo-server.js';
import type { BankRuleRequest, BankRuleResponse } from '../src/views/bank-rules.js';
import type { SettingsView } from '../src/views/settings.js';
import type { SetupView } from '../src/views/setup.js';

// Bank rule changes (rulebook section 2, 24c) reach the demo's lives through
// the same address as every other tap, /api/choice: on Setup day the setup
// desk takes them (so the transfers step follows), and after it the life's
// bank rules, shown on Settings. Every name and number is made up.

let server: Server;
let base: string;
let folder: string;

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'budget-bank-rules-'));
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

const json = async <T>(path: string, life: string): Promise<T> => (await (await fetch(`${base}${path}`, { headers: { cookie: `demo=${life}` } })).json()) as T;

async function send(life: string, request: BankRuleRequest): Promise<{ status: number; body: BankRuleResponse }> {
  const res = await fetch(`${base}/api/choice`, { method: 'POST', headers: { cookie: `demo=${life}`, 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  return { status: res.status, body: (await res.json()) as BankRuleResponse };
}

async function askThenYes(life: string, id: string, bankRule: BankRuleRequest['bankRule']): Promise<BankRuleResponse> {
  const asked = await send(life, { id, bankRule });
  expect(asked.status).toBe(422);
  if (asked.body.ok || asked.body.preview === undefined) throw new Error(JSON.stringify(asked.body));
  return (await send(life, { id, bankRule, confirmed: true, seen: asked.body.preview.key })).body;
}

describe('section 2 24c bank rule changes through /api/choice in the demo', () => {
  it('24c on Settings: it asks first with what it would match; with his yes it is saved, shown, and logged first', async () => {
    await fetch(`${base}/demo/normal`, { redirect: 'manual' });
    const before = await json<SettingsView>('/api/settings', 'normal');
    if (before.state !== 'tracking') throw new Error('not tracking');
    const done = await askThenYes('normal', 'demo-bank-rule-1', { add: { account: 'everyday-card', contains: 'FOREIGN TRANSACTION FEE', means: 'card-fee' } });
    expect(done).toMatchObject({ ok: true, done: { action: 'added', rule: { contains: 'FOREIGN TRANSACTION FEE' } } });
    const after = await json<SettingsView>('/api/settings', 'normal');
    if (after.state !== 'tracking') throw new Error('not tracking');
    expect(after.bankRules).toHaveLength(before.bankRules.length + 1);
    expect(after.log[0]).toMatchObject({ kind: 'bank-rule-added', rule: { contains: 'FOREIGN TRANSACTION FEE' } });
  });

  it('24c on Setup day the setup desk takes it, and the transfers step follows the rules as they are now', async () => {
    await fetch(`${base}/demo/setup-suggest`, { redirect: 'manual' });
    const halves = async (): Promise<string[]> => {
      const view = await json<SetupView>('/api/setup', 'setup-suggest');
      return view.state === 'not-set-up' && view.ready ? view.halves.map((h) => h.id) : [];
    };
    expect(await halves()).toEqual([]);
    await askThenYes('setup-suggest', 'demo-bank-rule-2', { add: { account: 'checking', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' } });
    expect(await halves()).toEqual(['su-card-left']);
  });

  it('24c before the bank is connected there is nothing to change, and nothing is', async () => {
    const { status, body } = await send('not-set-up', { id: 'demo-bank-rule-3', bankRule: { add: { account: 'checking', contains: 'X', means: 'payment-to-person' } } });
    expect(status).toBe(422);
    expect(body).toEqual({ ok: false, code: 'refused', why: 'There is no bank connection yet. Nothing was changed.' });
  });
});
