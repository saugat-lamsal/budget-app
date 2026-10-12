import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { Pot } from '@budget-app/money';
import { BACKUP_BEAT_PATH, BACKUP_HEALTH_PATH, fromThisMachine } from '../backup/backup-watch.js';
import { parseRequest } from '../choices.js';
import { POT_SLUGS, potOfSlug, type ActivityView } from '../views/activity.js';
import type { AlertsView } from '../views/alerts.js';
import type { BucketsView } from '../views/buckets.js';
import type { BankRuleRequest, BankRuleResponse } from '../views/bank-rules.js';
import type { ChoiceRequest, ChoiceResponse, MoveRequest, MoveResponse, RuleRequest, RuleResponse, SettingsRequest, SettingsResponse, SetupRequest, SetupResponse } from '../views/choice.js';
import type { HomeView } from '../views/home.js';
import type { PaydayView } from '../views/payday.js';
import type { PushAnswer, PushOnRequest } from '../views/push.js';
import type { ReviewView } from '../views/review.js';
import type { SettingsView } from '../views/settings.js';
import type { SetupView } from '../views/setup.js';

// The web server for the screens (Phase 4): the built app from packages/web,
// and its numbers as JSON. It changes the app's books only with his answers,
// never the bank. On the real server every screen and every /api address
// needs him logged in with a passkey (Step 2, the gate below); the demo has
// no login. Phase 6: hosted on Fly.io, behind its proxy, at one https
// address (the gate's origin); a health address for an outside monitor.

// The screens' own addresses, one per tab, so a refresh or a notification
// link opens the right one. Must match packages/web/src/app/routes.ts (a
// test checks).
export const APP_PATHS: readonly string[] = ['/', '/home', '/buckets', '/review', '/settings'];

// The screens that are not tabs: the activity of each bucket, Payday, and the
// alerts sent (Phase 5). They get the app too. Must match
// packages/web/src/app/routes.ts (a test checks).
export const SCREEN_PATHS: readonly string[] = ['/payday', '/alerts', ...Object.keys(POT_SLUGS).map((slug) => `/buckets/${slug}`)];

// The Setup day screens, one address per step (section 14). They get the app
// too. Must match packages/web/src/app/routes.ts (a test checks).
export const SETUP_PATHS: readonly string[] = ['bank', 'rules', 'transfers', 'paycheck', 'assign', 'check'].map((step) => `/setup/${step}`);

// The login page (Step 2): on the real server, the one screen shown without a login.
export const LOGIN_PATH = '/login';

// Phase 6: for an outside uptime monitor. No login, any host name, and it
// says only "ok" (or "not ok"): never a number, never anything of his.
export const HEALTH_PATH = '/health';

// Phase 6: https only, for two years, on the hosted address (fly.dev).
export const HSTS = 'max-age=63072000; includeSubDomains';

// Step 3: how often the real server syncs with the bank (section 2), changed on Settings.
export const SYNC_EVERY_PATH = '/api/sync/every';

// Phase 5, the phone: Settings' Notifications card. Turn them on for this
// device (its push subscription), off, and send it a test alert. They change
// which devices get the alerts, never money (0.4).
export const PUSH_PATHS = { on: '/api/push/on', off: '/api/push/off', test: '/api/push/test' } as const;

export interface Route {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  // On the real server: refused without a good login.
  readonly login: boolean;
}

// The login's own addresses (Step 2, auth/http.ts answers them). Open: the
// login page's own; the rest need him logged in.
export const AUTH_ROUTES: readonly Route[] = [
  { method: 'GET', path: '/api/auth', login: false },
  { method: 'POST', path: '/api/auth/login/options', login: false },
  { method: 'POST', path: '/api/auth/login', login: false },
  { method: 'POST', path: '/api/auth/code/options', login: false },
  { method: 'POST', path: '/api/auth/code', login: false },
  { method: 'POST', path: '/api/auth/passkey/options', login: true },
  { method: 'POST', path: '/api/auth/passkey', login: true },
  { method: 'POST', path: '/api/auth/logout', login: true },
  { method: 'POST', path: '/api/auth/stay', login: true },
];

