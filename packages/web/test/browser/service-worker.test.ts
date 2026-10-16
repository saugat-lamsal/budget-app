import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { ENGINES, WEB_ROOT, phone, useEngine, waitOrReport } from './harness.js';

// Phase 5, the phone: the real service worker, as built (/sw.js from
// src/sw/sw.ts). First the built file itself, run in a stand-in for a
// service worker's world (its pushes and taps handed to it here, as a phone
// would): each alert shown with its id as its tag, its words and when it was
// due; a repeat dropped; a push it cannot read still shows something plain;
// a tap opens the screen it is about, in the app already open or a new one.
// (Browsers driven by Playwright cannot show notifications: headless Chromium
// refuses them, and WebKit cannot be handed a push.) Then in Chromium, the
// worker registered for real: it never serves the app's requests. Every name
// and number is made up.

interface Note {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly data: { readonly screen?: unknown };
}

const ORIGIN = 'https://budget.example';

// The built worker in a world of its own: what it showed, what it opened.
// 0.8: what the network does with a request the worker passes on: answer, fail, or never answer.
type Network = (request: { readonly url: string }) => Promise<Response>;

function builtWorker(
  windows: { url: string }[] = [],
  network: Network = () => Promise.reject(new TypeError('no network in this test')),
): {
  readonly notes: Note[];
  readonly opened: string[];
  readonly moved: string[];
  // Requests the worker passed on to the network.
  readonly asked: string[];
  // Timers the worker set, to run by hand (no real time passes here).
  readonly timers: { readonly ms: number; readonly run: () => void }[];
  push(text: string | null): Promise<void>;
  tap(note: Note): Promise<void>;
  swipe(note: Note): void;
  // A request from a page: whether the worker answered it, and with what (null when it left it to the browser).
  request(url: string, mode: 'navigate' | 'cors' | 'no-cors' | 'same-origin'): { readonly taken: boolean; readonly answer: Promise<Response> | null };
} {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const notes: Note[] = [];
  const opened: string[] = [];
  const moved: string[] = [];
  const asked: string[] = [];
  const timers: { ms: number; run: () => void }[] = [];
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    skipWaiting: async () => undefined,
    location: { origin: ORIGIN },
    registration: {
      // A new one with the same tag takes the place of the one before, as on a phone.
      showNotification: async (title: string, options: Omit<Note, 'title'>) => {
        const at = notes.findIndex((n) => n.tag === options.tag);
        if (at >= 0) notes.splice(at, 1);
        notes.push({ title, body: options.body, tag: options.tag, data: options.data });
      },
      getNotifications: async (filter: { tag?: string } = {}) => notes.filter((n) => filter.tag === undefined || n.tag === filter.tag),
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => windows.map((w) => ({ url: w.url, focus: async () => ({ navigate: async (url: string) => moved.push(url) }) })),
      openWindow: async (url: string) => opened.push(url),
    },
  };
  const fetch = (request: { readonly url: string }): Promise<Response> => {
    asked.push(request.url);
    return network(request);
  };
  const setTimeout = (run: () => void, ms: number): number => timers.push({ ms, run });
  const clearTimeout = (): void => undefined;
  runInNewContext(readFileSync(join(WEB_ROOT, 'sw.js'), 'utf8'), { self, URL, console, fetch, Response, setTimeout, clearTimeout });
  const fire = async (type: string, event: object): Promise<void> => {
    const waits: Promise<unknown>[] = [];
    for (const fn of listeners.get(type) ?? []) fn({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return {
    notes,
    opened,
    moved,
    asked,
    timers,
    request: (url, mode) => {
      let answer: Promise<Response> | null = null;
      for (const fn of listeners.get('fetch') ?? []) fn({ request: { url, mode }, respondWith: (p: Promise<Response>) => void (answer = p) });
      return { taken: answer !== null, answer };
    },
    push: (text) => fire('push', { data: text === null ? null : { text: () => text } }),
    // Closed by the worker, it leaves the screen, as on a phone.
    tap: (note) => fire('notificationclick', { notification: { data: note.data, close: () => void notes.splice(notes.indexOf(note) >>> 0, notes.includes(note) ? 1 : 0) } }),
    // He swipes it away: off the screen, and the worker is not told.
    swipe: (note) => void notes.splice(notes.indexOf(note) >>> 0, notes.includes(note) ? 1 : 0),
  };
}

const alert = { id: 'low-bucket needs pay period 3', title: 'Needs is low', body: 'Open the app to see what is left this pay period.', due: 'Was due 3:10 AM.', screen: '/buckets/needs' };

describe('the service worker as built', () => {
  it('Phase 5 10.12 0.8 it listens for pushes, taps, and page navigations only: it keeps no copy of anything the server sends, and only the ids of the alerts it showed (A42)', () => {
    const code = readFileSync(join(WEB_ROOT, 'sw.js'), 'utf8');
    const events = [...code.matchAll(/addEventListener\(\s*["'`](\w+)["'`]/g)].map((m) => m[1]).sort();
    expect(events).toEqual(['activate', 'fetch', 'install', 'notificationclick', 'push']);
    expect(code).not.toMatch(/\b(caches|localStorage|sessionStorage|CacheStorage)\b/);
    // 0.8: one request of its own, the page navigation it passes on.
    expect(code.match(/\bfetch\(/g)).toHaveLength(1);
    expect([...code.matchAll(/indexedDB\.open\(\s*["'`]([\w-]+)["'`]/g)].map((m) => m[1])).toEqual(['budget-alerts-shown']);
  });

  it('0.8 a screen opened while the server cannot be reached: the plain page instead of a blank one', async () => {
    const w = builtWorker();
    const { taken, answer } = w.request(`${ORIGIN}/home`, 'navigate');
    expect(taken).toBe(true);
    const page = await answer!;
    expect(page.status).toBe(503);
    const html = await page.text();
    expect(html).toContain("Can't reach the app right now.");
    expect(html).toContain('Your money is safe; the server is offline or restarting. Try again in a few minutes.');
    expect(html).toContain('>Try again</a>');
    expect(w.asked).toEqual([`${ORIGIN}/home`]);
  });

  it('0.8 the host saying the server is not running (502, 503, 504): the plain page; any other answer is the server\'s own, as it came', async () => {
    for (const status of [502, 503, 504]) {
      const w = builtWorker([], async () => new Response('the host says no', { status }));
      expect(await (await w.request(`${ORIGIN}/buckets`, 'navigate').answer!).text(), String(status)).toContain("Can't reach the app right now.");
    }
    for (const status of [200, 404, 500]) {
      const sent = new Response(`the server's own ${status}`, { status });
      const w = builtWorker([], async () => sent);
      const answer = await w.request(`${ORIGIN}/review`, 'navigate').answer!;
      expect(answer, String(status)).toBe(sent);
    }
  });

  it('0.8 no answer within 15 seconds: the plain page; an answer before then is shown as it came', async () => {
    const w = builtWorker([], () => new Promise<Response>(() => undefined));
    const { answer } = w.request(`${ORIGIN}/settings`, 'navigate');
    expect(w.timers.map((t) => t.ms)).toEqual([15_000]);
    w.timers[0]!.run();
    expect(await (await answer!).text()).toContain("Can't reach the app right now.");
    const sent = new Response('the app', { status: 200 });
    const quick = builtWorker([], async () => sent);
    expect(await quick.request(`${ORIGIN}/settings`, 'navigate').answer!).toBe(sent);
  });

  it('0.8 never for the numbers or anything else: what a screen asks for, the health checks, Plaid\'s webhook and other sites go to the network as if the worker were not there', () => {
    const w = builtWorker();
    for (const [url, mode] of [
      [`${ORIGIN}/api/home`, 'cors'],
      [`${ORIGIN}/api/home`, 'same-origin'],
      [`${ORIGIN}/api/status`, 'navigate'],
      [`${ORIGIN}/health`, 'navigate'],
      [`${ORIGIN}/health/backups`, 'navigate'],
      [`${ORIGIN}/plaid/webhook`, 'navigate'],
      [`${ORIGIN}/assets/app.js`, 'no-cors'],
      ['https://cdn.plaid.com/link/v2/stable/link.html', 'navigate'],
    ] as const) {
      expect(w.request(url, mode).taken, url).toBe(false);
    }
    expect(w.asked).toEqual([]);
  });

  it('0.8 the app registers its background part each time it opens from its https address, and only there', () => {
    const main = readFileSync(new URL('../../src/main.tsx', import.meta.url), 'utf8');
    expect(main).toMatch(/if \(window\.location\.protocol === 'https:' && 'serviceWorker' in navigator\) void navigator\.serviceWorker\.register\('\/sw\.js', \{ scope: '\/' \}\)/);
    expect(main.match(/serviceWorker\.register\(/g)).toHaveLength(1);
  });

  it('Phase 5 an alert is shown with its id as its tag, its words and when it was due; the same id again is dropped', async () => {
    const w = builtWorker();
    await w.push(JSON.stringify(alert));
    await w.push(JSON.stringify({ ...alert, body: 'a repeat must not change it' }));
    await w.push(JSON.stringify({ ...alert, id: 'daily-review 2026-10-12', title: 'Time to review', body: '1 thing is waiting for you to sort.', due: null, screen: '/review' }));
    expect(w.notes).toEqual([
      { title: 'Needs is low', body: `${alert.body} Was due 3:10 AM.`, tag: alert.id, data: { screen: '/buckets/needs' } },
      { title: 'Time to review', body: '1 thing is waiting for you to sort.', tag: 'daily-review 2026-10-12', data: { screen: '/review' } },
    ]);
  });

  it('Phase 5 B181 a repeat of one he already swiped away is dropped too, while the worker runs', async () => {
    const w = builtWorker();
    await w.push(JSON.stringify(alert));
    w.swipe(w.notes[0]!);
    await w.push(JSON.stringify({ ...alert, body: 'a repeat must not show again' }));
    expect(w.notes).toEqual([]);
  });

  it('Phase 5 two copies of one alert arriving at once show once', async () => {
    const w = builtWorker();
    await Promise.all([w.push(JSON.stringify(alert)), w.push(JSON.stringify(alert))]);
    expect(w.notes.map((n) => n.tag)).toEqual([alert.id]);
  });

  it('Phase 5 after the phone stopped and started the worker again, a repeat of one still on the screen is dropped', async () => {
    const before = builtWorker();
    await before.push(JSON.stringify(alert));
    // A fresh worker that remembers nothing, with the notification still on the screen.
    const after = builtWorker();
    after.notes.push(...before.notes);
    await after.push(JSON.stringify({ ...alert, body: 'a repeat must not change it' }));
    expect(after.notes.map((n) => n.body)).toEqual([`${alert.body} Was due 3:10 AM.`]);
  });

  it('Phase 5 a push it cannot read still shows something plain; a screen that is not the app\'s opens Home', async () => {
    const w = builtWorker();
    await w.push('not json');
    await w.push(null);
    await w.push(JSON.stringify({ ...alert, id: 'x', screen: 'https://evil.example/' }));
    expect(w.notes.map((n) => [n.tag, n.title, n.data.screen])).toEqual([
      ['unreadable', 'Budget', '/home'],
      ['x', 'Needs is low', '/home'],
    ]);
  });

  it('Phase 5 a tap opens the screen it is about: in the app already open, or a new one', async () => {
    const closed = builtWorker();
    await closed.push(JSON.stringify(alert));
    await closed.tap(closed.notes[0]!);
    expect(closed.opened).toEqual([`${ORIGIN}/buckets/needs`]);
    // The alert tapped leaves the screen.
    expect(closed.notes).toEqual([]);
    const open = builtWorker([{ url: `${ORIGIN}/home` }]);
    await open.push(JSON.stringify({ ...alert, screen: '/review' }));
    await open.tap(open.notes[0]!);
    expect([open.moved, open.opened]).toEqual([[`${ORIGIN}/review`], []]);
  });
});

const runs = ENGINES.some(([name]) => name === 'chromium');

describe.runIf(runs)('the service worker registered in Chromium', () => {
  const { browser, base } = useEngine(chromium);

  it('Phase 5 0.8 it never keeps or serves the app\'s numbers: with it in charge of the page, every request a screen makes goes to the server, and only opening a screen passes through it', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    await page.goto(`${base()}/demo/normal`);
    await waitOrReport(page, 'main[aria-busy="false"]');
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
    });
    const fromWorker: { url: string; type: string }[] = [];
    const numbers: string[] = [];
    page.on('response', (r) => {
      if (r.fromServiceWorker()) fromWorker.push({ url: new URL(r.url()).pathname, type: r.request().resourceType() });
      if (new URL(r.url()).pathname.startsWith('/api/')) numbers.push(`${new URL(r.url()).pathname} ${r.fromServiceWorker() ? 'worker' : 'server'}`);
    });
    await page.reload();
    await waitOrReport(page, 'main[aria-busy="false"]');
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await page.goto(`${base()}/buckets`);
    await waitOrReport(page, 'main[aria-busy="false"]');
    // The two screens opened, passed on to the server as they were; the numbers straight from the server.
    expect(fromWorker).toEqual([
      { url: '/home', type: 'document' },
      { url: '/buckets', type: 'document' },
    ]);
    expect(numbers.length).toBeGreaterThan(0);
    for (const n of numbers) expect(n).toMatch(/ server$/);
    expect(await page.evaluate(async () => (await caches.keys()).length)).toBe(0);
    await context.close();
  });
});

// 10.12 (QUESTIONS.md A42): the built worker keeps the ids of the newest 500
// alerts it showed in its own storage, so a repeat is dropped after the phone
// stopped and started it again, even of one he swiped away. Run here inside a
// real page of the app, as a stand-in for a worker's world whose storage is
// the browser's own IndexedDB (each test a fresh context, so fresh storage).
interface Kept {
  readonly shown: readonly (readonly string[])[];
  readonly kept: readonly unknown[];
}

async function inThePage(page: import('playwright').Page, code: string, runs: readonly (readonly string[])[]): Promise<Kept> {
  return page.evaluate(
    async ({ code, runs }) => {
      const shown: string[][] = [];
      for (const ids of runs) {
        // A fresh start of the worker: nothing in memory, nothing on the screen (swiped away).
        const listeners: Record<string, ((event: unknown) => void)[]> = {};
        const notes: string[] = [];
        const self = {
          addEventListener: (type: string, fn: (event: unknown) => void) => void (listeners[type] = [...(listeners[type] ?? []), fn]),
          skipWaiting: async () => undefined,
          location: { origin: location.origin },
          indexedDB: window.indexedDB,
          registration: { showNotification: async (_title: string, options: { tag: string }) => void notes.push(options.tag), getNotifications: async () => [] },
          clients: { claim: async () => undefined, matchAll: async () => [], openWindow: async () => undefined },
        };
        new Function('self', 'URL', code)(self, URL);
        for (const id of ids) {
          const waits: Promise<unknown>[] = [];
          const text = JSON.stringify({ id, title: 'Needs is low', body: 'Open the app to see what is left this pay period.', due: null, screen: '/buckets/needs' });
          for (const fn of listeners['push'] ?? []) fn({ data: { text: () => text }, waitUntil: (p: Promise<unknown>) => waits.push(p) });
          await Promise.all(waits);
        }
        shown.push(notes);
      }
      const kept = await new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('budget-alerts-shown', 1);
        open.onsuccess = () => {
          const all = open.result.transaction('shown').objectStore('shown').getAll();
          all.onsuccess = () => {
            resolve(all.result);
            open.result.close();
          };
          all.onerror = () => reject(all.error);
        };
        open.onerror = () => reject(open.error);
      });
      return { shown, kept };
    },
    { code, runs },
  );
}

for (const [name, engine] of ENGINES) {
  describe(`10.12 A42 the worker as built keeps the ids it showed, in ${name}`, () => {
    const { browser, base } = useEngine(engine);
    const code = (): string => readFileSync(join(WEB_ROOT, 'sw.js'), 'utf8');
    // A blank page at the app's own address, handed out here rather than by the
    // app: the stand-in runs the worker's code from a string, which the app's
    // own Content Security Policy rightly forbids on every page it serves.
    const standIn = async (context: import('playwright').BrowserContext): Promise<import('playwright').Page> => {
      const page = await context.newPage();
      const url = `${base()}/a42-stand-in`;
      await page.route(url, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stand-in</title>' }));
      await page.goto(url);
      return page;
    };

    it('10.12 A42 after the phone stopped and started the worker again, a repeat of one he swiped away is still dropped; only the id is kept', async () => {
      const context = await browser().newContext(phone());
      const page = await standIn(context);
      const r = await inThePage(page, code(), [['low-bucket needs pay period 3'], ['low-bucket needs pay period 3', 'daily-review 2026-10-12']]);
      expect(r.shown).toEqual([['low-bucket needs pay period 3'], ['daily-review 2026-10-12']]);
      expect(r.kept).toEqual([{ id: 'low-bucket needs pay period 3' }, { id: 'daily-review 2026-10-12' }]);
      await context.close();
    });

    it('10.12 A42 the newest 500 are kept: the 501st pushes out the oldest, which would show again after a restart', async () => {
      const context = await browser().newContext(phone());
      const page = await standIn(context);
      const ids = Array.from({ length: 501 }, (_, i) => `daily-review ${String(i).padStart(4, '0')}`);
      // Asked about the second oldest and the newest first: re-showing the oldest then pushes the next one out.
      const r = await inThePage(page, code(), [ids, [ids[1]!, ids[500]!, ids[0]!]]);
      expect(r.shown[0]).toHaveLength(501);
      // After a restart: the oldest went out of the 500 kept, so it shows; the next one and the newest are still kept.
      expect(r.shown[1]).toEqual([ids[0]]);
      expect(r.kept).toHaveLength(500);
      expect(r.kept.every((k) => typeof k === 'object' && k !== null && Object.keys(k).join() === 'id')).toBe(true);
      await context.close();
    });
  });
}
