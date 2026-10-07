import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_PATHS, SECURITY_HEADERS, createAppServer } from '../src/http/server.js';
import type { HomeView } from '../src/views/home.js';

// The web server for the screens: it serves the built app and Home's
// numbers, nothing else, and never anything outside the app's folder.

const VIEW: HomeView = { state: 'not-set-up', madeUpData: true };

let folder: string;
let server: Server;
let port = 0;
let failHome = false;
const errors: unknown[] = [];

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

// Sends the path exactly as written, without the client tidying it up.
function get(path: string, method = 'GET'): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

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

  it('it only reads: anything but GET and HEAD is refused', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await get('/api/home', method);
      expect(res.status, method).toBe(405);
      expect(res.headers['allow']).toBe('GET, HEAD');
    }
    const head = await get('/home', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
  });

  it('every answer carries the security headers: only its own scripts and styles, no framing', async () => {
    for (const path of ['/home', '/api/home', '/assets/index-abc123.js', '/nope', '/api/nope']) {
      const res = await get(path);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers[name.toLowerCase()], `${path} ${name}`).toBe(value);
    }
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain("script-src 'self'");
    expect(SECURITY_HEADERS['Content-Security-Policy']).not.toContain('unsafe');
  });
});
