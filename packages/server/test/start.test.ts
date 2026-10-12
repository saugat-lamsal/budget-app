import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../../../scripts/server-build.mjs';
import { newTokenKey } from '../src/crypto/token-box.js';
import { openDatabase } from '../src/db/database.js';
import { FakeR2 } from './fake-r2.js';
import { lifeInAFile, setUpThroughTheDesk } from './keeper-harness.js';
import { CAN_RESTORE, CONFIG, litestreamBin, until } from './litestream-harness.js';

// Phase 6: what the image runs on Fly.io (start.mjs), built and run here as
// it runs there: its own program, with the server and Litestream as programs
// of their own, the project's litestream.yml, and the stand-in for R2. The
// server may not reach anything beyond this computer (no-network.mjs), so its
// first start's attempt to connect Plaid's test bank is refused, as a test
// of that too. Linux and macOS only: Litestream cannot rebuild a database on
// Windows, and Windows has no signals to stop a program gently with.
// Every address, name and key is made up.

const HOSTED = 'https://made-up-budget.fly.dev';

let built = '';
let work = '';
beforeAll(async () => {
  if (!CAN_RESTORE) return;
  work = mkdtempSync(join(tmpdir(), 'budget-start-'));
  built = join(work, 'serve');
  await buildServer(built);
}, 180_000);
afterAll(() => {
  if (work !== '') rmSync(work, { recursive: true, force: true });
});

const cleanUp: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const done of cleanUp.splice(0).reverse()) await done();
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      s.close(() => resolve(port));
    });
  });
}

interface Machine {
  readonly dir: string;
  readonly db: string;
  readonly r2: FakeR2;
  env(): Record<string, string>;
}

// A machine's volume and its secrets, as Fly would give them.
async function machine(): Promise<Machine> {
  const r2 = await FakeR2.start();
  cleanUp.push(() => r2.close());
  const dir = mkdtempSync(join(work, 'machine-'));
  const web = join(dir, 'web');
  mkdirSync(web);
  writeFileSync(join(web, 'index.html'), '<!doctype html><title>app</title>');
  const db = join(dir, 'data', 'budget.sqlite');
  const key = newTokenKey();
  return {
    dir,
    db,
    r2,
    env: () => ({
      PATH: process.env['PATH'] ?? '',
      HOME: process.env['HOME'] ?? dir,
      APP_ORIGIN: HOSTED,
      BUDGET_DB: db,
      PLAID_ENV: 'sandbox',
      PLAID_CLIENT_ID: 'made-up-client-id',
      PLAID_SECRET: 'made-up-plaid-secret',
      BANK_TOKEN_KEY: key,
      WEB_ROOT: web,
      LITESTREAM_BIN: litestreamBin(),
      LITESTREAM_CONFIG: CONFIG,
      BACKUP_LOCK: 'this-computer',
      NODE_OPTIONS: `--import=${pathToFileURL(join(import.meta.dirname, 'no-network.mjs')).href}`,
      ...r2.env(),
    }),
  };
}

interface Started {
  readonly child: ChildProcess;
  readonly port: number;
  output(): string;
  readonly ended: Promise<number | null>;
}

async function start(env: Record<string, string>): Promise<Started> {
  const port = await freePort();
  let output = '';
  const child = spawn(process.execPath, [join(built, 'start.mjs')], { env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  const ended = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  cleanUp.push(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await ended;
  });
  return { child, port, output: () => output, ended };
}

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ readonly status: number; readonly body: string; readonly location: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers: { Host: 'made-up-budget.fly.dev', ...headers }, setHost: false }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += String(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, location: res.headers.location }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function healthy(s: Started): Promise<void> {
  await until('the server to say ok', () => s.output().includes('Budget app: '), 60_000);
  expect((await get(s.port, '/health', { Host: 'fdaa:0:1::2' })).body).toBe('ok\n');
}

async function stopGently(s: Started): Promise<number | null> {
  s.child.kill('SIGTERM');
  return s.ended;
}

