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
});
