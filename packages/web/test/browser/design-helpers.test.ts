import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoScenario } from '../../../server/src/demo/scenarios.js';
import { addStyle, axeViolations } from './design-helpers.js';
import { ENGINES, openScenario, phone, useEngine } from './harness.js';

// The contrast check itself. Faint text where axe used to give up must be
// found: at the bottom of a sheet, over the tab bar, and in a notice pinned at
// the top while the page scrolls under it (the real screens, with faint text
// added on purpose); clear text there must pass. Until Oct 10 axe gave up on
// that text ("could not be checked") and the check only counted what it was
// sure of, so faint text there passed unseen. Small made-up pages check the
// rest: a see-through pinned notice, and text axe cannot check at all.

const FAINT = '#c7c7cc';
const CLEAR = '#1c1c1e';

function app(body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Made up</title><style>
    body { margin: 0; font: 15px system-ui; background: #f2f2f7; color: ${CLEAR}; }
    main { padding: 16px 16px 120px; }
    .tabbar { position: fixed; inset: auto 0 0; z-index: 10; height: 84px; background: #ffffff; border-top: 1px solid #d1d1d6; }
    .tabbar a { color: ${CLEAR}; display: inline-block; padding: 12px; }
    dialog { position: fixed; inset: auto 0 0; width: 100%; max-width: 40rem; max-height: calc(100dvh - 24px); margin: 0 auto; border: 0; padding: 0; background: #f2f2f7; overflow: auto; }
    .sheet__inner { padding: 16px 16px 24px; }
    .notice--sticky { position: sticky; top: 8px; z-index: 5; }
    p.line { height: 44px; margin: 0 0 12px; padding: 8px 16px; background: #ffffff; border-radius: 12px; }
  </style></head><body>${body}</body></html>`;
}

const lines = (n: number): string => Array.from({ length: n }, (_, i) => `<p class="line">Line ${i + 1}</p>`).join('');
const tabbar = '<nav class="tabbar"><a href="#">Home</a><a href="#">Buckets</a></nav>';

function pinnedPage(color: string, background: string): string {
  return app(`<main><h1>Payday</h1><div class="notice notice--sticky" data-testid="notice" style="background: ${background}"><span id="notice-text" class="notice__text" style="color: ${color}">Saved.</span></div>${lines(30)}</main>${tabbar}`);
}

async function open(page: Page, html: string, then?: (page: Page) => Promise<void>): Promise<string[]> {
  await page.setContent(html);
  await then?.(page);
  return axeViolations(page);
}

const scrollDown = async (page: Page): Promise<void> => {
  await page.evaluate(() => window.scrollTo(0, 900));
};

describe.each(ENGINES)('the contrast check in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  // The real screens, with faint text added on purpose where axe used to give up.
  async function reviewSheetWithRule(): Promise<Page> {
    const page = await openScenario(await browser().newContext(phone({ bypassCSP: true })), base(), 'review-busy', '/review');
    const store = demoScenario('review-busy')!.input!().book!.reviewItems().find((i) => 'description' in i && i.description === 'CORNER STORE')!.id;
    await page.getByTestId(`item-${store}`).getByTestId('more').click();
    await page.getByTestId('always-toggle').click();
    await page.locator('.sheet__note').waitFor();
    return page;
  }
  async function paydayDoneMessage(): Promise<Page> {
    const page = await openScenario(await browser().newContext(phone({ bypassCSP: true })), base(), 'payday-paid', '/payday');
    await page.locator('[data-testid^="item-leftover"]').first().getByTestId('answer-roll-over').click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('notice').waitFor();
    return page;
  }

  it('design: faint text at the bottom of an open sheet, over the tab bar, is found (Review, "always do this" on)', async () => {
    const page = await reviewSheetWithRule();
    await addStyle(page, `.sheet__note { color: ${FAINT} !important; }`);
    const problems = await axeViolations(page);
    expect(problems.some((p) => p.startsWith('color-contrast: ') && p.includes('sheet__note'))).toBe(true);
    await page.context().close();
  });

  it('design: clear text at the bottom of an open sheet passes, and the page is as it was afterwards', async () => {
    const page = await reviewSheetWithRule();
    expect(await axeViolations(page)).toEqual([]);
    expect(await page.locator('.tabbar').evaluate((e) => getComputedStyle(e).visibility)).toBe('visible');
    await page.context().close();
  });

  it('design: faint text in a pinned notice, with the page scrolled under it, is found (the Payday done message)', async () => {
    const page = await paydayDoneMessage();
    await addStyle(page, `.notice__text { color: ${FAINT} !important; }`);
    const problems = await axeViolations(page);
    expect(problems.some((p) => p.startsWith('color-contrast: ') && p.includes('notice__text'))).toBe(true);
    await page.context().close();
  });

  it('design: clear text in a pinned notice passes, with the page scrolled under it, and it is pinned again afterwards', async () => {
    const page = await paydayDoneMessage();
    expect(await axeViolations(page)).toEqual([]);
    expect(await page.getByTestId('notice').evaluate((e) => getComputedStyle(e).position)).toBe('sticky');
    await page.context().close();
  });

  it('design: a pinned notice with a see-through background is a problem: what scrolls under it shows through', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    const problems = await open(page, pinnedPage(CLEAR, 'rgba(230, 244, 234, 0.6)'), scrollDown);
    expect(problems.some((p) => p.includes('see-through background'))).toBe(true);
    await context.close();
  });

  it('design: text whose contrast axe cannot check counts as a problem', async () => {
    const context = await browser().newContext(phone());
    const page = await context.newPage();
    const problems = await open(page, app(`<main><h1>Home</h1><p id="over-gradient" style="background-image: linear-gradient(#ffffff, #000000)">Safe to spend</p></main>`));
    expect(problems.some((p) => p.startsWith('color-contrast (could not be checked): ') && p.includes('#over-gradient'))).toBe(true);
    await context.close();
  });
});
