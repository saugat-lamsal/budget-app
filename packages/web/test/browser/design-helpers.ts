import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from 'playwright';

// Shared by the design-rule tests: the accessibility check, what a finger can
// tap, and adding test styles.

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');

interface AxeViolation {
  readonly id: string;
  readonly nodes: readonly { readonly target: readonly string[]; readonly failureSummary?: string }[];
}

// The design checks judge the screen at rest. A button that was just tapped
// fades its opacity back over a moment and a sheet slides in, and a colour or
// a size measured halfway through that is not what he sees (a size can come
// out a rounding error short of 44 while a sheet is still sliding). So a frame
// or two pass, for a transition that was just started to begin, and then every
// animation and transition that is running finishes. And for a moment after a
// sheet closes the screen takes no tap (blocks.tsx holdTaps): its invisible
// cover is over everything, which axe would take for something overlapping
// the text; the screen is at rest once it takes taps again.
export async function atRest(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    // Not the ones that never end (the light floating behind the page, a skeleton's pulse): they have no rest to wait for.
    const ends = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(ends.map((animation) => animation.finished.catch(() => undefined)));
    while (document.querySelector('.tap-hold') !== null) await new Promise((done) => setTimeout(done, 20));
  });
}

// Every accessibility problem axe finds, and any text whose contrast it could
// not check: that counts as a problem too, or faint text would pass unseen.
//
// A sheet is shown in the browser's top layer, over the whole page. axe does
// not know the top layer: it took the page under the sheet (the tab bar) for
// something overlapping the sheet's lower text, could not tell the colour
// behind it, and so never checked it (found Oct 10, with faint text added to a
// sheet on purpose). What is under an open sheet is hidden while axe runs; he
// cannot see it there either. The same goes for a notice pinned at the top
// while the page scrolls under it: its background is solid (checked here), so
// it is checked in its place in the page, where axe can read its colours.
export async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE });
  await atRest(page);
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: AxeViolation[]; incomplete: AxeViolation[] }> } }).axe;
    const problems: string[] = [];
    const sheet = document.querySelector('dialog[open]');
    const under: HTMLElement[] = [];
    for (let at: Element | null = sheet; at !== null && at !== document.body; at = at.parentElement) {
      for (const other of at.parentElement?.children ?? []) if (other !== at && other instanceof HTMLElement && other.style.visibility !== 'hidden') under.push(other);
    }
    const pinned = [...document.querySelectorAll<HTMLElement>('.notice--sticky')];
    for (const notice of pinned) {
      const alpha = /rgba\([^)]*,\s*([\d.]+)\)$/.exec(getComputedStyle(notice).backgroundColor)?.[1];
      if (alpha !== undefined && Number(alpha) < 1) problems.push(`pinned notice: ${notice.getAttribute('data-testid') ?? ''} has a see-through background, so what scrolls under it shows through`);
    }
    // The light behind the page is decoration: a gradient, an image and a blur, which axe cannot read a color through. It is hidden while axe runs and
    // checked on its own (test/ambient-light.test.ts: even where it is brightest, the muted text still passes).
    // The rolling digits (redesign PR 2) are drawn over the amount's real text, which axe reads: they are drawn from pseudo-elements, which it also cannot read through. They take the amount's own color (test/browser/motion.test.ts checks that).
    const decoration = [...document.querySelectorAll<HTMLElement>('.ambient, .statusbar, .roll')];
    for (const e of decoration) e.style.visibility = 'hidden';
    // The tab bar is frosted glass: axe cannot say what is behind it, so it reads it flat, in the same color. How faint what shows through can be is checked in test/ambient-light.test.ts.
    const glass = document.querySelector<HTMLElement>('.tabbar');
    const glassWas = glass?.style.backgroundColor ?? '';
    if (glass !== null) glass.style.backgroundColor = getComputedStyle(glass).backgroundColor.replace(/rgba\((\d+), (\d+), (\d+), [\d.]+\)/, 'rgb($1, $2, $3)');
    for (const e of under) e.style.visibility = 'hidden';
    for (const e of pinned) e.style.position = 'static';
    try {
      const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations', 'incomplete'] });
      const unchecked = result.incomplete.filter((v) => v.id === 'color-contrast');
      return [...problems, ...[...result.violations, ...unchecked.map((v) => ({ ...v, id: 'color-contrast (could not be checked)' }))].flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} ${n.failureSummary ?? ''}`))];
    } finally {
      for (const e of decoration) e.style.visibility = '';
      if (glass !== null) glass.style.backgroundColor = glassWas;
      for (const e of under) e.style.visibility = '';
      for (const e of pinned) e.style.position = '';
    }
  });
}

// Everything a finger can tap.
export async function tappable(page: Page): Promise<{ readonly what: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }[]> {
  await atRest(page);
  return page.locator('a[href], button, [role="button"], input, select, summary').evaluateAll((elements) =>
    elements
      .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden')
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { what: `${e.tagName} ${e.getAttribute('data-testid') ?? e.textContent?.trim().slice(0, 30) ?? ''}`, x: r.x, y: r.y, width: r.width, height: r.height };
      }),
  );
}

export async function addStyle(page: Page, css: string): Promise<void> {
  await page.addStyleTag({ content: css });
}

