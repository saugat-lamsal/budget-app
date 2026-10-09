import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_PATHS, SECURITY_HEADERS, createAppServer } from '../src/http/server.js';
import type { ChoiceResponse, MoveResponse, RuleRequest, RuleResponse, SettingsRequest, SettingsResponse } from '../src/views/choice.js';
import type { HomeView } from '../src/views/home.js';
import type { SettingsView } from '../src/views/settings.js';

// The Settings screen's address (Phase 4): its numbers are read from
// /api/settings, and a change to the settings or to a sorting rule is sent
// to the same address as every other choice, /api/choice, where the money
// math decides. The screens send nothing anywhere else.

const HOME: HomeView = { state: 'not-set-up', madeUpData: true };
const SETTINGS: SettingsView = { state: 'not-set-up', madeUpData: true };
const CHANGED: SettingsResponse = { ok: true, replayed: false, done: { changed: ['payScheduleDays'], fromNextPaycheck: false, rechecked: [] } };
const RULED: RuleResponse = { ok: true, replayed: false, done: { action: 'added', rule: { id: 'rule-x', for: 'purchase', contains: 'CAFE', to: 'wants' }, alsoSorted: 0, stillWaiting: [] } };
const DONE: ChoiceResponse = { ok: true, replayed: false, done: { item: 'p1', choice: { to: 'wants' }, alsoSorted: 0, stillWaiting: [], sticks: null } };
const MOVED: MoveResponse = { ok: true, replayed: false, moved: { from: 'wants', to: 'needs', amount: 1 } };

let folder: string;
let server: Server;
let port = 0;
let failSettings = false;
const errors: unknown[] = [];
const settingsSent: SettingsRequest[] = [];
const rulesSent: RuleRequest[] = [];
const others: unknown[] = [];
let nextSettings: SettingsResponse = CHANGED;

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'budget-settings-'));
  const webRoot = join(folder, 'dist');
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
  server = createAppServer({
    webRoot,
    home: () => HOME,
    settings: () => {
      if (failSettings) throw new Error('database said: something private');
      return SETTINGS;
    },
    settingsChange: (_request, change) => {
      settingsSent.push(change);
      return nextSettings;
    },
    ruleChange: (_request, change) => {
      rulesSent.push(change);
      return RULED;
    },
    choice: (_request, choice) => {
      others.push(choice);
      return DONE;
    },
    move: (_request, move) => {
      others.push(move);
      return MOVED;
    },
    onError: (error) => errors.push(error),
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(folder, { recursive: true, force: true });
});

type Answer = { status: number; headers: Record<string, string | string[] | undefined>; body: string };

function ask(path: string, method = 'GET', send?: { readonly body: string; readonly headers: Record<string, string> }, onPort = port): Promise<Answer> {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port: onPort, path, method, headers: send?.headers ?? {} }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end(send?.body);
  });
}

