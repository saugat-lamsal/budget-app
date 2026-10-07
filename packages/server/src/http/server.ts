import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { HomeView } from '../views/home.js';

// The web server for the screens (Phase 4): the built app from packages/web,
// and its numbers as JSON. It only reads. Hosting and login come later
// (Phase 6 and the passkey step); nothing here talks to the bank.

// The screens' own addresses, one per tab, so a refresh or a notification
// link opens the right one. Must match packages/web/src/app/routes.ts (a
// test checks).
export const APP_PATHS: readonly string[] = ['/', '/home', '/buckets', '/review', '/settings'];

export interface AppServerOptions {
  // The built screens (packages/web/dist).
  readonly webRoot: string;
  // Home's numbers for this request.
  readonly home: (request: IncomingMessage) => HomeView | Promise<HomeView>;
  // Extra addresses, for the demo only. Returns true when it answered.
  readonly extra?: (request: IncomingMessage, response: ServerResponse, path: string) => boolean | Promise<boolean>;
  // Told about anything that went wrong while answering, without the details
  // reaching the phone.
  readonly onError?: (error: unknown) => void;
}

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// Every answer: only this server's own scripts and styles run, the page
// cannot be framed, and no address is passed on to other sites.
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function createAppServer(options: AppServerOptions): Server {
  const webRoot = resolve(options.webRoot);
  return createServer((request, response) => {
    answer(request, response).catch((error: unknown) => {
      options.onError?.(error);
      if (!response.headersSent) send(response, 500, 'text/plain; charset=utf-8', 'Something went wrong.', 'no-store');
      else response.destroy();
    });
  });

  async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      send(response, 405, 'text/plain; charset=utf-8', 'Only GET and HEAD.', 'no-store');
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      send(response, 400, 'text/plain; charset=utf-8', 'Bad address.', 'no-store');
      return;
    }

    if (path === '/api/home') {
      let view: HomeView;
      try {
        view = await options.home(request);
      } catch (error) {
        options.onError?.(error);
        send(response, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'home-unavailable' }), 'no-store');
        return;
      }
      send(response, 200, 'application/json; charset=utf-8', JSON.stringify(view), 'no-store');
      return;
    }
    if (path.startsWith('/api/')) {
      send(response, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not-found' }), 'no-store');
      return;
    }
    if (options.extra !== undefined && (await options.extra(request, response, path))) return;

    if (APP_PATHS.includes(path)) {
      await sendFile(response, join(webRoot, 'index.html'), 'no-cache');
      return;
    }
    // A file of the built app, never anything outside it.
    const file = resolve(webRoot, `.${path}`);
    if (!file.startsWith(webRoot + sep) || path.includes('\0')) {
      send(response, 404, 'text/plain; charset=utf-8', 'Not found.', 'no-store');
      return;
    }
    const info = await stat(file).catch(() => null);
    if (info === null || !info.isFile()) {
      send(response, 404, 'text/plain; charset=utf-8', 'Not found.', 'no-store');
      return;
    }
    // Built files under /assets/ have their content in their name, so they
    // never change; everything else is checked again each time.
    await sendFile(response, file, path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  }
}

async function sendFile(response: ServerResponse, file: string, cache: string): Promise<void> {
  const body = await readFile(file);
  send(response, 200, TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', body, cache);
}

export function send(response: ServerResponse, status: number, type: string, body: string | Buffer, cache: string): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  response.setHeader('Content-Type', type);
  response.setHeader('Cache-Control', cache);
  response.setHeader('Content-Length', Buffer.byteLength(body));
  response.statusCode = status;
  response.end(response.req.method === 'HEAD' ? undefined : body);
}
