import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Pot } from '@budget-app/money';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_PATHS, SCREEN_PATHS, SECURITY_HEADERS, createAppServer } from '../src/http/server.js';
import type { ActivityView } from '../src/views/activity.js';
import type { ChoiceResponse, MoveRequest, MoveResponse } from '../src/views/choice.js';
import type { HomeView } from '../src/views/home.js';
import type { PaydayView } from '../src/views/payday.js';

// The web server's newer addresses: the screen of each bucket's activity and
// Payday (QUESTIONS.md B97, B104), and hand moves (B103). It only reads,
// except for his choices, which the money math decides.

const HOME: HomeView = { state: 'not-set-up', madeUpData: true };
const PAYDAY: PaydayView = { state: 'not-set-up', madeUpData: true };
const activityFor = (pot: Pot): ActivityView => ({ state: 'not-set-up', madeUpData: pot === 'needs' });

let folder: string;
let server: Server;
let port = 0;
let failActivity = false;
let failPayday = false;
const errors: unknown[] = [];
// What was asked of the made-up handlers.
const askedFor: Pot[] = [];
const moves: MoveRequest[] = [];
const choices: unknown[] = [];
const MOVED: MoveResponse = { ok: true, replayed: false, moved: { from: 'wants', to: 'needs', amount: 5_000 } };
const DONE: ChoiceResponse = { ok: true, replayed: false, done: { item: 'p1', choice: { to: 'wants' }, alsoSorted: 0, stillWaiting: [], sticks: null } };
let nextMove: MoveResponse = MOVED;

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'budget-screens-'));
  const webRoot = join(folder, 'dist');
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
  server = createAppServer({
    webRoot,
    home: () => HOME,
    activity: (_request, pot) => {
      if (failActivity) throw new Error('database said: something private');
      askedFor.push(pot);
      return activityFor(pot);
    },
    payday: () => {
      if (failPayday) throw new Error('database said: something private');
      return PAYDAY;
    },
    choice: (_request, choice) => {
      choices.push(choice);
      return DONE;
    },
    move: (_request, move) => {
      moves.push(move);
      return nextMove;
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

const GOOD_MOVE = { id: 'decision-0001', move: { from: 'wants', to: 'needs', amount: 5_000 } };

describe('B97 B104 the screens\' addresses', () => {
  it('the bucket screens and Payday get the app, so a refresh or a link opens the right screen', async () => {
    for (const path of SCREEN_PATHS) {
      const res = await ask(path);
      expect(res.status, path).toBe(200);
      expect(res.body, path).toContain('<title>app</title>');
      expect(res.headers['cache-control'], path).toBe('no-cache');
    }
  });

  it('1.1 there is a screen for each of the five buckets, Payday, the alerts and the bank connection, and they are not tabs', () => {
    expect([...SCREEN_PATHS].sort()).toEqual(['/buckets/held-for-others', '/buckets/mom-reserve', '/buckets/needs', '/buckets/savings', '/buckets/wants', '/payday', '/alerts', '/bank'].sort());
    for (const path of SCREEN_PATHS) expect(APP_PATHS).not.toContain(path);
  });

  it('nothing near those addresses gets the app', async () => {
    for (const path of ['/buckets/other', '/buckets/needs/extra', '/payday/', '/paydays', '/buckets/Needs', '/buckets/momReserve', '/buckets/constructor']) {
      expect((await ask(path)).status, path).toBe(404);
    }
  });
});

describe('B97 the activity of a bucket is served as JSON, never kept by the browser', () => {
  it('each bucket\'s address asks for that bucket', async () => {
    const before = askedFor.length;
    const slugs = { savings: 'savings', needs: 'needs', wants: 'wants', 'mom-reserve': 'momReserve', 'held-for-others': 'heldForOthers' } as const;
    for (const [slug, pot] of Object.entries(slugs)) {
      const res = await ask(`/api/activity/${slug}`);
      expect(res.status, slug).toBe(200);
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(JSON.parse(res.body), slug).toEqual(activityFor(pot));
    }
    expect(askedFor.slice(before)).toEqual(['savings', 'needs', 'wants', 'momReserve', 'heldForOthers']);
  });

  it('an address that is not a bucket is not found, as JSON', async () => {
    const before = askedFor.length;
    for (const path of ['/api/activity/unsortedIn', '/api/activity/', '/api/activity', '/api/activity/needs/extra', '/api/activity/momReserve', '/api/activity/constructor', '/api/activity/__proto__']) {
      const res = await ask(path);
      expect(res.status, path).toBe(404);
      expect(JSON.parse(res.body), path).toEqual({ error: 'not-found' });
    }
    expect(askedFor.length).toBe(before);
  });

  it('when a bucket\'s numbers cannot be worked out, the phone is told without the details', async () => {
    failActivity = true;
    try {
      const res = await ask('/api/activity/needs');
      expect(res.status).toBe(500);
      expect(JSON.parse(res.body)).toEqual({ error: 'activity-unavailable' });
      expect(res.body).not.toContain('private');
      expect(String(errors.at(-1))).toContain('private');
    } finally {
      failActivity = false;
    }
  });

  it('0.4 it can only be read: anything but GET and HEAD is refused', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await ask('/api/activity/needs', method);
      expect(res.status, method).toBe(405);
      expect(res.headers['allow']).toBe('GET, HEAD');
    }
    expect((await ask('/api/activity/needs', 'HEAD')).status).toBe(200);
  });
});

describe('B104 the Payday numbers are served as JSON, never kept by the browser', () => {
  it('they come as the handler gave them', async () => {
    const res = await ask('/api/payday');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual(PAYDAY);
  });

  it('when they cannot be worked out, the phone is told without the details', async () => {
    failPayday = true;
    try {
      const res = await ask('/api/payday');
      expect(res.status).toBe(500);
      expect(JSON.parse(res.body)).toEqual({ error: 'payday-unavailable' });
      expect(res.body).not.toContain('private');
    } finally {
      failPayday = false;
    }
  });

  it('0.4 they can only be read', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await ask('/api/payday', method);
      expect(res.status, method).toBe(405);
    }
  });
});

