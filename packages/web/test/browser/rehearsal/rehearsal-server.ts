import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TokenBox } from '../../../../server/src/crypto/token-box.js';
import { openDatabase } from '../../../../server/src/db/database.js';
import { readAccounts, readConnection } from '../../../../server/src/db/store.js';
import { Keeper } from '../../../../server/src/history/keeper.js';
import { consoleLog } from '../../../../server/src/log.js';
import { PlaidClient } from '../../../../server/src/plaid/client.js';
import { plaidKeysFromEnv } from '../../../../server/src/plaid/sandbox-lock.js';
import { logSender } from '../../../../server/src/serve/alert-timer.js';
import { serveBooks } from '../../../../server/src/serve/serving.js';
import { loginForTests } from '../../../../server/test/login-for-tests.js';

// npm run rehearsal (scripts/rehearsal.mjs): before connection day, the Bank
// screen (rules 1.1 to 1.3) against Plaid's test bank through the real Plaid
// Link, in a real browser, on this computer. The test bank only: the lock
// refuses anything else, and test-bank connections do not count against the
// 10. The real server's code (serveBooks), its books in a throwaway database
// with a throwaway bank key, both removed when it stops. Nothing is connected
// by itself: the Bank screen does it.
//
// Beside it, a control page: "Log this browser in" (the tests' way in,
// login-for-tests.ts, so no passkey is needed), and what the books hold now.
// Plaid's test bank takes its own published test logins in Link (user_good,
// pass_good); "Platypus OAuth Bank" goes through the bank's own login in a
// window of its own, as Bank of America does.

// The test bank only, whatever .env says: the lock cannot be loosened after this.
process.env['PLAID_LOCK'] = 'sandbox';
// The repository's root (the folder with the rulebook), from where this file
// is or where it was built to.
let root = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(root, 'budget-app-rulebook.md'))) {
  if (dirname(root) === root) throw new Error('the repository was not found');
  root = dirname(root);
}
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name);
  const value = i < 0 ? fallback : Number(process.argv[i + 1]);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`${name} needs a port number`);
  return value;
};
const APP_PORT = arg('--port', 5392);
const CONTROL_PORT = arg('--control', 5393);
const webRoot = process.env['WEB_ROOT'] ?? join(root, 'packages', 'web', 'dist');
if (!existsSync(join(webRoot, 'index.html'))) throw new Error(`the screens are not built at ${webRoot}`);

const keys = plaidKeysFromEnv(process.env);
if (keys.environment !== 'sandbox') throw new Error('the rehearsal is for Plaid\'s test bank only');
const dir = mkdtempSync(join(tmpdir(), 'budget-rehearsal-'));
const db = openDatabase(join(dir, 'books.sqlite'));
const log = consoleLog([keys.clientId, keys.secret]);
const box = new TokenBox(randomBytes(32).toString('base64'));
const plaid = new PlaidClient(keys, { log });
const origin = `http://localhost:${APP_PORT}`;
const keeper = Keeper.open({ db, now: () => new Date(), log, origin: () => origin });
const { server, timer, alerts } = serveBooks({
  keeper,
  bank: { plaid, box, log },
  clock: { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
  webRoot,
  origin: () => origin,
  onError: (error) => log.error('a request failed', { error: error instanceof Error ? error.message : String(error) }),
  sender: logSender(log, 'all'),
});

const listenOn = (s: Server, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve());
  });

function status(): unknown {
  const connection = readConnection(db);
  return {
    connected: connection !== null,
    needsLogin: connection?.needsLogin ?? false,
    historyComplete: connection?.historyComplete ?? false,
    permissionEnds: connection?.permissionEnds ?? null,
    accounts: readAccounts(db).map((a) => ({ name: a.raw.name, mask: a.raw.mask, kind: `${a.raw.type} ${a.raw.subtype ?? ''}`.trim(), role: a.role })),
    itemsRead: (db.prepare('SELECT COUNT(*) AS n FROM bank_items').get() as { n: number }).n,
    setUp: keeper.book() !== null,
  };
}

function page(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Rehearsal control</title>
<style>body{font:16px system-ui,sans-serif;margin:24px;max-width:720px}button{font:inherit;padding:10px 16px;margin:6px 0}pre{background:#f4f4f4;padding:12px;overflow:auto}</style></head><body>
<h1>Rehearsal: the Bank screen against Plaid's test bank</h1>
<p>No real bank and no real money. The app: <a href="${origin}/settings">${origin}/settings</a>, then Bank connection.</p>
<form method="post" action="/login"><button>Log this browser in</button></form>
<h2>The books now</h2><pre data-testid="status">${JSON.stringify(status(), null, 2).replace(/</g, '&lt;')}</pre>
</body></html>`;
}

async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (request.method === 'GET' && path === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page());
    return;
  }
  if (request.method === 'GET' && path === '/status') {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(status()));
    return;
  }
  if (request.method === 'POST' && path === '/login') {
    // Cookies are by host name, not port: this one reaches the app too.
    const cookie = loginForTests(db, new Date(), 'The rehearsal browser');
    response.writeHead(303, { 'Set-Cookie': `${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`, Location: `${origin}/settings` }).end();
    return;
  }
  response.writeHead(404).end();
}

const control = createServer((request, response) => {
  answer(request, response).catch((error: unknown) => {
    response.writeHead(500, { 'Content-Type': 'text/plain' }).end(error instanceof Error ? error.message : String(error));
  });
});

await listenOn(server, APP_PORT);
await listenOn(control, CONTROL_PORT);
alerts.start();
timer.start();
console.log("The rehearsal: the Bank screen against Plaid's test bank (no real bank, no real money).");
console.log(`  The control: http://localhost:${CONTROL_PORT}/  (Log this browser in)`);
console.log(`  The app:     ${origin}/settings, then Bank connection`);
console.log('  The books:   a throwaway database and bank key, removed when this stops (Ctrl+C).');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    control.close();
    server.close();
    void Promise.all([timer.stop(), alerts.stop()]).finally(() => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
      process.exit(0);
    });
  });
}
