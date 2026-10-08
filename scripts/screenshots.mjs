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
  ['took-back', 'took-back', '/home'],
  ['took-back-sheet', 'took-back', '/home', (page) => page.locator('[data-testid^="attention-bank-took-back-"]').click()],
  ['bank-not-read', 'bank-not-read', '/home'],
  ['late', 'late', '/home'],
  ['not-set-up', 'not-set-up', '/home'],
  ['error', 'error', '/home'],
  ['loading', 'slow', '/home', 'loading'],
  // Buckets
  ['buckets', 'normal', '/buckets'],
  ['buckets-whole', 'normal', '/buckets', 'full'],
  ['buckets-busy', 'buckets-busy', '/buckets', 'full'],
  ['buckets-mismatch', 'mismatch', '/buckets'],
  ['buckets-low', 'low', '/buckets'],
  ['buckets-overspent', 'overspent', '/buckets'],
  ['buckets-not-read', 'bank-not-read', '/buckets'],
  ['buckets-empty', 'not-set-up', '/buckets'],
  ['buckets-error', 'error', '/buckets', 'error'],
  ['buckets-loading', 'slow', '/buckets', 'loading-buckets'],
  // Review
  ['review', 'normal', '/review'],
  ['review-busy', 'review-busy', '/review'],
  ['review-busy-whole', 'review-busy', '/review', 'full'],
  ['review-refund', 'review-busy', '/review', async (page) => {
    await page.getByTestId('item-busy-refund').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -80));
    return 'no-sheet';
  }],
  ['review-refund-confirm', 'review-busy', '/review', async (page) => {
    await page.getByTestId('item-busy-refund').locator('[data-testid^="match-"]').first().click();
  }],
  ['review-transfer-old-card', 'review-busy', '/review', async (page) => {
    await page.locator('article', { hasText: 'ZELLE TO MADE UP FRIEND' }).getByTestId('more').click();
    await page.getByTestId('sheet-transfer').scrollIntoViewIfNeeded();
  }],
  ['review-transfer-from-savings', 'review-busy', '/review', async (page) => {
    await page.getByTestId('item-busy-water').getByTestId('more').click();
    await page.getByTestId('sheet-transfer').scrollIntoViewIfNeeded();
  }],
  ['review-pending-and-flag', 'review-busy', '/review', 'bottom'],
  ['review-empty', 'all-clear', '/review'],
  ['review-not-set-up', 'not-set-up', '/review'],
  ['review-error', 'error', '/review', 'error'],
  ['review-loading', 'slow', '/review', 'loading-review'],
  ['review-one-tap', 'normal', '/review', async (page) => {
    await page.locator('article', { hasText: 'CORNER STORE' }).getByTestId('pick-wants').click();
    await page.getByTestId('notice').waitFor();
    return 'no-sheet';
  }],
  ['review-sheet', 'normal', '/review', async (page) => {
    await page.locator('article', { hasText: 'CORNER STORE' }).getByTestId('more').click();
  }],
  ['review-sheet-split', 'normal', '/review', async (page) => {
    await page.locator('article', { hasText: 'CORNER STORE' }).getByTestId('more').click();
    await page.getByTestId('split-needs').fill('4.00');
    await page.getByTestId('review-sheet').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  }],
  ['review-sheet-always', 'normal', '/review', async (page) => {
    await page.locator('article', { hasText: 'CORNER STORE' }).getByTestId('more').click();
    await page.getByTestId('always-toggle').click();
    await page.getByTestId('always-text').fill('CORNER STORE');
  }],
  ['review-rule-confirm', 'normal', '/review', async (page) => {
    await page.locator('article', { hasText: 'CORNER STORE' }).getByTestId('more').click();
    await page.getByTestId('always-toggle').click();
    await page.getByTestId('always-text').fill('CORNER STORE');
    await page.getByTestId('choice-wants').click();
  }],
  ['review-refused', 'normal', '/review', async (page) => {
    await page.locator('article', { hasText: 'CORNER STORE' }).getByTestId('more').click();
    await page.getByTestId('split-needs').fill('11.50');
    await page.getByTestId('split-submit').click();
    await page.getByTestId('notice').waitFor();
  }],
  ['review-paycheck-confirm', 'review-busy', '/review', async (page) => {
    await page.getByTestId('item-busy-early').getByTestId('pick-paycheck').click();
  }],
  ['review-leftover-confirm', 'review-busy', '/review', async (page) => {
    await page.getByTestId('answer-move-to-savings').first().click();
  }],
  ['review-deposit-sheet', 'review-busy', '/review', async (page) => {
    await page.getByTestId('item-busy-tax').getByTestId('more').click();
  }],
  ['review-person-split', 'review-busy', '/review', async (page) => {
    await page.locator('article', { hasText: 'ZELLE TO MADE UP FRIEND' }).getByTestId('more').click();
    await page.getByTestId('split-needs').fill('10.00');
    await page.getByTestId('split-wants').fill('5.00');
    await page.getByTestId('review-sheet').evaluate((e) => e.scrollTo(0, e.scrollHeight));
  }],
  // Buckets: each bucket is a link, with Move money and Payday
  ['buckets-links', 'activity-busy', '/buckets', 'full'],
  ['home-payday-row', 'payday-paid', '/home', 'full'],
  // What went in and out of a bucket
  ['activity-needs', 'activity-busy', '/buckets/needs'],
  ['activity-needs-whole', 'activity-busy', '/buckets/needs', 'full'],
  ['activity-wants-pending', 'activity-busy', '/buckets/wants', 'full'],
  ['activity-mom-reserve', 'activity-busy', '/buckets/mom-reserve', 'full'],
  ['activity-empty', 'normal', '/buckets/held-for-others'],
  ['activity-big', 'big', '/buckets/needs'],
  ['activity-not-set-up', 'not-set-up', '/buckets/needs'],
  ['activity-error', 'error', '/buckets/needs', 'error'],
  ['activity-loading', 'slow', '/buckets/needs', 'loading-activity'],
  ['activity-row-sheet', 'activity-busy', '/buckets/needs', async (page) => {
    await page.locator('.row', { hasText: 'GROCERY OUTLET #12' }).filter({ hasText: 'Thu, Oct 1' }).click();
  }],
  ['activity-row-split-part', 'activity-busy', '/buckets/needs', async (page) => {
    await page.locator('.row', { hasText: 'HARDWARE SUPERSTORE' }).click();
  }],
  ['activity-needs-marked', 'activity-marked', '/buckets/needs', 'full'],
  ['activity-row-marked', 'activity-marked', '/buckets/needs', async (page) => {
    await page.locator('.row', { hasText: 'MADE UP LANDLORD' }).click();
  }],
  ['activity-row-cannot', 'activity-busy', '/buckets/needs', async (page) => {
    await page.locator('.row', { hasText: 'MADE UP EMPLOYER PAYROLL' }).click();
  }],
  ['activity-always-confirm', 'activity-busy', '/buckets/needs', async (page) => {
    await page.locator('.row', { hasText: 'GROCERY OUTLET #12' }).filter({ hasText: 'Thu, Oct 1' }).click();
    await page.getByTestId('always-toggle').click();
    await page.getByTestId('always-text').fill('GROCERY OUTLET');
    await page.getByTestId('choice-wants').click();
  }],
  ['activity-resorted', 'activity-busy', '/buckets/needs', async (page) => {
    await page.locator('.row', { hasText: 'GROCERY OUTLET #12' }).filter({ hasText: 'Thu, Oct 1' }).click();
    await page.getByTestId('activity-sheet').getByTestId('choice-wants').click();
    await page.getByTestId('notice').waitFor();
    return 'no-sheet';
  }],
  // Moving money by hand
  ['move-form', 'normal', '/buckets', async (page) => {
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('25.00');
  }],
  ['move-reading', 'normal', '/buckets', async (page) => {
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('abc');
  }],
  ['move-confirm-savings', 'normal', '/buckets', async (page) => {
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-from').selectOption('savings');
    await page.getByTestId('move-amount').fill('100.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('move-confirm-title').waitFor();
  }],
  ['move-confirm-below-zero', 'normal', '/buckets', async (page) => {
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('700.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('move-confirm-title').waitFor();
  }],
  ['move-refused', 'normal', '/buckets', async (page) => {
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-to').selectOption('wants');
    await page.getByTestId('move-amount').fill('10.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('move-problem').waitFor();
  }],
  ['move-done', 'normal', '/buckets', async (page) => {
    await page.getByTestId('move-open').click();
    await page.getByTestId('move-amount').fill('25.00');
    await page.getByTestId('move-submit').click();
    await page.getByTestId('notice').waitFor();
    return 'no-sheet';
  }],
  // Payday
  ['payday', 'payday-paid', '/payday'],
  ['payday-whole', 'payday-paid', '/payday', 'full'],
  ['payday-leftover-why', 'payday-paid', '/payday', async (page) => {
    await page.getByTestId('leftover-why').scrollIntoViewIfNeeded();
    return 'no-sheet';
  }],
  ['payday-leftover-confirm', 'payday-paid', '/payday', async (page) => {
    await page.getByTestId('answer-move-to-savings').first().click();
  }],
  ['payday-answered', 'payday-paid', '/payday', async (page) => {
    await page.getByTestId('answer-roll-over').first().click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    await page.getByTestId('answer-move-to-savings').first().click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('leftover-wants').waitFor();
    return 'no-sheet';
  }],
  ['payday-bank-not-read', 'bank-not-read', '/payday', 'full'],
  ['payday-late', 'late', '/payday'],
  ['payday-not-set-up', 'not-set-up', '/payday'],
  ['payday-error', 'error', '/payday', 'error'],
  ['payday-loading', 'slow', '/payday', 'loading-payday'],
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
      // The made-up lives' times are Central; so is the phone in the pictures.
      timezoneId: 'America/Chicago',
      // Only to draw the iPhone's notch and home bar areas (safe areas).
      bypassCSP: true,
    });
    for (const [name, life, address, step] of SHOTS) {
      const page = await context.newPage();
      await page.goto(`${base}/demo/${life}`);
      if (address !== '/home') await page.goto(`${base}${address}`);
      await page.addStyleTag({ content: ':root { --safe-top: 59px !important; --safe-bottom: 34px !important; }' });
      if (step === 'loading') await page.getByTestId('home-loading').waitFor();
      else if (step === 'loading-buckets') await page.getByTestId('buckets-loading').waitFor();
      else if (step === 'loading-review') await page.getByTestId('review-loading').waitFor();
      else if (step === 'loading-activity') await page.getByTestId('activity-loading').waitFor();
      else if (step === 'loading-payday') await page.getByTestId('payday-loading').waitFor();
      else if (step === 'error') await page.locator('[data-testid$="-error"]').waitFor();
      else await page.locator('main[aria-busy="false"]').waitFor();
      if (typeof step === 'function') {
        const result = await step(page);
        if (result !== 'no-sheet') await page.locator('dialog[open]').waitFor();
        await page.waitForTimeout(400);
      }
      if (step === 'full') await page.addStyleTag({ content: '.tabbar { position: static !important; } .screen { padding-bottom: var(--space-5) !important; }' });
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
