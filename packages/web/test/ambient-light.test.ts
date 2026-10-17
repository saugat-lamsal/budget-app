import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The light behind the page (base.css, the Backdrop block) is decoration the
// accessibility check cannot read a color through, so it is hidden while that
// check runs (design-helpers.ts). This checks it on its own, in the worst
// case: each blob at its full strength, which its blur only ever lowers (the
// blobs sit apart, so they are not stacked), with a card's 3% white over it. Every text
// color the app uses on the page must still be readable there (WCAG AA, 4.5:1).

const tokens = readFileSync(new URL('../src/ui/tokens.css', import.meta.url), 'utf8');
const base = readFileSync(new URL('../src/ui/base.css', import.meta.url), 'utf8');

type Rgb = readonly [number, number, number];

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(tokens);
  if (m?.[1] === undefined) throw new Error(`no token --${name}`);
  return m[1].trim();
}

function hex(value: string): Rgb {
  const h = value.replace('#', '');
  return [Number.parseInt(h.slice(0, 2), 16), Number.parseInt(h.slice(2, 4), 16), Number.parseInt(h.slice(4, 6), 16)];
}

function over(top: Rgb, alpha: number, below: Rgb): Rgb {
  return [0, 1, 2].map((i) => (top[i] as number) * alpha + (below[i] as number) * (1 - alpha)) as unknown as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('the light behind the page', () => {
  const blobs = [...base.matchAll(/\.ambient__blob--[abc] \{[^}]*?background:\s*rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/g)].map((m) => ({ color: [Number(m[1]), Number(m[2]), Number(m[3])] as Rgb, alpha: Number(m[4]) }));

  it('has the three blobs', () => {
    expect(blobs).toHaveLength(3);
  });

  it('the muted, the accent, and the status text stay readable where the light is brightest', () => {
    for (const b of blobs) {
      // A card on top of it: 3% white.
      const at = over([255, 255, 255], 0.03, over(b.color, b.alpha, hex(token('bg'))));
      for (const name of ['text', 'text-2', 'accent-text', 'warning', 'ok', 'danger']) {
        expect(contrast(hex(token(name)), at), `--${name} on the brightest light`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('the tab bar is glass, but what shows through it cannot make its labels unreadable', () => {
    const bar = /--tabbar-bg: rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(tokens);
    expect(bar).not.toBeNull();
    const glass: Rgb = [Number(bar?.[1]), Number(bar?.[2]), Number(bar?.[3])];
    const alpha = Number(bar?.[4]);
    expect(alpha).toBeGreaterThanOrEqual(0.9);
    // The brightest thing that can be under it: white text.
    const at = over(glass, alpha, [255, 255, 255]);
    for (const name of ['text-2', 'accent-text']) expect(contrast(hex(token(name)), at), `--${name} on the tab bar`).toBeGreaterThanOrEqual(4.5);
  });

  it('white on the accent (the buttons) is readable', () => {
    expect(contrast(hex(token('on-accent')), hex(token('accent')))).toBeGreaterThanOrEqual(4.5);
  });
});
