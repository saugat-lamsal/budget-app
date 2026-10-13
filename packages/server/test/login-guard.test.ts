import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage, type Server } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Auth, LOGIN_COOKIE } from '../src/auth/auth.js';
import { answerAuth } from '../src/auth/http.js';
import { createDemoServer } from '../src/demo/demo-server.js';
import { APP_PATHS, AUTH_ROUTES, LOGIN_PATH, ROUTES, SCREEN_PATHS, SETUP_PATHS, createAppServer } from '../src/http/server.js';
import { serverLinesIn } from '../src/server-log.js';
import { lifeInAFile, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { loginForTests } from './login-for-tests.js';

// Every screen and every /api request on the real server needs him logged
// in, except the login page and what it needs (Step 2). Like the screens'
// read-only guard (packages/web/test/read-only.test.ts), this lists every
// route the server answers and checks each one: refused with no login, with
// an expired login, and with a login from another database; answered with a
// good one. Every POST must come from the app's own address. And there is no
// way in but a passkey: no route, flag or setting lets a test (or anyone) in.

interface Running {
  readonly life: Life;
  readonly server: Server;
  readonly port: number;
  readonly origin: string;
}

const running: Running[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) {
    await new Promise<void>((done) => r.server.close(() => done()));
    r.life.done();
  }
});

