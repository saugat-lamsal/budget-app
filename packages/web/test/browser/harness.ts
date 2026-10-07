import { parseDollars, type Cents } from '@budget-app/money';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, devices, webkit, type Browser, type BrowserContext, type BrowserContextOptions, type BrowserType, type Page, type Request } from 'playwright';
import { afterAll, beforeAll } from 'vitest';
import { createDemoServer } from '../../../server/src/demo/demo-server.js';
import { MINUS } from '../../src/ui/money-format.js';

// Browser tests: the built screens in real browsers, used like a person
// would on an iPhone, with what they show compared to the money math.
// Chromium, and WebKit because iPhone Safari is WebKit.

export const WEB_ROOT = fileURLToPath(new URL('../../dist/', import.meta.url));

export const ENGINES: readonly (readonly [string, BrowserType])[] = [
  ['chromium', chromium],
  ['webkit', webkit],
];

// An iPhone 15 as a home-screen app: the whole screen, no browser bars.
export const IPHONE = { width: 393, height: 852 } as const;
// Where the iPhone 15's Dynamic Island and home bar are (safe areas).
export const IPHONE_INSETS = { top: 59, bottom: 34 } as const;

export interface PhoneOptions {
  readonly colorScheme?: 'light' | 'dark';
  readonly reducedMotion?: 'reduce' | 'no-preference';
  // Only to add test styles (the notch, a bigger text size); the app itself
  // always runs under its own content security policy.
  readonly bypassCSP?: boolean;
  readonly deviceScaleFactor?: number;
}

export function phone(options: PhoneOptions = {}): BrowserContextOptions {
  return {
    userAgent: devices['iPhone 15']?.userAgent ?? 'iPhone',
    viewport: IPHONE,
    screen: IPHONE,
    deviceScaleFactor: options.deviceScaleFactor ?? 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: options.colorScheme ?? 'light',
    reducedMotion: options.reducedMotion ?? 'no-preference',
    bypassCSP: options.bypassCSP ?? false,
  };
}

// What each test server was asked, and when it answered, so a page that
// gets stuck can say whether its request reached the server at all.
interface ServerLogEntry {
  readonly method: string;
  readonly url: string;
  readonly at: number;
  done: number | null;
  status: number | null;
}
const serverLogs = new Map<string, ServerLogEntry[]>();

export async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const log: ServerLogEntry[] = [];
  serverLogs.set(base, log);
  server.on('request', (request, response) => {
    const entry: ServerLogEntry = { method: request.method ?? '?', url: request.url ?? '?', at: Date.now(), done: null, status: null };
    log.push(entry);
    if (log.length > 200) log.shift();
    response.on('finish', () => {
      entry.done = Date.now();
      entry.status = response.statusCode;
    });
  });
  return base;
}

// Follows a page's requests and console, for the report when it gets stuck.
const pageWatch = new WeakMap<Page, { readonly pending: Map<Request, number>; readonly failed: string[]; readonly console: string[] }>();

export function watchPage(page: Page): void {
  if (pageWatch.has(page)) return;
  const watch = { pending: new Map<Request, number>(), failed: [] as string[], console: [] as string[] };
  pageWatch.set(page, watch);
  page.on('request', (r) => watch.pending.set(r, Date.now()));
  page.on('requestfinished', (r) => watch.pending.delete(r));
  page.on('requestfailed', (r) => {
    watch.pending.delete(r);
    watch.failed.push(`${r.method()} ${r.url()}: ${r.failure()?.errorText ?? '?'}`);
  });
  page.on('console', (m) => watch.console.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => watch.console.push(`page error: ${e.message}`));
}

async function stuckReport(page: Page, base: string): Promise<string> {
  const now = Date.now();
  const watch = pageWatch.get(page);
  const state = await page
    .evaluate(() => ({
      readyState: document.readyState,
      rendered: document.getElementById('root')?.childElementCount ?? -1,
      home: document.querySelector('[data-testid="home"]')?.getAttribute('aria-busy') ?? 'no Home',
      visibility: document.visibilityState,
    }))
    .catch((error: unknown) => ({ evaluateFailed: String(error) }));
  const server = (serverLogs.get(base) ?? []).slice(-12).map((e) => `${e.method} ${e.url} at -${now - e.at}ms: ${e.done === null ? 'NOT ANSWERED' : `${e.status} after ${e.done - e.at}ms`}`);
  return [
    `page ${page.url()}: ${JSON.stringify(state)}`,
    `browser still waiting on: ${watch === undefined ? '(not watched)' : [...watch.pending].map(([r, at]) => `${r.method()} ${r.url()} for ${now - at}ms`).join('; ') || 'nothing'}`,
    `browser requests that failed: ${watch?.failed.join('; ') || 'none'}`,
    `console: ${watch?.console.slice(-10).join(' | ') || 'nothing'}`,
    `server, last requests: ${server.join('; ') || 'none'}`,
  ].join('\n');
}

// Waits for something on the page; if it never comes, fails with what the
// browser and the server were doing, instead of a bare timeout.
export async function waitOrReport(page: Page, base: string, selector: string, timeout = 15_000): Promise<void> {
  try {
    await page.locator(selector).first().waitFor({ timeout });
  } catch (error) {
    throw new Error(`waited ${timeout}ms for ${selector}\n${await stuckReport(page, base)}`, { cause: error });
  }
}

export async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}

// One browser of an engine and one demo server for a test file.
export function useEngine(engine: BrowserType): { browser: () => Browser; base: () => string } {
  let browser: Browser | undefined;
  let server: Server | undefined;
  let base = '';
  beforeAll(async () => {
    browser = await engine.launch();
    server = createDemoServer({ webRoot: WEB_ROOT });
    base = await listen(server);
  });
  afterAll(async () => {
    await browser?.close();
    if (server !== undefined) await close(server);
  });
  return {
    browser: () => {
      if (browser === undefined) throw new Error('no browser yet');
      return browser;
    },
    base: () => base,
  };
}

// Opens Home with one of the demo's made-up lives.
export async function openScenario(context: BrowserContext, base: string, scenario: string, path = '/home'): Promise<Page> {
  const page = await context.newPage();
  watchPage(page);
  await page.goto(`${base}/demo/${scenario}`);
  if (path !== '/home') await page.goto(`${base}${path}`);
  await waitOrReport(page, base, '[data-testid="home"]:not([aria-busy="true"]), [data-testid="buckets"], [data-testid="review"], [data-testid="settings"]');
  return page;
}

// Reads an amount off the screen as cents, the way a person reads it.
export function readCents(text: string): Cents {
  return parseDollars(text.trim().replace(MINUS, '-'));
}

export async function centsAt(page: Page, testId: string): Promise<Cents> {
  return readCents(await page.getByTestId(testId).innerText());
}

// Squashes the screen's text to single spaces, to compare words.
export async function textAt(page: Page, testId: string): Promise<string> {
  return (await page.getByTestId(testId).innerText()).replace(/\s+/g, ' ').trim();
}