// Every address the real server answers with anything of his: every screen,
// every screen's numbers, his answers, and the login's own (a test checks
// each one against a login: login-guard.test.ts). The app's own files
// (scripts, styles, icons) are open: the login page needs them, and they hold
// nothing of his.
export const ROUTES: readonly Route[] = [
  ...[...APP_PATHS, ...SCREEN_PATHS, ...SETUP_PATHS].map((path): Route => ({ method: 'GET', path, login: true })),
  { method: 'GET', path: LOGIN_PATH, login: false },
  { method: 'GET', path: HEALTH_PATH, login: false },
  // A43: the backups' health, for a second monitor, and Litestream's beat (from this machine only).
  { method: 'GET', path: BACKUP_HEALTH_PATH, login: false },
  { method: 'GET', path: BACKUP_BEAT_PATH, login: false },
  ...['home', 'buckets', 'review', 'settings', 'setup', 'payday', 'alerts', ...Object.keys(POT_SLUGS).map((slug) => `activity/${slug}`)].map((name): Route => ({ method: 'GET', path: `/api/${name}`, login: true })),
  { method: 'POST', path: '/api/choice', login: true },
  { method: 'POST', path: '/api/seen', login: true },
  { method: 'POST', path: SYNC_EVERY_PATH, login: true },
  ...Object.values(PUSH_PATHS).map((path): Route => ({ method: 'POST', path, login: true })),
  ...AUTH_ROUTES,
];

// The real server's gate (Step 2): who is logged in, and the login's own
// addresses. Without it (the demo) there is no login.
export interface Gate {
  // The app's own address, as the browser shows it (http://localhost:5190, or
  // hosted https://budget-app-x7q2.fly.dev): every POST must come from it, and
  // every request be addressed to it. Hosted (https), every request must also
  // have reached the proxy over https.
  readonly origin: () => string;
  readonly loggedIn: (request: IncomingMessage) => boolean;
  // Answers one of AUTH_ROUTES: a status, a JSON body, and maybe a cookie.
  readonly auth: (path: string, request: IncomingMessage, body: unknown) => Promise<{ readonly status: number; readonly body: unknown; readonly setCookie?: string }>;
}

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
  // His hand move between buckets (13.3). The money math decides, and says
  // when it needs his yes first (13.4). Without it, no move can be sent.
  readonly move?: MoveHandler;
  // What went in and out of one bucket (QUESTIONS.md B97), and the Payday screen's numbers.
  readonly activity?: (request: IncomingMessage, pot: Pot) => ActivityView | Promise<ActivityView>;
  readonly payday?: (request: IncomingMessage) => PaydayView | Promise<PaydayView>;
  // The Settings screen's numbers (section 2, 13.1, 13.5).
  readonly settings?: (request: IncomingMessage) => SettingsView | Promise<SettingsView>;
  // His change to the settings, or to a sorting rule. The money math decides,
  // and says when it needs his yes first. Without them, none can be sent.
  readonly settingsChange?: SettingsHandler;
  readonly ruleChange?: RuleHandler;
  // Setup day (section 14): the screens' numbers, and his answers. The money
  // math decides; starting to track asks first. Without them, none can be sent.
  readonly setupView?: (request: IncomingMessage) => SetupView | Promise<SetupView>;
  readonly setup?: SetupHandler;
  // His change to the bank rules (section 2, 24c), on Setup day or Settings.
  // It asks first, with what the rule would match. Without it, none can be sent.
  readonly bankRule?: BankRuleHandler;
  // The real server's login (Step 2). Without it, no login: the demo.
  readonly gate?: Gate;
  // Step 3: how often the real server syncs with the bank, in minutes (section
  // 2). The books check it. Without it (the demo, which has no bank), none can be sent.
  readonly syncEvery?: (request: IncomingMessage, minutes: unknown) => { readonly ok: true } | { readonly ok: false; readonly why: string };
  // Phase 5: the alerts the real server worked out and sent. Without it (the
  // demo, which sends none), /api/alerts is not there.
  readonly alerts?: (request: IncomingMessage) => AlertsView | Promise<AlertsView>;
  // Phase 5, the phone: the Notifications card, for the device asking. Without
  // it (the demo, which sends no alerts), the addresses are not there.
  readonly push?: PushHandlers;
  // Phase 6: whether the server can read its books now, for /health. Without
  // it (the demo), the address is not there.
  readonly health?: () => boolean;
  // A43: whether Litestream's heartbeat still comes, for /health/backups, and
  // its beat. Only the hosted server has it: on a computer there is no backup.
  readonly backups?: { readonly beat: () => void; readonly healthy: () => boolean };
}

export interface PushHandlers {
  readonly on: (request: IncomingMessage, subscription: PushOnRequest) => PushAnswer;
  readonly off: (request: IncomingMessage) => PushAnswer;
  readonly test: (request: IncomingMessage) => Promise<PushAnswer>;
}

