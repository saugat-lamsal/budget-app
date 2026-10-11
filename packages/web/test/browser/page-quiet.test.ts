import { createServer } from 'node:http';
import type { BrowserContext, Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { ENGINES, close, launch, listen, openScenario, phone, untilAnswered, untilQuiet, useEngine } from './harness.js';
import { openLive, startLive } from './live.js';

// The helpers the browser tests open pages with hand back a page that is
// quiet: everything it asked for has been answered. Home's numbers are asked
// for on every screen, so a test that looks at Buckets can be given the page
// while Home's request is still on its way, and a test that then closes the
// page cancels it. WebKit as Playwright builds it (Linux CI, Oct 8) then
// stalls the next page the test opens. Home's answer is slowed down here, so
// the helper has to wait for it.
//
// What has been answered is read from the browser's own record, inside the
// page (Resource Timing: an entry is made once the whole answer has arrived),
// and never from the events Playwright sends: those can arrive after the page
// has moved on. This test counted with them until Oct 9, and failed on CI now
// and then for that reason alone (Linux WebKit, Windows Chromium: Home asked
// for and answered, but Playwright's "finished" not yet arrived).

// Slows every answer to /api/home down, and counts what was asked. A request
// is counted here before it can go anywhere, so its answer can never come
// before it is counted.
async function slowHome(context: BrowserContext): Promise<{ asked: () => number }> {
  let asked = 0;
  await context.route('**/api/home', async (route) => {
    asked += 1;
    await new Promise((done) => setTimeout(done, 700));
    await route.continue();
  });
  return { asked: () => asked };
}

// How many answers from `path` the page's present document has had in full.
async function answeredInPage(page: Page, path: string): Promise<number> {
  return page.evaluate((p) => performance.getEntriesByType('resource').filter((e) => new URL(e.name).pathname === p).length, path);
}

describe.each(ENGINES)('a page the tests open is quiet when they get it, in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('openScenario hands back a page whose Home request has been answered, even for another screen', async () => {
    const context = await browser().newContext(phone());
    const home = await slowHome(context);
    const page = await openScenario(context, base(), 'normal', '/buckets');
    // Home itself asked first, then Buckets asked again; Buckets' answer is in.
    expect(home.asked()).toBe(2);
    expect(await answeredInPage(page, '/api/home')).toBe(1);
    await page.context().close();
  });

  // Playwright says a request finished only for answers it counts as loaded; an error answer (500) is an answer all the same.
  it('a page whose numbers cannot be loaded is handed back too: an error answer is an answer', async () => {
    const page = await openScenario(await browser().newContext(phone()), base(), 'error', '/buckets/needs');
    expect(await page.getByTestId('activity-error').count()).toBe(1);
    await page.context().close();
  }, 8_000);

  it('openLive hands back a page whose Home request has been answered, even for another screen', async () => {
    const input = demoScenario('normal')?.input?.();
    if (input === undefined || input.book === null) throw new Error('no made-up life called normal');
    const live = await startLive({ book: input.book, bank: input.bank, today: input.today });
    try {
      const context = await browser().newContext(phone());
      const home = await slowHome(context);
      const page = await openLive(context, live.base, '/buckets');
      expect(home.asked()).toBe(1);
      expect(await answeredInPage(page, '/api/home')).toBe(1);
      await page.context().close();
    } finally {
      await close(live.server);
    }
  });

  it('untilQuiet also waits for a request started a moment after the last one was answered', async () => {
    const context = await browser().newContext(phone());
    const page = await openScenario(context, base(), 'normal');
    await slowHome(context);
    // As the screens ask again after a choice (src/app/api.ts): one request at
    // a time, the next once the last is answered.
    await page.evaluate(() => {
      void fetch('/api/home')
        .then((r) => r.json())
        .then(() => new Promise((done) => setTimeout(done, 50)))
        .then(() => fetch('/api/home'));
    });
    await untilQuiet(page);
    // Home's own, and the two asked for here.
    expect(await answeredInPage(page, '/api/home')).toBe(3);
    await context.close();
  });
});

// The count itself, on a page made for it: an answer whose body comes later
// than its headers. A fetch resolves as soon as the headers arrive; closing
// the page then would still cancel the rest of the answer.
describe.each(ENGINES)('the count of requests on their way, in %s', (_name, engine) => {
  it('an answer counts once its body has arrived, not when its headers do', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/slow-body') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '2' });
        response.flushHeaders();
        setTimeout(() => response.end('{}'), 700);
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>slow body</title>');
    });
    const base = await listen(server);
    const browser = await launch(engine);
    try {
      const page = await (await browser.newContext()).newPage();
      await page.goto(`${base}/`);
      // Started and not awaited, as the screens do.
      await page.evaluate(() => {
        void fetch('/slow-body');
      });
      await untilAnswered(page);
      expect(await answeredInPage(page, '/slow-body')).toBe(1);
    } finally {
      await browser.close();
      await close(server);
    }
  });

  it('a page opened without the count is said at once, not after a timeout', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>not counted</title>');
    });
    const base = await listen(server);
    // Launched straight from Playwright: its contexts count nothing.
    const browser = await engine.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      await page.goto(`${base}/`);
      const started = Date.now();
      await expect(untilAnswered(page)).rejects.toThrow('nothing in the page counts its requests');
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await browser.close();
      await close(server);
    }
  });
});

