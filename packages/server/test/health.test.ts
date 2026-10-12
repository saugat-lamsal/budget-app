import { afterEach, describe, expect, it } from 'vitest';
import { createDemoServer } from '../src/demo/demo-server.js';
import { HEALTH_PATH } from '../src/http/server.js';
import { HOSTED_HOST, ask, firstLogin, servedAt, stop, type Running } from './hosted-harness.js';

// Phase 6: the health address, for an outside uptime monitor (and Fly's own
// check). It needs no login and answers under any host name (Fly's check
// comes from inside, under the machine's own address). It says only "ok"
// when the server can read its books, "not ok" when it cannot: never a
// number, never anything of his.

const running: Running[] = [];
afterEach(async () => {
  for (const r of running.splice(0)) await stop(r);
});

async function hosted(): Promise<Running> {
  const r = await servedAt();
  running.push(r);
  return r;
}

describe('Phase 6 the health address', () => {
  it('Phase 6 /health says "ok" and nothing else, with no login, no cookie, under any host name, over https or not', async () => {
    expect(HEALTH_PATH).toBe('/health');
    const r = await hosted();
    for (const host of [HOSTED_HOST, 'localhost', `127.0.0.1:${r.port}`, '172.19.3.2:8080', 'elsewhere.example']) {
      for (const proto of ['https', null, 'http']) {
        const answer = await ask(r, 'GET', '/health', { host, proto });
        expect(answer.status, `${host} ${String(proto)}`).toBe(200);
        expect(answer.body).toBe('ok\n');
        expect(answer.headers['content-type']).toBe('text/plain; charset=utf-8');
        expect(answer.headers['cache-control']).toBe('no-store');
        expect(answer.headers['set-cookie']).toBeUndefined();
      }
    }
  });

  it('Phase 6 /health says the same whatever the books hold, and whoever asks: never a number, never anything of his', async () => {
    const r = await hosted();
    const { cookie } = await firstLogin(r);
    await r.life.sync();
    for (const o of [{}, { cookie }, { host: 'elsewhere.example' }]) {
      const answer = await ask(r, 'GET', '/health', o);
      expect(answer.body).toBe('ok\n');
      expect(answer.body).not.toMatch(/\d/);
    }
    // Before setup day too.
    const fresh = await servedAt(undefined, false);
    running.push(fresh);
    expect((await ask(fresh, 'GET', '/health')).body).toBe('ok\n');
  });

  it('Phase 6 HEAD answers with no body; anything else is refused', async () => {
    const r = await hosted();
    const head = await ask(r, 'HEAD', '/health');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const answer = await ask(r, method, '/health');
      expect(answer.status, method).toBe(405);
      expect(answer.headers.allow).toBe('GET, HEAD');
    }
  });

  it('Phase 6 /health says "not ok" (503) when the server cannot read its books', async () => {
    const r = await hosted();
    expect((await ask(r, 'GET', '/health')).status).toBe(200);
    r.life.h.db.close();
    const answer = await ask(r, 'GET', '/health');
    expect(answer.status).toBe(503);
    expect(answer.body).toBe('not ok\n');
    // So afterEach's close finds it open.
    (r.life.h as { db: unknown }).db = { close: () => undefined };
  });

  it('Phase 6 the demo has no health address: it is the real server\'s', async () => {
    const server = createDemoServer({ webRoot: '.' });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const answer = await ask({ port, origin: `http://localhost:${port}` } as Running, 'GET', '/health');
    expect(answer.status).toBe(404);
    expect(answer.body).not.toBe('ok\n');
    await new Promise<void>((done) => server.close(() => done()));
  });
});