export type Seen = { readonly kind: 'bank-took-back'; readonly id: string };
export type SeenHandler = (request: IncomingMessage, what: Seen) => boolean | Promise<boolean>;
export type ChoiceHandler = (request: IncomingMessage, choice: ChoiceRequest) => ChoiceResponse | Promise<ChoiceResponse>;
export type MoveHandler = (request: IncomingMessage, move: MoveRequest) => MoveResponse | Promise<MoveResponse>;
export type SettingsHandler = (request: IncomingMessage, change: SettingsRequest) => SettingsResponse | Promise<SettingsResponse>;
export type RuleHandler = (request: IncomingMessage, change: RuleRequest) => RuleResponse | Promise<RuleResponse>;
export type SetupHandler = (request: IncomingMessage, answer: SetupRequest) => SetupResponse | Promise<SetupResponse>;
export type BankRuleHandler = (request: IncomingMessage, change: BankRuleRequest) => BankRuleResponse | Promise<BankRuleResponse>;

// What handles each kind of request sent to /api/choice.
interface ChoiceHandlers {
  readonly choice: ChoiceHandler | undefined;
  readonly move: MoveHandler | undefined;
  readonly settingsChange: SettingsHandler | undefined;
  readonly ruleChange: RuleHandler | undefined;
  readonly setup: SetupHandler | undefined;
  readonly bankRule: BankRuleHandler | undefined;
}

// The most a "seen" request may carry; the real one is under 100 bytes.
const SEEN_LIMIT = 1024;
// A passkey's answer is a few kilobytes at most.
const AUTH_LIMIT = 16_384;
// A choice is small too: even a three-way split is under 400 bytes, and a
// change to every setting at once under 1,000.
const CHOICE_LIMIT = 4096;
// A push subscription: an address of a few hundred characters and two keys.
const PUSH_LIMIT = 4096;

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
async function takeChoice(request: IncomingMessage, response: ServerResponse, handlers: ChoiceHandlers): Promise<void> {
  const sent = await readOwnJson(request, response, CHOICE_LIMIT);
  if (response.writableEnded || response.headersSent) return;
  const parsed = parseRequest(sent);
  if (parsed === null) {
    send(response, 400, 'text/plain; charset=utf-8', 'Not a choice that can be made.', 'no-store');
    return;
  }
  // A hand move, a settings change, a rule change, a setup day answer, or a
  // choice for an item:
  // each goes to what handles it, and when nothing does, it is as if the
  // address were not there.
  const answer =
    'move' in parsed
      ? await handlers.move?.(request, parsed)
      : 'settings' in parsed
        ? await handlers.settingsChange?.(request, parsed)
        : 'rule' in parsed
          ? await handlers.ruleChange?.(request, parsed)
          : 'setup' in parsed
            ? await handlers.setup?.(request, parsed)
            : 'bankRule' in parsed
              ? await handlers.bankRule?.(request, parsed)
              : await handlers.choice?.(request, parsed);
  if (answer === undefined) {
    send(response, 404, 'application/json; charset=utf-8', JSON.stringify({ error: 'not-found' }), 'no-store');
    return;
  }
  send(response, answer.ok ? 200 : 422, 'application/json; charset=utf-8', JSON.stringify(answer), 'no-store');
}

