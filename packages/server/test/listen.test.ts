import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { HIGHEST_REFUSED_PORT, listenLocally } from './listen.js';

// Node's fetch, like a browser, refuses some ports (the fetch standard's "bad
// ports": 3659, 4045, 5060, 6000, 6566, 6665 to 6669, 6679, 10080, ...). This
// PC hands out ports from 1024 up, one after another (CI starts at 32768 or
// 49152), and gave a server test one of them on Nov 4: "fetch failed", caused
// by "bad port", in status-page.test.ts. Here the server is given such a port
// to start with, as the system could.

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((done) => server.close(() => done()));
});

function answering(): Server {
  const server = createServer((_request, response) => {
    response.setHeader('Connection', 'close');
    response.end('ok');
  });
  servers.push(server);
  return server;
}

async function freePortAbove(floor: number): Promise<number | null> {
  const probe = createServer();
  try {
    await new Promise<void>((done, fail) => {
      probe.once('error', fail);
      probe.listen(floor, '127.0.0.1', () => done());
    });
  } catch {
    return null;
  }
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

describe('test servers listen where fetch can reach them', () => {
  it('fetch refuses a port on the list, before it connects', async () => {
    const error = await fetch(`http://127.0.0.1:${HIGHEST_REFUSED_PORT}/`).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(String((error as { cause?: unknown }).cause)).toContain('bad port');
  });

  it('a server handed a port fetch refuses listens again above the list, and fetch reaches it', async () => {
    for (const refused of [3659, 4045, 6566, 6679, HIGHEST_REFUSED_PORT]) {
      const server = answering();
      let port: number;
      try {
        port = await listenLocally(server, refused);
      } catch {
        continue; // That port is taken here; try the next.
      }
      expect(port, `started on ${refused}`).toBeGreaterThan(HIGHEST_REFUSED_PORT);
      expect((server.address() as { port: number }).port).toBe(port);
      expect(await (await fetch(`http://localhost:${port}/`)).text()).toBe('ok');
      return;
    }
    throw new Error('every refused port tried is taken on this machine');
  });

  it('exactly at the end of the list (10080) it listens again; fetch reaches it where it moved', async () => {
    if ((await freePortAbove(HIGHEST_REFUSED_PORT)) !== HIGHEST_REFUSED_PORT) return; // Taken here: nothing to show.
    const server = answering();
    const port = await listenLocally(server, HIGHEST_REFUSED_PORT);
    expect(port).toBeGreaterThan(HIGHEST_REFUSED_PORT);
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('ok');
  });

  it('the first port past the list is kept, and fetch reaches it there', async () => {
    const above = await freePortAbove(HIGHEST_REFUSED_PORT + 1);
    if (above !== HIGHEST_REFUSED_PORT + 1) return; // Taken here: nothing to show.
    const server = answering();
    expect(await listenLocally(server, above)).toBe(HIGHEST_REFUSED_PORT + 1);
    expect(await (await fetch(`http://127.0.0.1:${above}/`)).text()).toBe('ok');
  });

  it('with no port asked for, it listens on 127.0.0.1 on one fetch can reach', async () => {
    const server = answering();
    const port = await listenLocally(server);
    expect(port).toBeGreaterThan(HIGHEST_REFUSED_PORT);
    expect((server.address() as { address: string }).address).toBe('127.0.0.1');
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe('ok');
  });

  it('a port that is taken is said, not silently moved', async () => {
    const first = answering();
    const port = await listenLocally(first);
    await expect(listenLocally(answering(), port)).rejects.toThrow();
  });
});
