import { createServer, request, type IncomingHttpHeaders } from 'node:http';
import { describe, expect, it } from 'vitest';
import { close, listen } from './browser/harness.js';

// The servers the browser tests talk to. WebKit as Playwright builds it (on
// Linux and on Windows) loses the answer to a request when it reuses a
// connection whose last request was cancelled, or that the server is closing
// as the request goes out (CI, Oct 7 and Oct 8). Every answer from a test
// server therefore closes its connection: there is nothing left to reuse.

function headersOf(url: string): Promise<IncomingHttpHeaders> {
  return new Promise((resolve, reject) => {
    request(url, (response) => {
      response.resume();
      response.on('end', () => resolve(response.headers));
    })
      .on('error', reject)
      .end();
  });
}

describe('the servers the browser tests run against', () => {
  it('every answer closes its connection, so a browser has none to reuse that was cancelled or is closing', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('ok');
    });
    const base = await listen(server);
    try {
      expect((await headersOf(`${base}/`))['connection']).toBe('close');
    } finally {
      await close(server);
    }
  });

  // Browsers refuse to open some ports (Chromium's and WebKit's lists all end
  // at 10080: 3659, 4045, 5060, 6000, 6665 to 6669, ...). A computer that hands
  // out ports from 1024 up (this PC does, one after another; the CI machines
  // start at 32768 or 49152) gave a test server 3659 on Oct 9, and every test
  // on it failed with net::ERR_UNSAFE_PORT. Here the server is given such a
  // port to start with, as the system could.
  it('never listens on a port a browser could refuse', async () => {
    for (const refused of [3659, 4045, 6566, 6679, 10080]) {
      const server = createServer();
      let base: string;
      try {
        base = await listen(server, refused);
      } catch {
        continue; // That port is taken here; try the next.
      }
      await close(server);
      expect(Number(new URL(base).port), `started on ${refused}`).toBeGreaterThan(10_080);
      return;
    }
    throw new Error('every refused port tried is taken on this machine');
  });
});