function sendChoice(body: string, headers: Record<string, string> = {}, onPort = port): Promise<Answer> {
  return ask('/api/choice', 'POST', { body, headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${onPort}`, ...headers } }, onPort);
}

const GOOD_SETTINGS = { id: 'decision-0001', settings: { payScheduleDays: 7 } };
const GOOD_RULE = { id: 'decision-0002', rule: { add: { for: 'purchase', contains: 'CAFE', to: 'wants' } } };

describe('section 2 the Settings screen is a tab with its own address', () => {
  it('/settings gets the app, so a refresh or a link opens it', async () => {
    expect(APP_PATHS).toContain('/settings');
    const res = await ask('/settings');
    expect(res.status).toBe(200);
    expect(res.body).toContain('<title>app</title>');
  });
});

describe('section 2 the Settings numbers are served as JSON, never kept by the browser', () => {
  it('they come as the handler gave them', async () => {
    const res = await ask('/api/settings');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual(SETTINGS);
  });

  it('when they cannot be worked out, the phone is told without the details', async () => {
    failSettings = true;
    try {
      const res = await ask('/api/settings');
      expect(res.status).toBe(500);
      expect(JSON.parse(res.body)).toEqual({ error: 'settings-unavailable' });
      expect(res.body).not.toContain('private');
      expect(String(errors.at(-1))).toContain('private');
    } finally {
      failSettings = false;
    }
  });

  it('0.4 they can only be read: changes go to /api/choice, like every other choice', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await ask('/api/settings', method);
      expect(res.status, method).toBe(405);
      expect(res.headers['allow']).toBe('GET, HEAD');
    }
    expect(settingsSent).toEqual([]);
  });

  it('every answer carries the security headers', async () => {
    for (const path of ['/settings', '/api/settings']) {
      const res = await ask(path);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers[name.toLowerCase()], `${path} ${name}`).toBe(value);
    }
  });
});

describe('13.1 13.2 a settings change or a rule change goes to the desk through /api/choice', () => {
  it('a settings change reaches the settings handler, parsed, and nothing else', async () => {
    const before = { settings: settingsSent.length, rules: rulesSent.length, others: others.length };
    const res = await sendChoice(JSON.stringify(GOOD_SETTINGS));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual(CHANGED);
    expect(settingsSent.slice(before.settings)).toEqual([GOOD_SETTINGS]);
    expect(rulesSent.length).toBe(before.rules);
    expect(others.length).toBe(before.others);
  });

  it('a rule change reaches the rule handler, parsed, and nothing else', async () => {
    const before = { settings: settingsSent.length, rules: rulesSent.length, others: others.length };
    const res = await sendChoice(JSON.stringify({ ...GOOD_RULE, rule: { add: { for: 'purchase', contains: '  CAFE ', to: 'wants' } } }));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(RULED);
    expect(rulesSent.slice(before.rules)).toEqual([GOOD_RULE]);
    expect(settingsSent.length).toBe(before.settings);
    expect(others.length).toBe(before.others);
  });

  it('A9 a change that asks first is a well-formed answer, with what it would do, not a server error', async () => {
    nextSettings = {
      ok: false,
      code: 'needs-confirmation',
      why: 'Setting the paycheck rule sorts what is waiting for good, so it needs your OK first. Nothing was changed.',
      preview: { items: [], potsBefore: { savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0, unsortedIn: 0, unsortedOut: 0 }, potsAfter: { savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0, unsortedIn: 0, unsortedOut: 0 }, waitingBefore: 0, waitingAfter: 0, key: 'abc' },
    };
    try {
      const res = await sendChoice(JSON.stringify({ id: 'decision-0003', settings: { paycheckRule: { contains: 'MADE UP EMPLOYER' } } }));
      expect(res.status).toBe(422);
      expect(JSON.parse(res.body)).toEqual(nextSettings);
    } finally {
      nextSettings = CHANGED;
    }
  });

  it('only a change of exactly the right shape, small, from the app itself, is taken', async () => {
    const before = { settings: settingsSent.length, rules: rulesSent.length };
    const good = JSON.stringify(GOOD_SETTINGS);
    expect((await sendChoice(good, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await sendChoice(good, { Origin: 'https://somewhere-else.example' })).status).toBe(403);
    expect((await sendChoice(good, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    for (const bad of [
      { ...GOOD_SETTINGS, settings: { payScheduleDays: 7.5 } },
      { ...GOOD_SETTINGS, settings: { notASetting: 1 } },
      { ...GOOD_SETTINGS, settings: {} },
      { ...GOOD_SETTINGS, move: { from: 'wants', to: 'needs', amount: 1 } },
      { ...GOOD_RULE, rule: { add: { for: 'purchase', contains: 'CAFE', to: 'savings' } } },
      { ...GOOD_RULE, rule: {} },
      { ...GOOD_RULE, settings: { payScheduleDays: 7 } },
    ]) {
      expect((await sendChoice(JSON.stringify(bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await sendChoice(JSON.stringify({ ...GOOD_SETTINGS, settings: { momRule: { contains: 'x'.repeat(5_000) } } }))).status).toBe(413);
    expect(settingsSent.length).toBe(before.settings);
    expect(rulesSent.length).toBe(before.rules);
  });

  it('without the handlers, a settings or rule change is not found, and the rest still works', async () => {
    const bare = createAppServer({ webRoot: join(folder, 'dist'), home: () => HOME, choice: () => DONE });
    await new Promise<void>((done) => bare.listen(0, '127.0.0.1', done));
    try {
      const barePort = (bare.address() as AddressInfo).port;
      expect((await sendChoice(JSON.stringify(GOOD_SETTINGS), {}, barePort)).status).toBe(404);
      expect((await sendChoice(JSON.stringify(GOOD_RULE), {}, barePort)).status).toBe(404);
      expect((await ask('/api/settings', 'GET', undefined, barePort)).status).toBe(404);
      expect((await sendChoice(JSON.stringify({ id: 'decision-0004', item: 'p1', choice: { to: 'wants' } }), {}, barePort)).status).toBe(200);
    } finally {
      bare.closeAllConnections();
      await new Promise<void>((done) => bare.close(() => done()));
    }
  });
});
