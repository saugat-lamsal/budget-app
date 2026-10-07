import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDemoServer, demoAddress } from '../src/demo/demo-server.js';
import { DEMO_SCENARIOS, demoScenario } from '../src/demo/scenarios.js';
import { homeView, type HomeView } from '../src/views/home.js';

// The demo: the screens on made-up lives only. It must never reach the bank
// or the database, so it is safe to open over wifi.

function viewOf(name: string): Extract<HomeView, { state: 'tracking' }> {
  const input = demoScenario(name)?.input?.();
  if (input === undefined) throw new Error(`no made-up life ${name}`);
  const view = homeView(input);
  if (view.state !== 'tracking') throw new Error(`${name} is not tracking`);
  return view;
}

describe('the made-up lives', () => {
  it('every one builds through the money math and says its numbers are made up', () => {
    for (const s of DEMO_SCENARIOS) {
      if (s.input === null) continue;
      const input = s.input();
      expect(input.madeUpData, s.name).toBe(true);
      expect(homeView(input).madeUpData, s.name).toBe(true);
      // Every one but "mismatch" agrees with its made-up bank (12.3).
      if (input.book !== null && input.bank !== null) expect(input.book.selfCheck(input.bank).ok, s.name).toBe(s.name !== 'mismatch');
    }
  });

  it('each one shows what its name says', () => {
    const normal = viewOf('normal');
    expect(normal.attention.map((a) => a.kind)).toEqual(['review', 'move-to-savings', 'card-due']);
    expect(viewOf('all-clear').attention).toEqual([]);
    expect(viewOf('low').buckets.wants.level).toBe('low');
    expect(viewOf('overspent').buckets.wants.level).toBe('empty');
    expect(viewOf('overspent').buckets.wants.left).toBeLessThan(0);
    expect(viewOf('mismatch').safeToSpend).toMatchObject({ shown: false, why: 'totals-do-not-match', check: { difference: -1_234 } });
    expect(viewOf('payday').payday.days).toBe(0);
    expect(viewOf('late').payday.days).toBe(-2);
    expect(viewOf('trouble').attention.slice(0, 2).map((a) => a.kind)).toEqual(['bank-login', 'card-overdue']);
    const big = viewOf('big').safeToSpend;
    expect(big.shown && big.amount > 1_000_000_000).toBe(true);
    expect(homeView(demoScenario('not-set-up')!.input!())).toEqual({ state: 'not-set-up', madeUpData: true });
    expect(demoScenario('error')!.input).toBeNull();
  });
});

describe('the demo server', () => {
  let server: Server;
  let base = '';
  beforeAll(async () => {
    server = createDemoServer({ webRoot: fileURLToPath(new URL('../../web/dist/', import.meta.url)), onError: () => undefined });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  });

  it('/demo lists every made-up life', async () => {
    const page = await (await fetch(`${base}/demo`)).text();
    for (const s of DEMO_SCENARIOS) expect(page).toContain(`/demo/${s.name}`);
    expect(page).toContain('Every number here is invented');
  });

  it('picking a life remembers it and opens Home', async () => {
    const res = await fetch(`${base}/demo/low`, { redirect: 'manual' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/home');
    expect(res.headers.get('set-cookie')).toBe('demo=low; Path=/; HttpOnly; SameSite=Strict');
    const view = (await (await fetch(`${base}/api/home`, { headers: { cookie: 'demo=low' } })).json()) as HomeView;
    expect(view.state === 'tracking' && view.buckets.wants.level).toBe('low');
  });

  it('with no life picked it shows the normal one, and an unknown name is not found', async () => {
    expect(await (await fetch(`${base}/api/home`)).json()).toEqual(JSON.parse(JSON.stringify(viewOf('normal'))));
    expect((await fetch(`${base}/demo/nothing-like-this`, { redirect: 'manual' })).status).toBe(404);
    expect(await (await fetch(`${base}/api/home`, { headers: { cookie: 'demo=nothing-like-this' } })).json()).toEqual(JSON.parse(JSON.stringify(viewOf('normal'))));
  });

  it('the life that cannot load answers with an error', async () => {
    expect((await fetch(`${base}/api/home`, { headers: { cookie: 'demo=error' } })).status).toBe(500);
  });
});

describe('the demo is made-up data only', () => {
  it('it listens on this computer only, unless asked for wifi', () => {
    expect(demoAddress([])).toEqual({ host: '127.0.0.1', port: 5180, wifi: false });
    expect(demoAddress(['--port', '6001'])).toEqual({ host: '127.0.0.1', port: 6001, wifi: false });
    expect(demoAddress(['--wifi'])).toEqual({ host: '0.0.0.0', port: 5180, wifi: true });
    expect(() => demoAddress(['--port', 'abc'])).toThrow();
    expect(() => demoAddress(['--port', '70000'])).toThrow();
  });

  // Every file the demo can load, by following its imports from main.ts.
  function demoImports(): { readonly files: string[]; readonly packages: Set<string> } {
    const serverSrc = fileURLToPath(new URL('../src/', import.meta.url));
    const files: string[] = [];
    const packages = new Set<string>();
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      files.push(relative(serverSrc, file).replaceAll('\\', '/'));
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+'([^']+)'|(?:^|\n)\s*import\s+'([^']+)'|import\(\s*'([^']+)'\s*\)/g)) {
        const spec = match[1] ?? match[2] ?? match[3] ?? '';
        if (spec.startsWith('.')) visit(resolve(dirname(file), spec.replace(/\.js$/, '.ts')));
        else packages.add(spec);
      }
    };
    visit(join(serverSrc, 'demo', 'main.ts'));
    return { files, packages };
  }

  it('it never loads the database, the bank connection, the bank key, or the settings file', () => {
    const { files, packages } = demoImports();
    expect(files.sort()).toEqual(['demo/demo-server.ts', 'demo/main.ts', 'demo/scenarios.ts', 'http/server.ts', 'views/home.ts']);
    expect([...packages].sort()).toEqual(['@budget-app/money', 'node:fs/promises', 'node:http', 'node:os', 'node:path', 'node:url']);
  });

  it('it reads no keys or secrets from the environment', () => {
    for (const file of demoImports().files) {
      const text = readFileSync(fileURLToPath(new URL(`../src/${file}`, import.meta.url)), 'utf8');
      const reads = [...text.matchAll(/process\.env\[?['.]?([A-Z_]+)/g)].map((m) => m[1]);
      expect(reads.filter((name) => name !== 'DEMO_WEB_ROOT'), file).toEqual([]);
    }
  });
});
