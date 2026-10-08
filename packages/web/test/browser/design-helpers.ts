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

export async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: AxeViolation[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
    return result.violations;
  });
  return violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} ${n.failureSummary ?? ''}`));
}

// Everything a finger can tap.
export async function tappable(page: Page): Promise<{ readonly what: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }[]> {
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

