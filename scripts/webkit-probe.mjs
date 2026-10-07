// TEMPORARY (Phase 4, CI on Linux): finds out why WebKit sometimes leaves
// Home loading for good. Loads Home again and again in new contexts, the way
// the browser tests do, with gaps from none to just past Node's 5-second
// keep-alive timeout, against three servers that differ only in how they
// keep connections open. Prints how long each load took and, for any that
// never finish, what the browser and the server were doing.
//   node scripts/webkit-probe.mjs [loads per server]
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'packages/web/dist');
const loads = Number(process.argv[2] ?? 60);

// Home's numbers, from the real demo, once.
const demo = spawn(process.execPath, [join(root, 'packages/server/dist/demo/demo.mjs'), '--port', '5190'], { stdio: 'ignore' });
let homeJson = '';
for (let i = 0; i < 100 && homeJson === ''; i += 1) {
  await new Promise((r) => setTimeout(r, 100));
  homeJson = await fetch('http://127.0.0.1:5190/api/home').then((r) => r.text(), () => '');
}
demo.kill();

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json' };

function probeServer(kind) {
  const log = [];
  const server = createServer((req, res) => {
    const entry = { url: req.url, at: Date.now(), done: null };
    log.push(entry);
    res.on('finish', () => (entry.done = Date.now()));
    if (kind === 'close') res.setHeader('Connection', 'close');
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/api/home') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(homeJson);
      return;
    }
    const file = path === '/' || path === '/home' ? join(dist, 'index.html') : join(dist, path);
    try {
      statSync(file);
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      res.end(readFileSync(file));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  if (kind === 'no-timeout') server.keepAliveTimeout = 0;
  return { server, log };
}

const GAPS = [0, 200, 1000, 4900, 5000, 5100];
const browser = await webkit.launch();
const summary = [];
for (const kind of ['node-default-5s', 'no-timeout', 'close']) {
  const { server, log } = probeServer(kind);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const times = [];
  let stuck = 0;
  for (let i = 0; i < loads; i += 1) {
    const gap = GAPS[i % GAPS.length];
    await new Promise((r) => setTimeout(r, gap));
    const context = await browser.newContext();
    const page = await context.newPage();
    const pending = new Map();
    page.on('request', (r) => pending.set(r, Date.now()));
    page.on('requestfinished', (r) => pending.delete(r));
    page.on('requestfailed', (r) => pending.delete(r));
    const t = Date.now();
    try {
      await page.goto(`${base}/home`, { timeout: 15000 });
      await page.locator('[data-testid="home"][aria-busy="false"]').waitFor({ timeout: 15000 });
      times.push(Date.now() - t);
    } catch (error) {
      stuck += 1;
      const now = Date.now();
      console.log(`[${kind}] load ${i}, after a ${gap}ms gap: STUCK for ${now - t}ms (${String(error).split('\n')[0]})`);
      console.log(`  browser waiting on: ${[...pending].map(([r, at]) => `${r.url()} for ${now - at}ms`).join('; ') || 'nothing'}`);
      console.log(`  server, last: ${log.slice(-6).map((e) => `${e.url} -${now - e.at}ms ${e.done === null ? 'NOT ANSWERED' : 'answered'}`).join('; ')}`);
    }
    await context.close();
  }
  server.closeAllConnections();
  server.close();
  times.sort((a, b) => a - b);
  const line = `${kind}: ${loads} loads, ${stuck} stuck; fastest ${times[0]}ms, middle ${times[Math.floor(times.length / 2)]}ms, slowest ${times.at(-1)}ms`;
  summary.push(line);
  console.log(line);
}
await browser.close();
console.log('\nSUMMARY\n' + summary.join('\n'));
