import { mkdirSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type IncomingHttpHeaders, type Server } from 'node:http';
import { join } from 'node:path';
import type { BackupWatch } from '../src/backup/backup-watch.js';
import { lifeInAFile, setUpThroughTheDesk, type Life } from './keeper-harness.js';
import { SoftPasskey } from './soft-passkey.js';

// Phase 6, for the tests: the real server's books behind the web server as
// they are hosted on Fly.io, at a made-up https address. Fly's proxy takes
// the https and passes each request on over plain http, saying so in
// X-Forwarded-Proto; these tests send the same, to 127.0.0.1.

export const HOSTED = 'https://made-up-budget.fly.dev';
export const HOSTED_HOST = 'made-up-budget.fly.dev';

export interface Running {
  readonly life: Life;
  readonly server: Server;
  readonly port: number;
  readonly origin: string;
}

export interface Answer {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface Ask {
  readonly host?: string | null;
  // X-Forwarded-Proto, as Fly's proxy sends it; null for none.
  readonly proto?: string | null;
  readonly origin?: string | null;
  readonly cookie?: string;
  readonly body?: unknown;
}

// The books after setup day, served at `origin` (the hosted address unless told another).
export async function servedAt(origin: string = HOSTED, setUp = true, backups?: BackupWatch): Promise<Running> {
  const life = await lifeInAFile();
  if (setUp) setUpThroughTheDesk(life);
  const webRoot = join(life.dir, 'dist');
  mkdirSync(join(webRoot, 'assets'), { recursive: true });
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(webRoot, 'assets', 'index-abc123.js'), 'console.log(1)');
  let own = origin;
  const server = life.keeper.server(webRoot, () => own, undefined, backups);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  if (origin === 'local') own = `http://localhost:${port}`;
  return { life, server, port, origin: own };
}

export async function stop(r: Running): Promise<void> {
  await new Promise<void>((done) => r.server.close(() => done()));
  r.life.done();
}

// One request, as Fly's proxy passes on what a browser at the app's address sent.
export function ask(r: Running, method: string, path: string, o: Ask = {}): Promise<Answer> {
  const own = new URL(r.origin);
  const body = method === 'POST' ? JSON.stringify(o.body ?? {}) : undefined;
  const headers: Record<string, string> = {};
  const host = o.host === undefined ? own.host : o.host;
  if (host !== null) headers['Host'] = host;
  const proto = o.proto === undefined ? (own.protocol === 'https:' ? 'https' : null) : o.proto;
  if (proto !== null) headers['X-Forwarded-Proto'] = proto;
  if (o.cookie !== undefined) headers['Cookie'] = o.cookie;
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(body ?? ''));
    const origin = o.origin === undefined ? r.origin : o.origin;
    if (origin !== null) headers['Origin'] = origin;
    headers['Sec-Fetch-Site'] = 'same-origin';
  }
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: r.port, method, path, headers, setHost: false }, (res) => {
      let text = '';
      res.on('data', (chunk) => (text += String(chunk)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

// The first login, as the login page does it: the one-time code, then a new
// passkey made for the app's own address. Gives back the whole Set-Cookie.
export async function firstLogin(r: Running, key: SoftPasskey = new SoftPasskey()): Promise<{ readonly setCookie: string; readonly cookie: string; readonly code: string }> {
  const code = r.life.keeper.loginCode();
  const asked = await ask(r, 'POST', '/api/auth/code/options', { body: { code } });
  if (asked.status !== 200) throw new Error(`the code was refused: ${asked.body}`);
  const { options } = JSON.parse(asked.body) as { options: Parameters<SoftPasskey['register']>[0] };
  const answer = await ask(r, 'POST', '/api/auth/code', { body: { code, response: key.register(options, r.origin), push: null } });
  const setCookie = answer.headers['set-cookie']?.[0];
  if (answer.status !== 200 || setCookie === undefined) throw new Error(`the login was refused: ${answer.body}`);
  return { setCookie, cookie: setCookie.split(';')[0] ?? '', code };
}
