import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TokenBox } from '../src/crypto/token-box.js';
import { openDatabase } from '../src/db/database.js';
import { readConnection } from '../src/db/store.js';
import { createDemoServer } from '../src/demo/demo-server.js';
import { Keeper } from '../src/history/keeper.js';
import { BANK_PATHS, BANK_SCREEN_PATH, PLAID_LINK_SCRIPT, ROUTES, SECURITY_HEADERS, bankPageHeaders } from '../src/http/server.js';
import { memoryLog } from '../src/log.js';
import { PlaidClient } from '../src/plaid/client.js';
import { PLAID_URLS, plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';
import { ACCOUNT_IDS, FakePlaid, fourAccounts } from './fake-plaid.js';
import { POSTED_AT_START, TOKEN_KEY } from './harness.js';
import { ask, type Running } from './hosted-harness.js';
import { noonInNewYork } from './keeper-harness.js';
import { loginForTests } from './login-for-tests.js';

// Rules 1.1 to 1.3 over HTTP: the Bank connection screen's addresses on the
// real server, behind the login, parsed strictly; and the Bank page, the one
// page whose rules let Plaid Link in. Against the made-up bank.

const PICKS = { checking: ACCOUNT_IDS.checking, savings: ACCOUNT_IDS.savings, 'everyday-card': ACCOUNT_IDS.everyday, 'old-card': ACCOUNT_IDS.old };

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

async function bankServer(): Promise<{ readonly r: Running; readonly cookie: string; readonly fake: FakePlaid; readonly db: ReturnType<typeof openDatabase> }> {
  const dir = mkdtempSync(join(tmpdir(), 'budget-bank-'));
  const webRoot = join(dir, 'dist');
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>app</title></head><body></body></html>');
  const db = openDatabase(':memory:');
  const fake = new FakePlaid(fourAccounts(POSTED_AT_START));
  const log = memoryLog([], [fake.clientId, fake.secret]);
  const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log });
  const now = noonInNewYork('2026-10-01');
  const keeper = Keeper.open({ db, now: () => now, log });
  let origin = 'http://localhost:0';
  const server: Server = keeper.server(webRoot, () => origin, undefined, { bank: { plaid, box: new TokenBox(TOKEN_KEY), log, pageSize: 3 } });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  origin = `http://localhost:${port}`;
  stops.push(async () => {
    await new Promise<void>((done) => server.close(() => done()));
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { r: { port, origin } as Running, cookie: loginForTests(db, now), fake, db };
}

describe('1.1 to 1.3 the Bank connection screen over HTTP', () => {
  it('1.1 every Bank address needs a login, and the screen is one of the app\'s', () => {
    expect(ROUTES.filter((route) => route.path === BANK_SCREEN_PATH || route.path.startsWith('/api/bank'))).toEqual([
      { method: 'GET', path: '/bank', login: true },
      { method: 'GET', path: '/api/bank', login: true },
      { method: 'POST', path: '/api/bank/link', login: true },
      { method: 'POST', path: '/api/bank/connected', login: true },
      { method: 'POST', path: '/api/bank/roles', login: true },
      { method: 'POST', path: '/api/bank/read', login: true },
    ]);
    expect(Object.values(BANK_PATHS)).toEqual(['/api/bank', '/api/bank/link', '/api/bank/connected', '/api/bank/roles', '/api/bank/read']);
  });

  it('1.1 without a login nothing is answered and nothing is asked of the bank', async () => {
    const { r, fake } = await bankServer();
    expect((await ask(r, 'GET', '/api/bank')).status).toBe(401);
    for (const path of ['/api/bank/link', '/api/bank/connected', '/api/bank/roles', '/api/bank/read']) expect((await ask(r, 'POST', path, { body: { mode: 'connect', yes: true } })).status, path).toBe(401);
    expect(fake.calls).toEqual([]);
  });

  it('1.1 1.2 the whole way through: asks first, connects once, picks the four, reads the bank', async () => {
    const { r, cookie, fake, db } = await bankServer();
    expect(JSON.parse((await ask(r, 'GET', '/api/bank', { cookie })).body)).toEqual({ state: 'none', bank: 'test' });
    const first = await ask(r, 'POST', '/api/bank/link', { cookie, body: { mode: 'connect', yes: false } });
    expect(first.status).toBe(422);
    expect(JSON.parse(first.body)).toMatchObject({ ok: false, code: 'needs-yes' });
    const link = await ask(r, 'POST', '/api/bank/link', { cookie, body: { mode: 'connect', yes: true } });
    expect(link.status).toBe(200);
    expect(JSON.parse(link.body)).toMatchObject({ ok: true, linkToken: expect.stringMatching(/^link-sandbox-/) });
    const connected = await ask(r, 'POST', '/api/bank/connected', { cookie, body: { publicToken: fake.publicToken } });
    expect(JSON.parse(connected.body)).toMatchObject({ ok: true });
    expect(readConnection(db)).not.toBeNull();
    // The view never holds the bank key.
    const view = (await ask(r, 'GET', '/api/bank', { cookie })).body;
    expect(view).not.toContain(fake.accessToken);
    expect(JSON.parse((await ask(r, 'POST', '/api/bank/roles', { cookie, body: { roles: PICKS, yes: false } })).body)).toMatchObject({ code: 'needs-yes' });
    expect(JSON.parse((await ask(r, 'POST', '/api/bank/roles', { cookie, body: { roles: PICKS, yes: true } })).body)).toMatchObject({ ok: true });
    expect(JSON.parse((await ask(r, 'POST', '/api/bank/read', { cookie, body: {} })).body)).toMatchObject({ ok: true, said: 'The bank was read.' });
    expect(fake.calls.some((c) => c.endpoint === '/transactions/sync')).toBe(true);
    // 1.1: a second connection is refused over HTTP too.
    expect(JSON.parse((await ask(r, 'POST', '/api/bank/link', { cookie, body: { mode: 'connect', yes: true } })).body)).toMatchObject({ code: 'connected-already' });
    expect(fake.calls.filter((c) => c.endpoint === '/item/public_token/exchange')).toHaveLength(1);
  });

  it('1.1 anything else sent is refused before it reaches the bank: extra fields, wrong types, a link key that is not one, GET', async () => {
    const { r, cookie, fake } = await bankServer();
    const bad: [string, unknown][] = [
      ['/api/bank/link', { mode: 'connect' }],
      ['/api/bank/link', { mode: 'connect', yes: 'yes' }],
      ['/api/bank/link', { mode: 'login-again', yes: true }],
      ['/api/bank/link', { mode: 'remove' }],
      ['/api/bank/connected', { publicToken: fake.publicToken, also: 1 }],
      ['/api/bank/connected', { publicToken: 'access-sandbox-11111111' }],
      ['/api/bank/connected', { publicToken: '' }],
      ['/api/bank/roles', { roles: PICKS }],
      ['/api/bank/roles', { roles: [ACCOUNT_IDS.checking], yes: true }],
      ['/api/bank/roles', { roles: { ...PICKS, checking: 42 }, yes: true }],
      ['/api/bank/read', { loggedInAgain: false }],
      ['/api/bank/read', { remove: true }],
    ];
    for (const [path, body] of bad) expect((await ask(r, 'POST', path, { cookie, body })).status, `${path} ${JSON.stringify(body)}`).toBe(400);
    for (const path of ['/api/bank/link', '/api/bank/connected', '/api/bank/roles', '/api/bank/read']) expect((await ask(r, 'GET', path, { cookie })).status, path).toBe(405);
    expect(fake.calls).toEqual([]);
  });

  it('1.1 a POST from another site is refused', async () => {
    const { r, cookie, fake } = await bankServer();
    expect((await ask(r, 'POST', '/api/bank/link', { cookie, origin: 'https://elsewhere.example', body: { mode: 'connect', yes: true } })).status).toBe(403);
    expect(fake.calls).toEqual([]);
  });

  it('1.1 the demo has no bank: its addresses are not there', async () => {
    const server = createDemoServer({ webRoot: '.' });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const r = { port, origin: `http://localhost:${port}` } as Running;
    expect((await ask(r, 'GET', '/api/bank')).status).toBe(404);
    // A POST it does not know is refused, as for every other address the demo does not have.
    expect((await ask(r, 'POST', '/api/bank/link', { body: { mode: 'connect', yes: true } })).status).toBe(405);
    await new Promise<void>((done) => server.close(() => done()));
  });
});

describe('1.1 the Bank page lets Plaid Link in, and no other page does', () => {
  it('1.1 the Bank page: Plaid\'s script and login frame, the test bank to talk to, a fresh nonce each load, given to the page; its windows may keep in touch with it', async () => {
    const { r, cookie } = await bankServer();
    const one = await ask(r, 'GET', '/bank', { cookie });
    const two = await ask(r, 'GET', '/bank', { cookie });
    expect(one.status).toBe(200);
    const csp = String(one.headers['content-security-policy']);
    const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1] ?? '';
    expect(nonce.length).toBeGreaterThanOrEqual(22);
    expect(String(two.headers['content-security-policy'])).not.toContain(nonce);
    expect(one.body).toContain(`<meta name="plaid-nonce" content="${nonce}">`);
    expect(one.body).toContain(`<meta name="plaid-link" content="${PLAID_LINK_SCRIPT}">`);
    expect(csp).toBe(bankPageHeaders(nonce, 'https://sandbox.plaid.com')['Content-Security-Policy']);
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' ${PLAID_LINK_SCRIPT}`);
    expect(csp).toContain('frame-src https://cdn.plaid.com/');
    expect(csp).toContain("connect-src 'self' https://sandbox.plaid.com");
    expect(csp).not.toContain("'unsafe-inline' https");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(one.headers['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
    expect(one.headers['cache-control']).toBe('no-store');
    expect(one.headers['x-frame-options']).toBe('DENY');
  });

  it('1.1 every other page keeps the strict rules: no Plaid, no nonce, its own windows only', async () => {
    const { r, cookie } = await bankServer();
    for (const path of ['/home', '/settings', '/setup/bank', '/review']) {
      const page = await ask(r, 'GET', path, { cookie });
      expect(page.headers['content-security-policy'], path).toBe(SECURITY_HEADERS['Content-Security-Policy']);
      expect(page.headers['cross-origin-opener-policy'], path).toBe('same-origin');
      expect(page.body, path).not.toContain('plaid-nonce');
    }
    expect(SECURITY_HEADERS['Content-Security-Policy']).not.toContain('plaid');
  });

  it('1.1 on the real bank the page talks to the real bank only', () => {
    const csp = bankPageHeaders('made-up-nonce-1234567890', PLAID_URLS.production)['Content-Security-Policy'] ?? '';
    expect(csp).toContain(`connect-src 'self' ${['https://', 'production', '.plaid.com'].join('')}`);
    expect(csp).not.toContain('sandbox.plaid.com');
  });

  it('1.1 without a login the Bank page sends him to log in', async () => {
    const { r } = await bankServer();
    const page = await ask(r, 'GET', '/bank');
    expect(page.status).toBe(303);
    expect(page.headers.location).toBe('/login');
  });
});