// A page that cannot open says, at once, what it and its server were doing:
// the test closes it afterwards, so the report made when a test fails finds no
// page open (CI, Oct 10, random-lives-activity, twice). Here the server takes
// the request for the page's script and never answers it.
describe.each(ENGINES)('a page that cannot open says why, in %s', (_name, engine) => {
  it('its report names the request never answered, what the server was asked, and the connections to its port', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/never.js') return;
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>stuck</title><script src="/never.js"></script>');
    });
    const base = await listen(server);
    const browser = await launch(engine);
    try {
      const page = await (await browser.newContext()).newPage();
      const error = await page.goto(`${base}/stuck`, { timeout: 2_000 }).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(error?.name).toBe('TimeoutError');
      expect(error?.message).toContain('Timeout 2000ms exceeded');
      expect(error?.message).toContain(`page ${base}/stuck`);
      expect(error?.message).toMatch(/still waits on: .*GET http:\/\/127\.0\.0\.1:\d+\/never\.js/);
      expect(error?.message).toMatch(/server, last requests: GET \/stuck from :\d+ at -\d+ms: 200 after \d+ms; GET \/never\.js from :\d+ at -\d+ms: NOT ANSWERED/);
      expect(error?.message).toMatch(/machine, connections to or from its port: \{.*"(ESTAB|ESTABLISHED)":/);
    } finally {
      await browser.close();
      await close(server);
    }
  });

  // What CI showed (Oct 11, WebKit on Linux): a new page whose very first
  // address never arrived stays blank, and the report then still names the
  // server it was opening, and what that server was asked.
  it('a new page whose first address never arrives: the report names the server it was opening, and what the browser started', async () => {
    const server = createServer((request, response) => {
      if (request.url === '/never') return;
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>fine</title>');
    });
    const base = await listen(server);
    const browser = await launch(engine);
    try {
      const page = await (await browser.newContext()).newPage();
      const error = await page.goto(`${base}/never`, { timeout: 2_000 }).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(error?.name).toBe('TimeoutError');
      expect(error?.message).toContain('page about:blank');
      expect(error?.message).toMatch(/browser requests started, the last 15: GET http:\/\/127\.0\.0\.1:\d+\/never at -\d+ms/);
      expect(error?.message).toMatch(/server, last requests: GET \/never from :\d+ at -\d+ms: NOT ANSWERED/);
      expect(error?.message).toMatch(/machine, connections to or from its port: \{.*"(ESTAB|ESTABLISHED)":/);
    } finally {
      await browser.close();
      await close(server);
    }
  });
});

// Leaving a page cancels what it still has on its way, and the browsers then
// sometimes lose the next request (CLAUDE.md, CI Oct 7 and Oct 8). So no page
// of a browser the tests launch is ever left while a request of its own is on
// its way, however the test leaves it. The server here answers 700 ms late and
// says whether each answer went out in full or was cut off.
describe.each(ENGINES)('leaving a page waits for its requests, in %s', (_name, engine) => {
  const ways = {
    'closing it': (page: Page) => page.close(),
    'closing its context': (page: Page) => page.context().close(),
    'going to another address': (page: Page, base: string) => page.goto(`${base}/other`),
    'reloading it': (page: Page) => page.reload(),
    'going back': (page: Page) => page.goBack(),
  } as const;

  it.each(Object.keys(ways))('%s', async (way) => {
    const outcomes: string[] = [];
    const server = createServer((request, response) => {
      if (request.url === '/late') {
        const timer = setTimeout(() => {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end('{}');
        }, 700);
        response.on('finish', () => outcomes.push('answered'));
        response.on('close', () => {
          clearTimeout(timer);
          if (!response.writableFinished) outcomes.push('cut off');
        });
        return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<!doctype html><title>late</title>');
    });
    const base = await listen(server);
    const browser = await launch(engine);
    try {
      const page = await (await browser.newContext()).newPage();
      await page.goto(`${base}/first`);
      await page.goto(`${base}/`);
      await page.evaluate(() => {
        void fetch('/late');
      });
      await ways[way as keyof typeof ways](page, base);
      expect(outcomes).toEqual(['answered']);
    } finally {
      await browser.close();
      await close(server);
    }
  });
});
