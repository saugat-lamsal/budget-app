// npm run screenshots [-- --out <folder>]
//
// iPhone-size pictures of the screens on the demo's made-up lives, in light
// and dark mode, for pull requests. Taken in WebKit (iPhone Safari's
// engine) at the iPhone 15's size, with its notch and home bar areas, and
// saved to screenshots/ (kept out of git) unless --out says otherwise.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';

const root = new URL('../', import.meta.url);
const path = (p) => fileURLToPath(new URL(p, root));
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt === -1 ? path('screenshots') : args[outAt + 1];
const port = 5199;

const built = spawnSync(process.execPath, [path('scripts/demo.mjs'), '--build-only'], { stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);
const demo = spawn(process.execPath, [path('packages/server/dist/demo/demo.mjs'), '--port', String(port)], { stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;
for (let tries = 0; ; tries += 1) {
  try {
    if ((await fetch(`${base}/demo`)).ok) break;
  } catch {
    if (tries > 50) throw new Error('the demo did not start');
    await new Promise((done) => setTimeout(done, 100));
  }
}

// name, made-up life, address, and what to do before the picture.
const SHOTS = [
  ['home', 'normal', '/home'],
  ['home-whole', 'normal', '/home', 'full'],
  ['savings-sheet', 'normal', '/home', (page) => page.getByTestId('attention-move-to-savings').click()],
  ['mismatch', 'mismatch', '/home'],
  ['mismatch-sheet', 'mismatch', '/home', (page) => page.getByTestId('see-check').click()],
  ['low', 'low', '/home', 'bottom'],
  ['overspent', 'overspent', '/home'],
  ['all-clear', 'all-clear', '/home'],
  ['trouble', 'trouble', '/home'],
  ['late', 'late', '/home'],
  ['not-set-up', 'not-set-up', '/home'],
  ['error', 'error', '/home'],
  ['loading', 'slow', '/home', 'loading'],
  ['review-tab', 'normal', '/review'],
];

mkdirSync(out, { recursive: true });
const browser = await webkit.launch();
try {
  for (const scheme of ['light', 'dark']) {
    const context = await browser.newContext({
      viewport: { width: 393, height: 852 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      colorScheme: scheme,
      // Only to draw the iPhone's notch and home bar areas (safe areas).
      bypassCSP: true,
    });
    for (const [name, life, address, step] of SHOTS) {
      const page = await context.newPage();
      await page.goto(`${base}/demo/${life}`);
      if (address !== '/home') await page.goto(`${base}${address}`);
      await page.addStyleTag({ content: ':root { --safe-top: 59px !important; --safe-bottom: 34px !important; }' });
      if (step === 'loading') await page.getByTestId('home-loading').waitFor();
      else await page.locator('[data-testid="home"][aria-busy="false"], [data-testid="review"]').waitFor();
      if (typeof step === 'function') {
        await step(page);
        await page.locator('dialog[open]').waitFor();
        await page.waitForTimeout(400);
      }
      if (step === 'bottom') await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.screenshot({ path: `${out}/${name}-${scheme}.png`, fullPage: step === 'full', animations: 'disabled' });
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
  demo.kill();
}
console.log(`Saved ${SHOTS.length * 2} pictures to ${out}`);
