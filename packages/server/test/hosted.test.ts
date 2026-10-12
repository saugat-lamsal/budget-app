import { afterEach, describe, expect, it } from 'vitest';
import { LOGIN_COOKIE } from '../src/auth/auth.js';
import { HSTS, LOGIN_PATH, ROUTES, SECURITY_HEADERS } from '../src/http/server.js';
import { hostedOrigin, serveOptions } from '../src/serve/options.js';
import { HOSTED, HOSTED_HOST, ask, firstLogin, servedAt, stop, type Answer, type Running } from './hosted-harness.js';
import { loginForTests } from './login-for-tests.js';

// Phase 6: hosted on Fly.io, the server answers only to its one https
// address. Fly's proxy takes the https (force_https in fly.toml sends http
// there) and passes each request on, saying it came over https. The server
// still checks: anything else is sent to the https address or refused, any
// other host name is refused, every POST must come from the app's own page
// at that address, the login cookie is Secure, and every answer tells the
// browser to use https only (HSTS). Every address and key is made up.

const running: Running[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) await stop(r);
});

async function hosted(origin = HOSTED): Promise<Running> {
  const r = await servedAt(origin);
  running.push(r);
  return r;
}

const ROOT = '/made-up/budget-app';

describe('Phase 6 hosted: the settings', () => {
  it('Phase 6 APP_ORIGIN makes it the hosted server: that address only, port 8080 (or PORT), on every address of its machine for Fly\'s proxy', () => {
    expect(serveOptions([], { APP_ORIGIN: HOSTED, BUDGET_DB: '/data/budget.sqlite' }, ROOT)).toEqual({ db: '/data/budget.sqlite', port: 8080, sync: false, connect: false, connectOnce: false, hosted: HOSTED, host: '0.0.0.0' });
    expect(serveOptions(['--connect-once'], { APP_ORIGIN: HOSTED, PORT: '9000' }, ROOT)).toMatchObject({ port: 9000, connectOnce: true, hosted: HOSTED });
    // Without it, this computer only, as before.
    expect(serveOptions([], {}, ROOT)).toMatchObject({ port: 5190, hosted: null, host: '127.0.0.1' });
    expect(serveOptions([], { APP_ORIGIN: '' }, ROOT)).toMatchObject({ hosted: null, host: '127.0.0.1' });
    expect(() => serveOptions(['--connect', '--connect-once'], {}, ROOT)).toThrow('one or the other');
    expect(() => serveOptions([], { APP_ORIGIN: HOSTED, PORT: 'eighty' }, ROOT)).toThrow('PORT needs a port number');
  });

  it.each([
    ['http, not https', 'http://made-up-budget.fly.dev'],
    ['a slash after it', 'https://made-up-budget.fly.dev/'],
    ['a path', 'https://made-up-budget.fly.dev/home'],
    ['a port', 'https://made-up-budget.fly.dev:8443'],
    ['a user', 'https://someone@made-up-budget.fly.dev'],
    ['no scheme', 'made-up-budget.fly.dev'],
  ])('Phase 6 APP_ORIGIN with %s is refused, and nothing starts', (_why, value) => {
    expect(() => hostedOrigin(value)).toThrow("APP_ORIGIN must be the app's own https address and nothing more");
  });
});