function rows(db: string, table: string): number {
  const books = openDatabase(db);
  try {
    return (books.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  } finally {
    books.close();
  }
}

describe.runIf(CAN_RESTORE)('Phase 6 the image\'s program: the server and Litestream on the one machine (Linux and macOS)', { timeout: 120_000 }, () => {
  it('Phase 6 the first start: no backup yet, empty books, https only at its own address; the books are copied; a stop stops the server, then Litestream', async () => {
    const m = await machine();
    const s = await start(m.env());
    await healthy(s);
    expect(s.output()).toContain('the volume had no books and there is no backup yet: starting with empty books');
    // Its first start tried to connect the test bank, which the test refused; it serves all the same.
    await until('the test bank to be tried', () => s.output().includes('the test bank could not be connected'));
    expect((await get(s.port, '/home', { 'X-Forwarded-Proto': 'https' })).location).toBe('/login');
    expect((await get(s.port, '/home')).location).toBe(`${HOSTED}/home`);
    expect((await get(s.port, '/home', { 'X-Forwarded-Proto': 'https', Host: 'localhost' })).status).toBe(421);
    // No passkey yet: it says how to get a code, and never writes one in its log.
    expect(s.output()).toContain('fly ssh console -C "node /app/serve/login-code.mjs"');
    expect(s.output()).not.toMatch(/\d{4}-\d{4}-\d{4}/);
    await until('the books to be copied', () => m.r2.keys().length > 0);
    expect(await stopGently(s)).toBe(0);
    expect(s.output()).toContain('stopping: the server first, then Litestream after its last copy');
    await expect(get(s.port, '/health')).rejects.toThrow();
  });

  it('Phase 6 a lost volume: the next start rebuilds the books from the backup, with everything saved before', async () => {
    const m = await machine();
    const first = await start(m.env());
    await healthy(first);
    // Something to keep: a one-time code, made on the machine as he would.
    const code = spawn(process.execPath, [join(built, 'login-code.mjs')], { env: m.env(), stdio: ['ignore', 'pipe', 'pipe'] });
    let printed = '';
    code.stdout?.on('data', (chunk: Buffer) => (printed += chunk.toString('utf8')));
    expect(await new Promise((resolve) => code.once('exit', resolve))).toBe(0);
    expect(printed).toContain(`Open ${HOSTED}/login`);
    expect(rows(m.db, 'login_codes')).toBe(1);
    const before = m.r2.requests.length;
    await until('the code to be copied', () => m.r2.requests.slice(before).some((r) => r.operation === 'PutObject'));
    expect(await stopGently(first)).toBe(0);
    // The volume is lost.
    rmSync(join(m.dir, 'data'), { recursive: true, force: true });
    expect(existsSync(m.db)).toBe(false);
    const second = await start(m.env());
    await healthy(second);
    expect(second.output()).toContain('the volume had no books: rebuilt them from the backup');
    expect(rows(m.db, 'login_codes')).toBe(1);
    expect(await stopGently(second)).toBe(0);
  });

  it('Phase 6 nothing starts without its settings: no backup, an address the lock refuses, or no https address; it says why, and nothing is made on the volume', async () => {
    const m = await machine();
    const cases: [Record<string, string>, string][] = [
      [{ ...m.env(), R2_ENDPOINT: '', R2_BUCKET: '', R2_ACCESS_KEY_ID: '', R2_SECRET_ACCESS_KEY: '' }, 'no backup is set: the hosted server does not run without one'],
      [{ ...m.env(), R2_ENDPOINT: 'http://10.0.0.2:9000' }, 'Under the tests the books are copied to this computer only.'],
      [{ ...m.env(), APP_ORIGIN: '' }, 'APP_ORIGIN is not set'],
    ];
    for (const [env, why] of cases) {
      const s = await start(env);
      expect(await s.ended, why).toBe(2);
      expect(s.output()).toContain(why);
    }
    expect(readdirSync(m.dir)).toEqual(['web']);
    expect(m.r2.requests).toEqual([]);
  });

  it('Phase 6 0.6 books whose history does not replay: the server stays stopped and says what to do, Litestream goes on copying, and a stop still stops it', async () => {
    const m = await machine();
    const life = await lifeInAFile();
    setUpThroughTheDesk(life);
    const seq = (life.h.db.prepare("SELECT MAX(seq) AS seq FROM book_events WHERE totals IS NOT NULL AND totals != 'null'").get() as { seq: number }).seq;
    const totals = JSON.parse((life.h.db.prepare('SELECT totals FROM book_events WHERE seq = ?').get(seq) as { totals: string }).totals) as { needs: number };
    life.h.db.prepare('UPDATE book_events SET totals = ? WHERE seq = ?').run(JSON.stringify({ ...totals, needs: totals.needs + 1 }), seq);
    life.h.db.pragma('wal_checkpoint(TRUNCATE)');
    mkdirSync(join(m.dir, 'data'));
    await life.h.db.backup(m.db);
    life.done();
    const s = await start(m.env());
    await until('the server to stop', () => s.output().includes('the server stopped by itself'), 60_000);
    expect(s.output()).toContain('fly ssh console, then node /app/serve/replay-check.mjs; then fly machine restart');
    await until('the books to be copied', () => m.r2.keys().length > 0);
    expect(s.child.exitCode).toBeNull();
    await expect(get(s.port, '/health')).rejects.toThrow();
    expect(await stopGently(s)).toBe(0);
  });
});
