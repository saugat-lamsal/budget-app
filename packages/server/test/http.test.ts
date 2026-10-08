import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_PATHS, SECURITY_HEADERS, createAppServer } from '../src/http/server.js';
import type { BucketsView } from '../src/views/buckets.js';
import type { ChoiceResponse } from '../src/views/choice.js';
import type { HomeView } from '../src/views/home.js';
import type { ReviewView } from '../src/views/review.js';

// The web server for the screens: it serves the built app and Home's
// numbers, nothing else, and never anything outside the app's folder.

const VIEW: HomeView = { state: 'not-set-up', madeUpData: true };

let folder: string;
let server: Server;
let port = 0;
let failHome = false;
const errors: unknown[] = [];
// What the screens marked as seen (10.6), and the only id the made-up book has.
const seen: string[] = [];
const KNOWN = 'p2';
const BUCKETS: BucketsView = { state: 'not-set-up', madeUpData: true };
const REVIEW: ReviewView = { state: 'not-set-up', madeUpData: true };
let failBuckets = false;
// What the screens sent as a choice, and what the made-up desk answers.
const choices: unknown[] = [];
const DONE: ChoiceResponse = { ok: true, replayed: false, done: { item: 'p1', choice: { to: 'wants' }, alsoSorted: 0, stillWaiting: [], sticks: null } };
let nextAnswer: ChoiceResponse = DONE;

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'budget-web-'));
  const webRoot = join(folder, 'dist');
  mkdirSync(join(webRoot, 'assets'), { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(webRoot, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(webRoot, 'manifest.webmanifest'), '{}');
  // Next to the app's folder, never to be served.
  writeFileSync(join(folder, 'secret.txt'), 'not for the phone');
  server = createAppServer({
    webRoot,
    home: () => {
      if (failHome) throw new Error('database said: something private');
      return VIEW;
    },
    buckets: () => {
      if (failBuckets) throw new Error('database said: something private');
      return BUCKETS;
    },
    review: () => REVIEW,
    choice: (_request, choice) => {
      choices.push(choice);
      return nextAnswer;
    },
    onError: (error) => errors.push(error),
    seen: (_request, what) => {
      if (what.id !== KNOWN) return false;
      seen.push(what.id);
      return true;
    },
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

// Sends the path exactly as written, without the client tidying it up.
function get(path: string, method = 'GET', send?: { readonly body: string; readonly headers: Record<string, string> }): Promise<Answer> {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: send?.headers ?? {} }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end(send?.body);
  });
}

// What the screens send to mark a take-back seen.
function markSeen(body: string, headers: Record<string, string> = {}): Promise<Answer> {
  return get('/api/seen', 'POST', { body, headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}`, ...headers } });
}

// What the screens send as a choice.
function sendChoice(body: string, headers: Record<string, string> = {}): Promise<Answer> {
  return get('/api/choice', 'POST', { body, headers: { 'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}`, ...headers } });
}
const GOOD_CHOICE = { id: 'decision-0001', item: 'p1', choice: { to: 'wants' } };

