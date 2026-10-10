import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loginForTests } from '../../../../server/test/login-for-tests.js';
import { period } from './period.js';
import { RealServer, atNewYork } from './real-server.js';

// npm run pay-period-agent (scripts/pay-period-agent.mjs): the real server
// with the planned pay period's made-up bank, for the agent of Step 2 that
// uses the app like a person (agent-pay-period/). The same as the browser
// test's (real-server.ts): npm run serve's code, its books in a database
// file of their own, an empty database with the bank connected, and the
// bank's activity reaching the books only by the server's own sync timer,
// on a clock that moves only when a day is brought in.
//
// Beside it, on its own port, a small control page: "Log this browser in"
// (the tests' way in, login-for-tests.ts: a passkey needs Face ID or a
// security key, which the agent's browser does not have), and "Bring in the
// next day", which moves the clock to 7:00 AM that day, puts that day's
// activity at the bank, and lets the timer sync. Every name and number is
// made up.

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name);
  const value = i < 0 ? fallback : Number(process.argv[i + 1]);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error(`${name} needs a port number`);
  return value;
};
const APP_PORT = arg('--port', 5390);
const CONTROL_PORT = arg('--control', 5391);
const webRoot = process.env['WEB_ROOT'] ?? fileURLToPath(new URL('../../../web/dist/', import.meta.url));
if (!existsSync(`${webRoot}index.html`)) throw new Error(`the screens are not built at ${webRoot}`);

const listenOn = (server: Server, port: number): Promise<string> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(`http://127.0.0.1:${port}`));
  });
const closeServer = (server: Server): Promise<void> => new Promise((resolve) => server.close(() => resolve()));

const P = period();
const real = await RealServer.start(P, atNewYork(P.days[0]?.date ?? '2026-10-01', 9), { webRoot, listen: (server) => listenOn(server, APP_PORT), close: closeServer });
let day = 0;
const brought: string[] = [];

const dayName = (date: string): string => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

async function nextDay(): Promise<string> {
  const next = P.days[day + 1];
  if (next === undefined) return 'That was the last day of the pay period. Nothing more comes in.';
  day += 1;
  await real.moveTo(atNewYork(next.date, 7));
  real.give(next.feed);
  await real.untilSynced();
  const line = `${dayName(next.date)}, 7:00 AM: the bank's activity for the day has come in (${next.feed.length} item${next.feed.length === 1 ? '' : 's'} at the bank).`;
  brought.push(line);
  return line;
}

function page(message: string): string {
  const today = P.days[day]?.date ?? '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pay period control</title>
<style>body{font:16px system-ui,sans-serif;margin:24px;max-width:640px}button{font:inherit;padding:10px 16px;margin:6px 0}li{margin:4px 0}</style></head><body>
<h1>Pay period control</h1>
<p>The app: <a href="${real.base}/home">${real.base}/home</a></p>
<p>Today in the app: <strong>${dayName(today)}</strong>${day === 0 ? ' (setup day)' : ''}.</p>
${message === '' ? '' : `<p role="status"><strong>${message}</strong></p>`}
<form method="post" action="/login"><button>Log this browser in</button></form>
<form method="post" action="/next-day"><button>Bring in the next day</button></form>
<h2>Days brought in</h2><ol>${brought.map((b) => `<li>${b}</li>`).join('')}</ol>
</body></html>`;
}

async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const path = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (request.method === 'GET' && path === '/') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(''));
    return;
  }
  if (request.method === 'GET' && path === '/status') {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ app: real.base, today: P.days[day]?.date, lastDay: P.days.at(-1)?.date, brought }));
    return;
  }
  if (request.method === 'POST' && path === '/login') {
    // Cookies are by host name, not port: this one reaches the app too.
    const cookie = loginForTests(real.db, real.clock.now, 'The agent\'s browser');
    response.writeHead(303, { 'Set-Cookie': `${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`, Location: `${real.base}/home` }).end();
    return;
  }
  if (request.method === 'POST' && path === '/next-day') {
    const message = await nextDay();
    if ((request.headers.accept ?? '').includes('text/html')) response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(message));
    else response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`${message}\n`);
    return;
  }
  response.writeHead(404).end();
}

const control = createServer((request, response) => {
  answer(request, response).catch((error: unknown) => {
    response.writeHead(500, { 'Content-Type': 'text/plain' }).end(error instanceof Error ? error.message : String(error));
  });
});
await listenOn(control, CONTROL_PORT);
console.log('The pay period, on the real server with the made-up bank (no real bank, no real money).');
console.log(`  The app:     ${real.base}/home`);
console.log(`  The control: http://localhost:${CONTROL_PORT}/`);
console.log(`  The books:   a database file of their own, removed when this stops.`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void closeServer(control)
      .then(() => real.done())
      .finally(() => process.exit(0));
  });
}
