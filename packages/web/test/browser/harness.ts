import { parseDollars, type Cents } from '@budget-app/money';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, devices, webkit, type Browser, type BrowserContext, type BrowserContextOptions, type BrowserType, type Page } from 'playwright';
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

export async function listen(server: Server): Promise<string> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
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
  await page.goto(`${base}/demo/${scenario}`);
  if (path !== '/home') await page.goto(`${base}${path}`);
  await page.waitForSelector('[data-testid="home"]:not([aria-busy="true"]), [data-testid="buckets"], [data-testid="review"], [data-testid="settings"]');
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