describe('Phase 6 hosted: https only, one address', () => {
  const paths: [string, string][] = [
    ['GET', '/'],
    ['GET', '/home'],
    ['GET', '/login'],
    ['GET', '/api/home'],
    ['GET', '/api/auth'],
    ['GET', '/health'],
    ['GET', '/assets/index-abc123.js'],
    ['GET', '/nothing-here'],
    ['POST', '/api/choice'],
  ];

  it('Phase 6 every answer tells the browser to use this address over https only (HSTS), whatever it is, and on this computer none does', async () => {
    const r = await hosted();
    for (const [method, path] of paths) {
      for (const o of [{}, { proto: null }, { host: 'elsewhere.example' }]) {
        const answer = await ask(r, method, path, o);
        expect(answer.headers['strict-transport-security'], `${method} ${path} ${JSON.stringify(o)}`).toBe(HSTS);
      }
    }
    expect(HSTS).toBe('max-age=63072000; includeSubDomains');
    const local = await servedAt('local');
    running.push(local);
    for (const [method, path] of paths) expect((await ask(local, method, path)).headers['strict-transport-security'], path).toBeUndefined();
  });

  it('Phase 6 a request that did not come over https is sent to the https address (GET and HEAD), or refused (POST), before anything else is looked at', async () => {
    const r = await hosted();
    for (const proto of [null, 'http', 'HTTPS ', 'ws']) {
      for (const method of ['GET', 'HEAD']) {
        const answer = await ask(r, method, '/home?tab=1', { proto });
        expect(answer.status, `${method} ${String(proto)}`).toBe(308);
        expect(answer.headers.location).toBe(`${HOSTED}/home?tab=1`);
      }
      const posted = await ask(r, 'POST', '/api/choice', { proto, body: { made: 'up' } });
      expect(posted.status).toBe(403);
      expect(posted.body).toBe('Only over https.');
    }
    // Over https, the usual: no login, the login page.
    const answer = await ask(r, 'GET', '/home');
    expect(answer.status).toBe(303);
    expect(answer.headers.location).toBe('/login');
  });

  it('Phase 6 any other host name is refused, this computer\'s own names included: no way round to the app', async () => {
    const r = await hosted();
    for (const host of [`localhost:${r.port}`, `127.0.0.1:${r.port}`, 'localhost', '127.0.0.1', '172.19.3.2:8080', 'elsewhere.example', `${HOSTED_HOST}.elsewhere.example`, `elsewhere.${HOSTED_HOST}`, `${HOSTED_HOST}:8080`, `${HOSTED_HOST}:443`]) {
      for (const [method, path] of [
        ['GET', '/home'],
        ['GET', '/api/home'],
        ['GET', '/login'],
        ['POST', '/api/auth/code/options'],
      ] as const) {
        const answer = await ask(r, method, path, { host, origin: `https://${host}` });
        expect(answer.status, `${host} ${method} ${path}`).toBe(421);
        expect(answer.body).toBe('Not this address.');
        expect(answer.headers.location).toBeUndefined();
      }
    }
  });

  it('Phase 6 a POST is taken only from the app\'s own page at its https address: not from another site, its http address, or with a port', async () => {
    const r = await hosted();
    for (const origin of [null, 'https://elsewhere.example', `http://${HOSTED_HOST}`, `${HOSTED}:8443`, `https://elsewhere.${HOSTED_HOST}`, 'null']) {
      const answer = await ask(r, 'POST', '/api/auth/code/options', { origin, body: { code: '123456789012' } });
      expect(answer.status, String(origin)).toBe(403);
      expect(answer.body).toBe('Only from the app itself.');
    }
    expect((await ask(r, 'POST', '/api/auth/code/options', { body: { code: '000000000000' } })).status).not.toBe(403);
  });

  it('Phase 6 B162 the login: the passkey is made for the hosted name, and the login cookie is Secure, HttpOnly, SameSite=Strict; so is the one that logs out', async () => {
    const r = await hosted();
    const code = r.life.keeper.loginCode();
    const asked = JSON.parse((await ask(r, 'POST', '/api/auth/code/options', { body: { code } })).body) as { options: { rp: { id: string } } };
    expect(asked.options.rp.id).toBe(HOSTED_HOST);
    const { setCookie, cookie } = await firstLogin(r);
    const parts = setCookie.split(';').map((p) => p.trim());
    expect(parts[0]).toMatch(new RegExp(`^${LOGIN_COOKIE}=[A-Za-z0-9_-]{43}$`));
    expect(parts.slice(1)).toEqual(['HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${30 * 24 * 60 * 60}`, 'Secure']);
    // Logged in, over https at its own address: Home's numbers.
    expect((await ask(r, 'GET', '/api/home', { cookie })).status).toBe(200);
    const out = await ask(r, 'POST', '/api/auth/logout', { cookie, body: {} });
    expect(out.status).toBe(200);
    expect(out.headers['set-cookie']?.[0]?.split(';').map((p) => p.trim())).toEqual([`${LOGIN_COOKIE}=`, 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0', 'Secure']);
    expect((await ask(r, 'GET', '/api/home', { cookie })).status).toBe(401);
  });

  it('Phase 6 every answer carries the security headers: only its own scripts, never in a frame, nothing passed on to other sites', async () => {
    const r = await hosted();
    expect(SECURITY_HEADERS).toEqual({
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    const answers: [string, Answer][] = [];
    for (const [method, path] of paths) for (const o of [{}, { proto: null }, { host: 'elsewhere.example' }]) answers.push([`${method} ${path} ${JSON.stringify(o)}`, await ask(r, method, path, o)]);
    for (const [what, answer] of answers) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(answer.headers[name.toLowerCase()], `${what}: ${name}`).toBe(value);
      expect(answer.headers['x-powered-by'], what).toBeUndefined();
    }
  });

  it('Phase 6 A43 hosted, every screen and every /api address needs a login, except the login page, what it needs, /health, and the backups\' health and its beat', async () => {
    const r = await hosted();
    expect(ROUTES.filter((route) => !route.login).map((route) => route.path)).toEqual([LOGIN_PATH, '/health', '/health/backups', '/health/backups/beat', '/api/auth', '/api/auth/login/options', '/api/auth/login', '/api/auth/code/options', '/api/auth/code']);
    const needs = ROUTES.filter((route) => route.login);
    expect(needs.length).toBeGreaterThan(20);
    for (const route of needs) {
      const answer = await ask(r, route.method, route.path, { body: {} });
      if (route.path.startsWith('/api/')) {
        expect(answer.status, route.path).toBe(401);
        expect(JSON.parse(answer.body), route.path).toEqual({ error: 'login-needed' });
      } else {
        expect(answer.status, route.path).toBe(303);
        expect(answer.headers.location, route.path).toBe(LOGIN_PATH);
      }
    }
    for (const route of needs) {
      // A fresh login each time: one of them is log out.
      const cookie = loginForTests(r.life.h.db, r.life.now);
      expect([401, 303], `${route.method} ${route.path}`).not.toContain((await ask(r, route.method, route.path, { cookie, body: {} })).status);
    }
  });
});