async function realServer(): Promise<Running> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  const webRoot = join(life.dir, 'dist');
  mkdirSync(join(webRoot, 'assets'), { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(webRoot, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(webRoot, 'manifest.webmanifest'), '{}');
  let origin = '';
  const server = life.keeper.server(webRoot, () => origin);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  origin = `http://localhost:${port}`;
  const r = { life, server, port, origin };
  running.push(r);
  return r;
}

interface Answer {
  readonly status: number;
  readonly location: string | undefined;
  readonly setCookie: readonly string[];
  readonly body: string;
}

// One request, as a browser at the app's own address sends it.
function ask(r: Running, method: string, path: string, o: { readonly cookie?: string; readonly origin?: string | null; readonly host?: string; readonly body?: unknown; readonly site?: string } = {}): Promise<Answer> {
  const body = method === 'POST' ? JSON.stringify(o.body ?? {}) : undefined;
  const headers: Record<string, string> = { Host: o.host ?? `localhost:${r.port}` };
  if (o.cookie !== undefined) headers['Cookie'] = o.cookie;
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(body ?? ''));
    if (o.origin !== null) headers['Origin'] = o.origin ?? r.origin;
    headers['Sec-Fetch-Site'] = o.site ?? 'same-origin';
  }
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: r.port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += String(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, setCookie: res.headers['set-cookie'] ?? [], body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

// What a route needing a login answers without one: an /api route 401, a
// screen the way to the login page. Nothing of his in either.
function refused(answer: Answer, path: string): void {
  if (path.startsWith('/api/')) {
    expect(answer.status, path).toBe(401);
    expect(JSON.parse(answer.body), path).toEqual({ error: 'login-needed' });
  } else {
    expect(answer.status, path).toBe(303);
    expect(answer.location, path).toBe(LOGIN_PATH);
  }
}

const NEEDS_LOGIN = ROUTES.filter((route) => route.login);

describe('login: every route on the real server needs a login', () => {
  it('login the list of routes is every address the server answers: every screen, every /api address in its code', () => {
    const paths = new Set(ROUTES.map((r) => r.path));
    for (const path of [...APP_PATHS, ...SCREEN_PATHS, ...SETUP_PATHS, LOGIN_PATH]) expect(paths.has(path), path).toBe(true);
    const src = new URL('../src/', import.meta.url);
    const code = readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts') && !name.replaceAll('\\', '/').startsWith('demo/'))
      .map((name) => readFileSync(new URL(name, src), 'utf8'))
      .join('\n');
    const inCode = new Set([...code.matchAll(/'(\/api\/[a-z/-]*)'/g)].map((m) => m[1] ?? ''));
    for (const path of inCode) expect([...paths].some((p) => p === path || p.startsWith(path)), path).toBe(true);
    expect(NEEDS_LOGIN.length).toBeGreaterThan(20);
  });

  // A new address (the Notifications card's, Phase 5) left open by mistake
  // would never be in NEEDS_LOGIN, so nothing below would try it. Phase 6
  // adds one: /health, for the uptime monitor, which says only "ok". A43 adds
  // two: /health/backups, for the second monitor, and the beat Litestream sends
  // it from the same machine (taken only from there).
  it('login Phase 6 A43 the only addresses open without a login are the login page and its own requests, and the health addresses', () => {
    expect(ROUTES.filter((r) => !r.login).map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /login',
      'GET /health',
      'GET /health/backups',
      'GET /health/backups/beat',
      'GET /api/auth',
      'POST /api/auth/login/options',
      'POST /api/auth/login',
      'POST /api/auth/code/options',
      'POST /api/auth/code',
    ]);
    for (const path of ['/api/push/on', '/api/push/off', '/api/push/test']) expect(ROUTES.filter((r) => r.path === path), path).toEqual([{ method: 'POST', path, login: true }]);
  });

  it('login with no login, every screen and every /api route is refused', async () => {
    const r = await realServer();
    for (const route of NEEDS_LOGIN) refused(await ask(r, route.method, route.path), route.path);
  });

  it('login with an expired login, every one is refused', async () => {
    const r = await realServer();
    const cookie = loginForTests(r.life.h.db, r.life.now);
    r.life.now = new Date(r.life.now.getTime() + 30 * 24 * 60 * 60 * 1000);
    for (const route of NEEDS_LOGIN) refused(await ask(r, route.method, route.path, { cookie }), route.path);
  });

  it('login with a login from another database, every one is refused', async () => {
    const r = await realServer();
    const other = await realServer();
    const cookie = loginForTests(other.life.h.db, other.life.now);
    expect((await ask(other, 'GET', '/api/home', { cookie })).status).toBe(200);
    for (const route of NEEDS_LOGIN) refused(await ask(r, route.method, route.path, { cookie }), route.path);
  });

  it('login with a good login, none is refused for want of one', async () => {
    const r = await realServer();
    for (const route of NEEDS_LOGIN) {
      // A fresh login each time: one of them is log out.
      const cookie = loginForTests(r.life.h.db, r.life.now);
      const answer = await ask(r, route.method, route.path, { cookie, body: {} });
      expect([401, 303], `${route.method} ${route.path}`).not.toContain(answer.status);
    }
  });

  it('login the login page and what it needs are there without a login, and show nothing of his', async () => {
    const r = await realServer();
    expect((await ask(r, 'GET', LOGIN_PATH)).status).toBe(200);
    expect((await ask(r, 'GET', '/assets/index-abc123.js')).status).toBe(200);
    expect((await ask(r, 'GET', '/manifest.webmanifest')).status).toBe(200);
    const state = await ask(r, 'GET', '/api/auth');
    expect(JSON.parse(state.body)).toEqual({ loggedIn: false, passkeys: false });
    // Asking to log in gives a question to answer, and nothing else: no
    // passkey ids, nothing of his.
    const question = await ask(r, 'POST', '/api/auth/login/options');
    expect(question.status).toBe(200);
    expect(Object.keys((JSON.parse(question.body) as { options: object }).options).sort()).toEqual(['challenge', 'rpId', 'timeout', 'userVerification']);
    expect(question.setCookie).toEqual([]);
    // The rest, with nothing to show, are refused, and log nobody in.
    for (const route of ROUTES.filter((x) => !x.login && x.path.startsWith('/api/') && x.method === 'POST' && x.path !== '/api/auth/login/options')) {
      const answer = await ask(r, route.method, route.path, { body: {} });
      expect(answer.status, route.path).toBe(422);
      expect(answer.setCookie, route.path).toEqual([]);
    }
  });

  it('login every POST must come from the app\'s own address: another site, no Origin, or a cross-site fetch is refused, logged in or not', async () => {
    const r = await realServer();
    const cookie = loginForTests(r.life.h.db, r.life.now);
    for (const route of ROUTES.filter((x) => x.method === 'POST')) {
      for (const o of [{ origin: 'http://evil.example' }, { origin: null }, { site: 'cross-site' }, { origin: `http://127.0.0.1:${r.port}` }]) {
        const answer = await ask(r, 'POST', route.path, { cookie, ...o });
        expect(answer.status, `${route.path} ${JSON.stringify(o)}`).toBe(403);
      }
    }
  });

  it("login the gate itself refuses the login's own addresses that need a login, before the login's code is asked; the open ones it passes on", async () => {
    const asked: string[] = [];
    let origin = '';
    const server = createAppServer({
      webRoot: join(process.cwd(), 'no-such-folder'),
      home: () => {
        throw new Error('not asked');
      },
      gate: {
        origin: () => origin,
        loggedIn: () => false,
        auth: (path) => {
          asked.push(path);
          return Promise.resolve({ status: 200, body: { ok: true } });
        },
      },
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      origin = `http://localhost:${port}`;
      const r = { port, origin } as Running;
      for (const route of AUTH_ROUTES.filter((x) => x.login)) refused(await ask(r, route.method, route.path), route.path);
      expect(asked).toEqual([]);
      for (const route of AUTH_ROUTES.filter((x) => !x.login)) expect((await ask(r, route.method, route.path)).status, route.path).toBe(200);
      expect(asked).toEqual(AUTH_ROUTES.filter((x) => !x.login).map((x) => x.path));
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it("login the login's own code refuses what needs a login without one, even when asked directly", async () => {
    const life = await lifeInAFile();
    try {
      const auth = new Auth({ db: life.h.db, now: () => life.now, origin: 'http://localhost:5190', today: () => '2026-10-01', bookLines: () => 0 });
      const request = { headers: {} } as IncomingMessage;
      for (const route of AUTH_ROUTES.filter((x) => x.login)) expect(await answerAuth(auth, route.path, request, {}, null), route.path).toEqual({ status: 401, body: { error: 'login-needed' } });
      expect(serverLinesIn(life.h.db)).toEqual([]);
    } finally {
      life.done();
    }
  });

  it('login a request to another host name is not answered with anything of his; 127.0.0.1 is sent to localhost', async () => {
    const r = await realServer();
    const cookie = loginForTests(r.life.h.db, r.life.now);
    const moved = await ask(r, 'GET', '/home', { cookie, host: `127.0.0.1:${r.port}` });
    expect(moved.status).toBe(307);
    expect(moved.location).toBe(`${r.origin}/home`);
    const other = await ask(r, 'GET', '/api/home', { cookie, host: 'evil.example' });
    expect(other.status).toBe(421);
  });
});

describe('login: no way in but a passkey', () => {
  it('login only a passkey (or a one-time code making one) sets a login: no other code in the server does', () => {
    const src = new URL('../src/', import.meta.url);
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.ts'));
    const setters = files.filter((name) => /\bsaveSession\(/.test(readFileSync(new URL(name, src), 'utf8')));
    expect(setters.map((name) => name.replaceAll('\\', '/')).sort()).toEqual(['auth/auth-db.ts', 'auth/auth.ts']);
    const auth = readFileSync(new URL('auth/auth.ts', src), 'utf8');
    expect([...auth.matchAll(/saveSession\(/g)]).toHaveLength(1);
  });

  it('login the tests\' shortcut lives in the tests only: nothing in the server loads it, and no setting or environment variable skips the login', () => {
    const src = new URL('../src/', import.meta.url);
    for (const name of readdirSync(src, { recursive: true, encoding: 'utf8' }).filter((n) => n.endsWith('.ts'))) {
      const text = readFileSync(new URL(name, src), 'utf8');
      expect(text, name).not.toMatch(/login-for-tests|loginForTests/);
      if (name.replaceAll('\\', '/').startsWith('auth/') || name.replaceAll('\\', '/') === 'http/server.ts') expect(text, name).not.toMatch(/process\.env/);
    }
  });

  it('login the demo stays as it was, with no login: its numbers need none', async () => {
    const server = createDemoServer({ webRoot: join(process.cwd(), 'no-such-folder') });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const answer = await new Promise<number>((resolve, reject) => {
        const req = httpRequest({ host: '127.0.0.1', port, path: '/api/home' }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('error', reject);
        req.end();
      });
      expect(answer).toBe(200);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it(`login the login cookie is called ${LOGIN_COOKIE}`, () => {
    expect(LOGIN_COOKIE).toBe('budget-login');
  });
});
