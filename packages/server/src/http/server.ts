import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { parseChoiceRequest } from '../choices.js';
import type { BucketsView } from '../views/buckets.js';
import type { ChoiceRequest, ChoiceResponse } from '../views/choice.js';
import type { HomeView } from '../views/home.js';
import type { ReviewView } from '../views/review.js';

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
  // 10.6: he has seen a take-back (QUESTIONS.md B84). Returns false when
  // there is no such take-back. Without it, nothing can be marked seen.
  readonly seen?: SeenHandler;
  // The Buckets and Review screens' numbers for this request.
  readonly buckets?: (request: IncomingMessage) => BucketsView | Promise<BucketsView>;
  readonly review?: (request: IncomingMessage) => ReviewView | Promise<ReviewView>;
  // His choice for an item waiting in review. The money math decides; a
  // refusal comes back as an answer, with why. Without it, nothing can be sent.
  readonly choice?: ChoiceHandler;
}

export type Seen = { readonly kind: 'bank-took-back'; readonly id: string };
export type SeenHandler = (request: IncomingMessage, what: Seen) => boolean | Promise<boolean>;
export type ChoiceHandler = (request: IncomingMessage, choice: ChoiceRequest) => ChoiceResponse | Promise<ChoiceResponse>;

// The most a "seen" request may carry; the real one is under 100 bytes.
const SEEN_LIMIT = 1024;
// A choice is small too: even a three-way split is under 400 bytes.
const CHOICE_LIMIT = 4096;

// Reads what the app's own page sent: JSON (which another site cannot send
// without the browser asking first), from this origin, and small. Answers
// the request itself and returns undefined when it is not that.
async function readOwnJson(request: IncomingMessage, response: ServerResponse, limit: number): Promise<unknown> {
  const type = (request.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') {
    send(response, 415, 'text/plain; charset=utf-8', 'JSON only.', 'no-store');
    return undefined;
  }
  const site = request.headers['sec-fetch-site'];
  const origin = request.headers.origin;
  const host = request.headers.host ?? '';
  if ((site !== undefined && site !== 'same-origin') || (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`)) {
    send(response, 403, 'text/plain; charset=utf-8', 'Only from the app itself.', 'no-store');
    return undefined;
  }
  let body = '';
  let tooBig = false;
  for await (const chunk of request) {
    body += String(chunk);
    if (Buffer.byteLength(body) > limit) {
      tooBig = true;
      break;
    }
  }
  if (tooBig) {
    response.setHeader('Connection', 'close');
    send(response, 413, 'text/plain; charset=utf-8', 'Too big.', 'no-store');
    return undefined;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    send(response, 400, 'text/plain; charset=utf-8', 'Not JSON.', 'no-store');
    return undefined;
  }
}

async function markSeen(request: IncomingMessage, response: ServerResponse, seen: SeenHandler): Promise<void> {
  const what = await readOwnJson(request, response, SEEN_LIMIT);
  if (response.writableEnded || response.headersSent) return;
  if (!isSeen(what)) {
    send(response, 400, 'text/plain; charset=utf-8', 'Not something that can be seen.', 'no-store');
    return;
  }
  if (!(await seen(request, what))) {
    send(response, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not-found' }), 'no-store');
    return;
  }
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
  response.setHeader('Cache-Control', 'no-store');
  response.statusCode = 204;
  response.end();
}

// His choice for an item in review. A malformed request is a bad request;
// anything well formed gets an answer: done, or refused with why (nothing
// changed). A repeat of the same decision gets the first answer again.
async function takeChoice(request: IncomingMessage, response: ServerResponse, choice: ChoiceHandler): Promise<void> {
  const sent = await readOwnJson(request, response, CHOICE_LIMIT);
  if (response.writableEnded || response.headersSent) return;
  const parsed = parseChoiceRequest(sent);
  if (parsed === null) {
    send(response, 400, 'text/plain; charset=utf-8', 'Not a choice that can be made.', 'no-store');
    return;
  }
  const answer = await choice(request, parsed);
  send(response, answer.ok ? 200 : 422, 'application/json; charset=utf-8', JSON.stringify(answer), 'no-store');
}

function isSeen(value: unknown): value is Seen {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const { kind, id } = value as Record<string, unknown>;
  return keys.join() === 'id,kind' && kind === 'bank-took-back' && typeof id === 'string' && id.length > 0 && id.length <= 200;
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
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      send(response, 400, 'text/plain; charset=utf-8', 'Bad address.', 'no-store');
      return;
    }
    // The one thing the screens can send: that he has seen a notice. It
    // changes no money (0.4).
    if (path === '/api/seen' && options.seen !== undefined) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        send(response, 405, 'text/plain; charset=utf-8', 'Only POST.', 'no-store');
        return;
      }
      await markSeen(request, response, options.seen);
      return;
    }
    // His choice for an item in review: it changes the app's books, never the bank (0.4).
    if (path === '/api/choice' && options.choice !== undefined) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        send(response, 405, 'text/plain; charset=utf-8', 'Only POST.', 'no-store');
        return;
      }
      await takeChoice(request, response, options.choice);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      send(response, 405, 'text/plain; charset=utf-8', 'Only GET and HEAD.', 'no-store');
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
    for (const [name, make] of [
      ['buckets', options.buckets],
      ['review', options.review],
    ] as const) {
      if (path !== `/api/${name}` || make === undefined) continue;
      let view: BucketsView | ReviewView;
      try {
        view = await make(request);
      } catch (error) {
        options.onError?.(error);
        send(response, 500, 'application/json; charset=utf-8', JSON.stringify({ error: `${name}-unavailable` }), 'no-store');
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
