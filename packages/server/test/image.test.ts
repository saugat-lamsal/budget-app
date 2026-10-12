import { execFile } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { newTokenKey } from '../src/crypto/token-box.js';
import { FakeR2 } from './fake-r2.js';
import { until } from './litestream-harness.js';

// Phase 6: the image Fly.io builds from the Dockerfile, started here the way
// Fly starts it: a volume at /data, the settings from fly.toml, the secrets
// as environment variables, and the stand-in for R2 on this computer (the
// lock made tight with BACKUP_LOCK, so only this computer can be reached).
// The server may not reach anything beyond this computer (no-network.mjs).
// It runs only in CI's image job, which builds the image first
// (IMAGE=<tag>; Docker on Linux). Every address, name and key is made up.

const IMAGE = process.env['IMAGE'];
const docker = promisify(execFile);
const HOSTED = 'https://made-up-budget.fly.dev';
const tag = `budget-image-test-${Date.now().toString(36)}`;

const cleanUp: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const done of cleanUp.splice(0).reverse()) await done().catch(() => undefined);
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

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ readonly status: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, headers: { Host: 'made-up-budget.fly.dev', ...headers }, setHost: false }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += String(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function run(name: string, volume: string, port: number, r2: FakeR2, key: string): Promise<void> {
  const env = {
    APP_ORIGIN: HOSTED,
    PORT: String(port),
    BUDGET_DB: '/data/budget.sqlite',
    PLAID_ENV: 'sandbox',
    PLAID_CLIENT_ID: 'made-up-client-id',
    PLAID_SECRET: 'made-up-plaid-secret',
    BANK_TOKEN_KEY: key,
    BACKUP_LOCK: 'this-computer',
    NODE_OPTIONS: '--import=file:///test/no-network.mjs',
    ...r2.env(),
  };
  const preload = fileURLToPath(new URL('./no-network.mjs', import.meta.url));
  await docker('docker', ['run', '--detach', '--name', name, '--network', 'host', '--volume', `${volume}:/data`, '--volume', `${preload}:/test/no-network.mjs:ro`, ...Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`]), IMAGE ?? '']);
  cleanUp.push(() => docker('docker', ['rm', '--force', name]));
}

async function logs(name: string): Promise<string> {
  const { stdout, stderr } = await docker('docker', ['logs', name]);
  return `${stdout}${stderr}`;
}

async function healthy(name: string, port: number): Promise<void> {
  let up = false;
  await until(
    'the image to say ok',
    () => {
      void get(port, '/health').then(
        (r) => (up = r.body === 'ok\n'),
        () => undefined,
      );
      return up;
    },
    90_000,
  );
  expect(await logs(name)).toContain('Budget app: ');
}

describe.runIf(IMAGE !== undefined)('Phase 6 the image, started as Fly starts it (CI\'s image job)', { timeout: 300_000 }, () => {
  it('Phase 6 it starts, says ok, is https only at its address, copies the books, makes a code on the machine, rebuilds from the backup, and stops cleanly; a lost volume is rebuilt', async () => {
    const r2 = await FakeR2.start();
    cleanUp.push(() => r2.close());
    const key = newTokenKey();
    const volume = `${tag}-data`;
    await docker('docker', ['volume', 'create', volume]);
    cleanUp.push(() => docker('docker', ['volume', 'rm', '--force', volume]));
    const port = await freePort();
    await run(`${tag}-1`, volume, port, r2, key);
    await healthy(`${tag}-1`, port);
    expect(await logs(`${tag}-1`)).toContain('the volume had no books and there is no backup yet: starting with empty books');
    expect((await docker('docker', ['exec', `${tag}-1`, 'litestream', 'version'])).stdout.trim()).toBe('0.5.17');
    // https only, at its own address.
    expect((await get(port, '/home')).status).toBe(308);
    expect((await get(port, '/home', { 'X-Forwarded-Proto': 'https' })).status).toBe(303);
    expect((await get(port, '/home', { 'X-Forwarded-Proto': 'https', Host: 'localhost' })).status).toBe(421);
    // A one-time code, made on the machine as he would (fly ssh console): shown there, never in the log.
    const code = await docker('docker', ['exec', `${tag}-1`, 'node', '/app/serve/login-code.mjs']);
    expect(code.stdout).toContain(`Open ${HOSTED}/login`);
    const printed = /One-time code: (\S+)/.exec(code.stdout)?.[1] ?? '';
    expect(printed).not.toBe('');
    await until('the books to be copied', () => r2.keys().length > 0, 30_000);
    const before = r2.requests.length;
    await until('the code to be copied', () => r2.requests.slice(before).some((r) => r.operation === 'PutObject'), 30_000);
    // The restore check, on the machine.
    const check = await docker('docker', ['exec', `${tag}-1`, 'node', '/app/serve/restore-check.mjs']);
    expect(check.stdout).toContain('The backup works.');
    // A stop, as Fly stops it: SIGTERM, a minute at most.
    await docker('docker', ['stop', '--time', '60', `${tag}-1`]);
    expect((await docker('docker', ['inspect', '--format', '{{.State.ExitCode}}', `${tag}-1`])).stdout.trim()).toBe('0');
    const all = await logs(`${tag}-1`);
    expect(all).toContain('stopping: the server first, then Litestream after its last copy');
    for (const secret of [key, r2.secretAccessKey, r2.accessKeyId, 'made-up-plaid-secret', printed]) expect(all.includes(secret)).toBe(false);
    await docker('docker', ['rm', `${tag}-1`]);

    // The volume is lost: a new one, and the books rebuilt from the backup, the code with them.
    await docker('docker', ['volume', 'rm', volume]);
    await docker('docker', ['volume', 'create', volume]);
    await run(`${tag}-2`, volume, port, r2, key);
    await healthy(`${tag}-2`, port);
    expect(await logs(`${tag}-2`)).toContain('the volume had no books: rebuilt them from the backup');
    const codes = await docker('docker', ['exec', `${tag}-2`, 'node', '-e', "const D=require('/app/node_modules/better-sqlite3');const d=new D('/data/budget.sqlite',{readonly:true});console.log(d.prepare('SELECT COUNT(*) AS n FROM login_codes').get().n)"]);
    expect(codes.stdout.trim()).toBe('1');
    await docker('docker', ['stop', '--time', '60', `${tag}-2`]);
    expect((await docker('docker', ['inspect', '--format', '{{.State.ExitCode}}', `${tag}-2`])).stdout.trim()).toBe('0');
  });
});