describe('the web server', () => {
  it('every tab address gets the app, so a refresh or a notification link opens the right screen', async () => {
    for (const path of APP_PATHS) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.body, path).toContain('<title>app</title>');
      expect(res.headers['cache-control'], path).toBe('no-cache');
    }
  });

  it("serves Home's numbers as JSON, never kept by the browser", async () => {
    const res = await get('/api/home');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual(VIEW);
  });

  it('when Home cannot be worked out, the phone is told without the details', async () => {
    failHome = true;
    try {
      const res = await get('/api/home');
      expect(res.status).toBe(500);
      expect(JSON.parse(res.body)).toEqual({ error: 'home-unavailable' });
      expect(res.body).not.toContain('private');
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      failHome = false;
    }
  });

  it('built files are served with their type, and files named by their content are kept', async () => {
    const res = await get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await get('/manifest.webmanifest')).headers['content-type']).toBe('application/manifest+json; charset=utf-8');
  });

  it('nothing outside the app folder is ever served', async () => {
    for (const path of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/%2e%2e%5csecret.txt', '/..\\secret.txt', '/secret.txt']) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(res.body, path).not.toContain('not for the phone');
    }
  });

  it('unknown addresses are not found, and unknown API addresses say so as JSON', async () => {
    expect((await get('/nope')).status).toBe(404);
    expect((await get('/assets')).status).toBe(404);
    const api = await get('/api/nope');
    expect(api.status).toBe(404);
    expect(JSON.parse(api.body)).toEqual({ error: 'not-found' });
  });

  it('a broken address is refused, not a crash', async () => {
    expect((await get('/%E0%A4%A')).status).toBe(400);
  });

  it('0.4 it only reads, apart from marking something seen: anything but GET and HEAD is refused', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      for (const path of ['/api/home', '/home', '/api/nope', '/api/seen/extra']) {
        const res = await get(path, method);
        expect(res.status, `${method} ${path}`).toBe(405);
        expect(res.headers['allow']).toBe('GET, HEAD');
      }
    }
    for (const method of ['PUT', 'DELETE', 'PATCH', 'GET']) {
      const res = await get('/api/seen', method);
      expect(res.status, method).toBe(405);
      expect(res.headers['allow']).toBe('POST');
    }
    const head = await get('/home', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  it('10.6 marking a take-back seen: the server is told which one, and answers with nothing', async () => {
    const before = seen.length;
    const res = await markSeen(JSON.stringify({ kind: 'bank-took-back', id: KNOWN }));
    expect(res.status).toBe(204);
    expect(res.body).toBe('');
    expect(seen.slice(before)).toEqual([KNOWN]);
  });

  it('10.6 an id the book does not have is not found', async () => {
    const res = await markSeen(JSON.stringify({ kind: 'bank-took-back', id: 'nothing-like-this' }));
    expect(res.status).toBe(404);
  });

  it('only what the screens send is taken: JSON of the one shape, small, from the app itself', async () => {
    const before = seen.length;
    const good = JSON.stringify({ kind: 'bank-took-back', id: KNOWN });
    expect((await markSeen(good, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await markSeen(good, { 'Content-Type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect((await markSeen(good, { Origin: 'https://somewhere-else.example' })).status).toBe(403);
    expect((await markSeen(good, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await markSeen('{not json')).status).toBe(400);
    expect((await markSeen(JSON.stringify({ kind: 'move-money', id: KNOWN }))).status).toBe(400);
    expect((await markSeen(JSON.stringify({ kind: 'bank-took-back', id: 7 }))).status).toBe(400);
    expect((await markSeen(JSON.stringify({ kind: 'bank-took-back', id: '' }))).status).toBe(400);
    expect((await markSeen(JSON.stringify({ kind: 'bank-took-back', id: KNOWN, extra: 'x' }))).status).toBe(400);
    expect((await markSeen(JSON.stringify({ kind: 'bank-took-back', id: 'x'.repeat(5000) }))).status).toBe(413);
    expect(seen.length).toBe(before);
  });

  it("serves the Buckets and Review screens' numbers as JSON, never kept by the browser", async () => {
    for (const [path, view] of [
      ['/api/buckets', BUCKETS],
      ['/api/review', REVIEW],
    ] as const) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers['content-type'], path).toBe('application/json; charset=utf-8');
      expect(res.headers['cache-control'], path).toBe('no-store');
      expect(JSON.parse(res.body), path).toEqual(view);
    }
  });

  it('when Buckets cannot be worked out, the phone is told without the details', async () => {
    failBuckets = true;
    try {
      const res = await get('/api/buckets');
      expect(res.status).toBe(500);
      expect(JSON.parse(res.body)).toEqual({ error: 'buckets-unavailable' });
      expect(res.body).not.toContain('private');
    } finally {
      failBuckets = false;
    }
  });

  it('0.4 the Buckets and Review numbers can only be read: anything else is refused', async () => {
    for (const path of ['/api/buckets', '/api/review']) {
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        const res = await get(path, method);
        expect(res.status, `${method} ${path}`).toBe(405);
        expect(res.headers['allow']).toBe('GET, HEAD');
      }
    }
  });

  it('4.7 a choice for an item in review is handed to the desk, and the answer comes back as it was given', async () => {
    const before = choices.length;
    const res = await sendChoice(JSON.stringify(GOOD_CHOICE));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual(DONE);
    expect(choices.slice(before)).toEqual([GOOD_CHOICE]);
  });

  it('a refused choice is a well-formed answer with the reason, not a server error', async () => {
    nextAnswer = { ok: false, code: 'refused', why: 'The parts add up to $11.00, but this is $11.50. Nothing was changed.' };
    try {
      const res = await sendChoice(JSON.stringify(GOOD_CHOICE));
      expect(res.status).toBe(422);
      expect(JSON.parse(res.body)).toEqual(nextAnswer);
    } finally {
      nextAnswer = DONE;
    }
  });

  it('only a choice of exactly the right shape, small, from the app itself, is taken', async () => {
    const before = choices.length;
    const good = JSON.stringify(GOOD_CHOICE);
    expect((await sendChoice(good, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await sendChoice(good, { 'Content-Type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    expect((await sendChoice(good, { Origin: 'https://somewhere-else.example' })).status).toBe(403);
    expect((await sendChoice(good, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await sendChoice('{not json')).status).toBe(400);
    expect((await sendChoice('null')).status).toBe(400);
    expect((await sendChoice(JSON.stringify({ ...GOOD_CHOICE, choice: { to: 'groceries' } }))).status).toBe(400);
    expect((await sendChoice(JSON.stringify({ ...GOOD_CHOICE, id: 'x' }))).status).toBe(400);
    expect((await sendChoice(JSON.stringify({ ...GOOD_CHOICE, extra: 1 }))).status).toBe(400);
    expect((await sendChoice(JSON.stringify({ ...GOOD_CHOICE, always: { contains: 'x'.repeat(5000) } }))).status).toBe(413);
    expect(choices.length).toBe(before);
  });

  it('a choice is only ever a POST', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const res = await get('/api/choice', method);
      expect(res.status, method).toBe(405);
      expect(res.headers['allow']).toBe('POST');
    }
  });

  it('without a desk to hand choices to, nothing can be sent, and without the views they are not found', async () => {
    const bare = createAppServer({ webRoot: folder, home: () => VIEW });
    await new Promise<void>((done) => bare.listen(0, '127.0.0.1', done));
    try {
      const barePort = (bare.address() as AddressInfo).port;
      const ask = (path: string, method: string): Promise<Answer> =>
        new Promise((done, fail) => {
          const req = httpRequest({ host: '127.0.0.1', port: barePort, path, method, headers: { 'Content-Type': 'application/json' } }, (r) => {
            let body = '';
            r.on('data', (chunk: Buffer) => (body += String(chunk)));
            r.on('end', () => done({ status: r.statusCode ?? 0, headers: r.headers, body }));
          });
          req.on('error', fail);
          req.end(method === 'POST' ? JSON.stringify(GOOD_CHOICE) : undefined);
        });
      expect((await ask('/api/choice', 'POST')).status).toBe(405);
      for (const path of ['/api/buckets', '/api/review']) expect((await ask(path, 'GET')).status, path).toBe(404);
    } finally {
      bare.closeAllConnections();
      await new Promise<void>((done) => bare.close(() => done()));
    }
  });

  it('every answer carries the security headers: only its own scripts and styles, no framing', async () => {
    for (const path of ['/home', '/api/home', '/api/buckets', '/api/review', '/assets/index-abc123.js', '/nope', '/api/nope']) {
      const res = await get(path);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers[name.toLowerCase()], `${path} ${name}`).toBe(value);
    }
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain("script-src 'self'");
    expect(SECURITY_HEADERS['Content-Security-Policy']).not.toContain('unsafe');
  });
});