// What a browser's PushSubscription.toJSON() gives, and nothing else: the
// address, and the device's public key and secret (base64url).
function pushOnOf(value: unknown): PushOnRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).sort().join() !== 'endpoint,keys') return null;
  const { endpoint, keys } = value as Record<string, unknown>;
  if (typeof endpoint !== 'string' || endpoint.length === 0 || endpoint.length > 2048) return null;
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys) || Object.keys(keys).sort().join() !== 'auth,p256dh') return null;
  const { p256dh, auth } = keys as Record<string, unknown>;
  const key = (v: unknown, most: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= most && /^[A-Za-z0-9_-]+=*$/.test(v);
  if (!key(p256dh, 128) || !key(auth, 64)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

function isEmptyObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value).length === 0;
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
  'Cross-Origin-Resource-Policy': 'same-origin',
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
    // Hosted, every answer tells the browser: this address over https only.
    if (options.gate !== undefined && options.gate.origin().startsWith('https:')) response.setHeader('Strict-Transport-Security', HSTS);
    // Before the gate: the monitor needs no login, and Fly's own check comes
    // from inside, under the machine's own address.
    if (path === HEALTH_PATH && options.health !== undefined) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        send(response, 405, 'text/plain; charset=utf-8', 'Only GET and HEAD.', 'no-store');
        return;
      }
      const ok = options.health();
      send(response, ok ? 200 : 503, 'text/plain; charset=utf-8', ok ? 'ok\n' : 'not ok\n', 'no-store');
      return;
    }
    // A43, the same way: the backups, for the second monitor. /health stays
    // the server's alone (Fly uses it: "not ok" there would take the app away).
    if (path === BACKUP_HEALTH_PATH && options.backups !== undefined) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        send(response, 405, 'text/plain; charset=utf-8', 'Only GET and HEAD.', 'no-store');
        return;
      }
      const ok = options.backups.healthy();
      send(response, ok ? 200 : 503, 'text/plain; charset=utf-8', ok ? 'ok\n' : 'not ok\n', 'no-store');
      return;
    }
    // Litestream's beat: from this machine only, never through Fly's proxy.
    if (path === BACKUP_BEAT_PATH && options.backups !== undefined) {
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        send(response, 405, 'text/plain; charset=utf-8', 'Only GET.', 'no-store');
        return;
      }
      if (!fromThisMachine(request.socket.remoteAddress, request.headers)) {
        send(response, 403, 'text/plain; charset=utf-8', 'Only from this machine.', 'no-store');
        return;
      }
      options.backups.beat();
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
      response.setHeader('Cache-Control', 'no-store');
      response.statusCode = 204;
      response.end();
      return;
    }
    if (options.gate !== undefined && (await atTheGate(options.gate, request, response, path))) return;
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
    // How often the real server syncs with the bank: a setting, never the bank (0.4).
    if (path === SYNC_EVERY_PATH && options.syncEvery !== undefined) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        send(response, 405, 'text/plain; charset=utf-8', 'Only POST.', 'no-store');
        return;
      }
      const sent = await readOwnJson(request, response, SEEN_LIMIT);
      if (response.writableEnded || response.headersSent) return;
      if (typeof sent !== 'object' || sent === null || Array.isArray(sent) || Object.keys(sent).join() !== 'minutes') {
        send(response, 400, 'text/plain; charset=utf-8', 'Not a setting that can be changed.', 'no-store');
        return;
      }
      const said = options.syncEvery(request, (sent as { minutes: unknown }).minutes);
      send(response, said.ok ? 200 : 422, 'application/json; charset=utf-8', JSON.stringify(said), 'no-store');
      return;
    }
    // The Notifications card: which devices get the alerts, never money (0.4).
    const pushAction = (Object.entries(PUSH_PATHS) as [keyof typeof PUSH_PATHS, string][]).find(([, p]) => p === path)?.[0];
    if (pushAction !== undefined && options.push !== undefined) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        send(response, 405, 'text/plain; charset=utf-8', 'Only POST.', 'no-store');
        return;
      }
      const sent = await readOwnJson(request, response, PUSH_LIMIT);
      if (response.writableEnded || response.headersSent) return;
      const subscription = pushAction === 'on' ? pushOnOf(sent) : null;
      if (pushAction === 'on' ? subscription === null : !isEmptyObject(sent)) {
        send(response, 400, 'text/plain; charset=utf-8', 'Not something the Notifications card sends.', 'no-store');
        return;
      }
      const said = subscription !== null ? options.push.on(request, subscription) : pushAction === 'off' ? options.push.off(request) : await options.push.test(request);
      send(response, said.ok ? 200 : 422, 'application/json; charset=utf-8', JSON.stringify(said), 'no-store');
      return;
    }
    // His choices, moves, and changes to the settings: they change the app's
    // books, never the bank (0.4).
    const handlers: ChoiceHandlers = { choice: options.choice, move: options.move, settingsChange: options.settingsChange, ruleChange: options.ruleChange, setup: options.setup, bankRule: options.bankRule };
    if (path === '/api/choice' && Object.values(handlers).some((handler) => handler !== undefined)) {
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        send(response, 405, 'text/plain; charset=utf-8', 'Only POST.', 'no-store');
        return;
      }
      await takeChoice(request, response, handlers);
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
      ['settings', options.settings],
      ['setup', options.setupView],
      ['alerts', options.alerts],
    ] as const) {
      if (path !== `/api/${name}` || make === undefined) continue;
      let view: BucketsView | ReviewView | SettingsView | SetupView | AlertsView;
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
    // What went in and out of one bucket: /api/activity/needs.
    const activityPot = /^\/api\/activity\/([^/]+)$/.exec(path)?.[1];
    if (activityPot !== undefined && options.activity !== undefined) {
      const pot = potOfSlug(activityPot);
      if (pot !== null) {
        let view: ActivityView;
        try {
          view = await options.activity(request, pot);
        } catch (error) {
          options.onError?.(error);
          send(response, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'activity-unavailable' }), 'no-store');
          return;
        }
        send(response, 200, 'application/json; charset=utf-8', JSON.stringify(view), 'no-store');
        return;
      }
    }
    if (path === '/api/payday' && options.payday !== undefined) {
      let view: PaydayView;
      try {
        view = await options.payday(request);
      } catch (error) {
        options.onError?.(error);
        send(response, 500, 'application/json; charset=utf-8', JSON.stringify({ error: 'payday-unavailable' }), 'no-store');
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

    if (APP_PATHS.includes(path) || SCREEN_PATHS.includes(path) || SETUP_PATHS.includes(path) || (options.gate !== undefined && path === LOGIN_PATH)) {
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

// The real server's gate (Step 2). Answers the request itself, and returns
// true, when it is not for the app's own address, a POST did not come from
// the app's own page, it is one of the login's own addresses, or it needs a
// login it does not have. Otherwise lets it through.
async function atTheGate(gate: Gate, request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean> {
  const own = new URL(gate.origin());
  const host = request.headers.host ?? '';
  // Hosted: Fly's proxy takes the request over https and says so. Anything
  // that did not come that way is sent to the https address, or refused.
  if (own.protocol === 'https:' && request.headers['x-forwarded-proto'] !== 'https') {
    if (request.method === 'GET' || request.method === 'HEAD') {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
      response.setHeader('Location', `${own.origin}${request.url ?? '/'}`);
      response.setHeader('Cache-Control', 'no-store');
      response.statusCode = 308;
      response.end();
      return true;
    }
    send(response, 403, 'text/plain; charset=utf-8', 'Only over https.', 'no-store');
    return true;
  }
  if (host !== own.host) {
    // On this computer, the same server under its other loopback name: sent to
    // the app's own address, where the login and the passkeys are. Anything
    // else is not for us (hosted, only the one address is).
    const loopback = /^(localhost|127\.0\.0\.1)(:\d+)?$/.exec(host);
    const ownIsLoopback = own.hostname === 'localhost' || own.hostname === '127.0.0.1';
    if (ownIsLoopback && loopback !== null && (loopback[2] ?? '') === (own.port === '' ? '' : `:${own.port}`) && (request.method === 'GET' || request.method === 'HEAD')) {
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
      response.setHeader('Location', `${own.origin}${request.url ?? '/'}`);
      response.setHeader('Cache-Control', 'no-store');
      response.statusCode = 307;
      response.end();
      return true;
    }
    send(response, 421, 'text/plain; charset=utf-8', 'Not this address.', 'no-store');
    return true;
  }
  // Every POST from the app's own page, and only from it.
  if (request.method === 'POST') {
    const site = request.headers['sec-fetch-site'];
    if (request.headers.origin !== own.origin || (site !== undefined && site !== 'same-origin')) {
      send(response, 403, 'text/plain; charset=utf-8', 'Only from the app itself.', 'no-store');
      return true;
    }
  }
  const loggedIn = gate.loggedIn(request);
  const route = AUTH_ROUTES.find((r) => r.path === path);
  if (route !== undefined) {
    if (request.method !== route.method) {
      response.setHeader('Allow', route.method);
      send(response, 405, 'text/plain; charset=utf-8', `Only ${route.method}.`, 'no-store');
      return true;
    }
    if (route.login && !loggedIn) {
      send(response, 401, 'application/json; charset=utf-8', JSON.stringify({ error: 'login-needed' }), 'no-store');
      return true;
    }
    const body = route.method === 'POST' ? await readOwnJson(request, response, AUTH_LIMIT) : undefined;
    if (response.writableEnded || response.headersSent) return true;
    const answer = await gate.auth(path, request, body);
    if (answer.setCookie !== undefined) response.setHeader('Set-Cookie', answer.setCookie);
    send(response, answer.status, 'application/json; charset=utf-8', JSON.stringify(answer.body), 'no-store');
    return true;
  }
  if (loggedIn || path === LOGIN_PATH) return false;
  if (path.startsWith('/api/')) {
    send(response, 401, 'application/json; charset=utf-8', JSON.stringify({ error: 'login-needed' }), 'no-store');
    return true;
  }
  if (path === '/' || APP_PATHS.includes(path) || SCREEN_PATHS.includes(path) || SETUP_PATHS.includes(path)) {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
    response.setHeader('Location', LOGIN_PATH);
    response.setHeader('Cache-Control', 'no-store');
    response.statusCode = 303;
    response.end();
    return true;
  }
  // The app's own files: the login page needs them.
  return false;
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
