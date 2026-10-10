import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDemoServer } from '../src/demo/demo-server.js';
import { serverLinesIn } from '../src/server-log.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { loginForTests } from './login-for-tests.js';

// Step 3 on the real server's web side: Settings shows how often it syncs
// with the bank and when it last read it, and the setting is changed through
// its own address, logged in only, from the app's own page. The demo has no
// bank and no such address. Every name and number is made up.

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
  mkdirSync(webRoot, { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
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

function ask(r: { readonly port: number; readonly origin: string }, method: string, path: string, o: { readonly cookie?: string; readonly body?: string } = {}): Promise<{ readonly status: number; readonly body: string }> {
  const headers: Record<string, string> = { Host: `localhost:${r.port}` };
  if (o.cookie !== undefined) headers['Cookie'] = o.cookie;
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(o.body ?? ''));
    headers['Origin'] = r.origin;
    headers['Sec-Fetch-Site'] = 'same-origin';
  }
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: r.port, method, path, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += String(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on('error', reject);
    req.end(o.body);
  });
}

describe('Step 3: syncing with the bank on Settings', () => {
  it('section 2 Settings shows how often it syncs and when it last read the bank, in his home time zone, before setup day too', async () => {
    const r = await realServer();
    const cookie = loginForTests(r.life.h.db, r.life.now);
    const before = JSON.parse((await ask(r, 'GET', '/api/settings', { cookie })).body) as { sync?: unknown };
    expect(before.sync).toEqual({ everyMinutes: 60, checkedAt: null, today: '2026-10-01' });
    r.life.now = noonInNewYork('2026-10-02');
    await r.life.sync();
    const after = JSON.parse((await ask(r, 'GET', '/api/settings', { cookie })).body) as { sync?: unknown };
    expect(after.sync).toEqual({ everyMinutes: 60, checkedAt: { at: '2026-10-02T12:00:00-04:00', timeZone: 'America/New_York' }, today: '2026-10-02' });
    const home = JSON.parse((await ask(r, 'GET', '/api/home', { cookie })).body) as { checkedAt?: unknown };
    expect(home.checkedAt).toEqual({ at: '2026-10-02T12:00:00-04:00', timeZone: 'America/New_York' });
  });

  it('section 2 the setting changes through /api/sync/every: a whole number of minutes, 15 to 1,440; anything else is refused in words, or is not a request at all', async () => {
    const r = await realServer();
    const cookie = loginForTests(r.life.h.db, r.life.now);
    const send = (body: string): Promise<{ readonly status: number; readonly body: string }> => ask(r, 'POST', '/api/sync/every', { cookie, body });
    expect(await send('{"minutes":30}')).toEqual({ status: 200, body: '{"ok":true}' });
    expect(r.life.keeper.syncEveryMinutes()).toBe(30);
    expect(serverLinesIn(r.life.h.db).at(-1)).toMatchObject({ action: 'sync-every-changed', before: 60, after: 30 });
    expect(await send('{"minutes":14}')).toEqual({ status: 422, body: JSON.stringify({ ok: false, why: 'Syncing with the bank takes a whole number of minutes, 15 to 1,440. Nothing was changed.' }) });
    expect(await send('{"minutes":30}')).toEqual({ status: 422, body: JSON.stringify({ ok: false, why: 'That is already the setting. Nothing was changed.' }) });
    for (const body of ['{}', '{"minutes":30,"also":1}', '[30]', '30', 'not json']) expect((await send(body)).status, body).toBe(400);
    expect((await ask(r, 'GET', '/api/sync/every', { cookie })).status).toBe(405);
    expect(r.life.keeper.syncEveryMinutes()).toBe(30);
  });

  it('13.7 A31 through /api/choice too: an answer sent with what the screen showed is refused when a sync changed the item since', async () => {
    const r = await realServer();
    const cookie = loginForTests(r.life.h.db, r.life.now);
    r.life.h.fake.addPending({ id: 'cafe-1', account: ACCOUNT_IDS.everyday, amount: 1_150, date: '2026-10-01', description: 'MADE UP CAFE' });
    await r.life.sync();
    const review = JSON.parse((await ask(r, 'GET', '/api/review', { cookie })).body) as { items: { item: { id: string }; key: string }[] };
    const seen = review.items.find((d) => d.item.id === 'cafe-1')?.key;
    r.life.h.fake.postPending('cafe-1', { id: 'cafe-1-posted', date: '2026-10-02', amount: 1_350 });
    await r.life.sync();
    const answer = await ask(r, 'POST', '/api/choice', { cookie, body: JSON.stringify({ id: 'decision-http-1', item: 'cafe-1', choice: { to: 'wants' }, seen }) });
    expect(answer.status).toBe(422);
    expect(JSON.parse(answer.body)).toMatchObject({ ok: false, code: 'changed' });
    expect(r.life.keeper.book()?.reviewItems().map((i) => i.id)).toEqual(['cafe-1']);
  });

  it('section 2 without a login the setting cannot be changed', async () => {
    const r = await realServer();
    expect((await ask(r, 'POST', '/api/sync/every', { body: '{"minutes":30}' })).status).toBe(401);
    expect(r.life.keeper.syncEveryMinutes()).toBe(60);
  });

  it('section 2 the demo has no bank: no sync card, and the setting cannot be sent', async () => {
    const server = createDemoServer({ webRoot: join(process.cwd(), 'no-such-folder') });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      const r = { port, origin: `http://localhost:${port}` };
      const settings = JSON.parse((await ask(r, 'GET', '/api/settings')).body) as { sync?: unknown };
      expect(settings.sync).toBeUndefined();
      // Any POST it has no handler for is refused before its address is looked at.
      expect((await ask(r, 'POST', '/api/sync/every', { body: '{"minutes":30}' })).status).toBe(405);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