describe('B103 a hand move is handed to the money math, and the answer comes back as it was given', () => {
  it('13.3 a move reaches the move handler, parsed', async () => {
    const before = moves.length;
    const res = await sendChoice(JSON.stringify(GOOD_MOVE));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(res.body)).toEqual(MOVED);
    expect(moves.slice(before)).toEqual([GOOD_MOVE]);
    expect(choices).toEqual([]);
  });

  it('13.4 a move that asks first is a well-formed answer with the reasons, not a server error', async () => {
    nextMove = { ok: false, code: 'needs-confirmation', why: 'Moving $75.00 out of Savings needs your OK first: it takes money out of Savings. Nothing was changed.', reasons: ['out-of-savings'] };
    try {
      const res = await sendChoice(JSON.stringify(GOOD_MOVE));
      expect(res.status).toBe(422);
      expect(JSON.parse(res.body)).toEqual(nextMove);
    } finally {
      nextMove = MOVED;
    }
  });

  it('a choice for an item still goes to the desk, and not to the move handler', async () => {
    const before = { moves: moves.length, choices: choices.length };
    const res = await sendChoice(JSON.stringify({ id: 'decision-0002', item: 'p1', choice: { to: 'wants' } }));
    expect(res.status).toBe(200);
    expect(moves.length).toBe(before.moves);
    expect(choices.length).toBe(before.choices + 1);
  });

  it('only a move of exactly the right shape, small, from the app itself, is taken', async () => {
    const before = moves.length;
    const good = JSON.stringify(GOOD_MOVE);
    expect((await sendChoice(good, { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await sendChoice(good, { Origin: 'https://somewhere-else.example' })).status).toBe(403);
    expect((await sendChoice(good, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await sendChoice('{not json')).status).toBe(400);
    for (const bad of [
      { ...GOOD_MOVE, move: { ...GOOD_MOVE.move, amount: 0 } },
      { ...GOOD_MOVE, move: { ...GOOD_MOVE.move, amount: -5 } },
      { ...GOOD_MOVE, move: { ...GOOD_MOVE.move, amount: 1.5 } },
      { ...GOOD_MOVE, move: { ...GOOD_MOVE.move, amount: '5000' } },
      { ...GOOD_MOVE, move: { ...GOOD_MOVE.move, from: 'unsortedIn' } },
      { ...GOOD_MOVE, move: { from: 'wants', to: 'needs' } },
      { ...GOOD_MOVE, extra: 1 },
      { ...GOOD_MOVE, item: 'p1', choice: { to: 'wants' } },
      { ...GOOD_MOVE, id: 'x' },
    ]) {
      expect((await sendChoice(JSON.stringify(bad))).status, JSON.stringify(bad)).toBe(400);
    }
    expect(moves.length).toBe(before);
  });

  it('without a handler for moves, a move is not found (and choices still work)', async () => {
    const bare = createAppServer({ webRoot: join(folder, 'dist'), home: () => HOME, choice: () => DONE });
    await new Promise<void>((done) => bare.listen(0, '127.0.0.1', done));
    try {
      const barePort = (bare.address() as AddressInfo).port;
      expect((await sendChoice(JSON.stringify(GOOD_MOVE), {}, barePort)).status).toBe(404);
      expect((await sendChoice(JSON.stringify({ id: 'decision-0003', item: 'p1', choice: { to: 'wants' } }), {}, barePort)).status).toBe(200);
      expect((await ask('/api/activity/needs', 'GET', undefined, barePort)).status).toBe(404);
      expect((await ask('/api/payday', 'GET', undefined, barePort)).status).toBe(404);
    } finally {
      bare.closeAllConnections();
      await new Promise<void>((done) => bare.close(() => done()));
    }
  });

  it('every answer carries the security headers', async () => {
    for (const path of ['/payday', '/buckets/needs', '/api/activity/needs', '/api/payday', '/api/activity/nope']) {
      const res = await ask(path);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers[name.toLowerCase()], `${path} ${name}`).toBe(value);
    }
  });
});
