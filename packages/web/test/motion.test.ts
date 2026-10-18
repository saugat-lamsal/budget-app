import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EASE, ENTRANCE_S, QUICK_S, daysBetween, ringFraction } from '../src/ui/motion.js';

// Redesign PR 2, motion: the numbers the pay-period ring is drawn from, and the
// rules the motion keeps (docs/redesign-plan.txt): 200 to 300 ms, expo-out, no
// bounce, entrances up to 600 ms, nothing when motion is reduced.

const tokens = readFileSync(new URL('../src/ui/tokens.css', import.meta.url), 'utf8');
const blocks = readFileSync(new URL('../src/ui/blocks.css', import.meta.url), 'utf8');
const base = readFileSync(new URL('../src/ui/base.css', import.meta.url), 'utf8');

describe('redesign PR 2: the pay-period ring', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween('2026-10-01', '2026-10-01')).toBe(0);
    expect(daysBetween('2026-10-01', '2026-10-15')).toBe(14);
    expect(daysBetween('2026-10-15', '2026-10-01')).toBe(-14);
    // Across the end of a month, a leap day, and the clock changes (dates, not hours).
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-11-01', '2026-11-02')).toBe(1);
  });

  it('is empty on the first day, half way half way, and full on payday', () => {
    expect(ringFraction('2026-10-01', '2026-10-01', '2026-10-15')).toBe(0);
    expect(ringFraction('2026-10-01', '2026-10-08', '2026-10-15')).toBe(0.5);
    expect(ringFraction('2026-10-01', '2026-10-15', '2026-10-15')).toBe(1);
  });

  it('exactly one day in, and one day short of payday', () => {
    expect(ringFraction('2026-10-01', '2026-10-02', '2026-10-15')).toBeCloseTo(1 / 14, 10);
    expect(ringFraction('2026-10-01', '2026-10-14', '2026-10-15')).toBeCloseTo(13 / 14, 10);
  });

  it('a late paycheck is a full ring, never more', () => {
    expect(ringFraction('2026-10-01', '2026-10-20', '2026-10-15')).toBe(1);
  });

  it('a day before the start is empty, never negative', () => {
    expect(ringFraction('2026-10-05', '2026-10-01', '2026-10-15')).toBe(0);
  });

  it('a pay period of no length, or backwards, is empty and never divides by zero', () => {
    expect(ringFraction('2026-10-15', '2026-10-15', '2026-10-15')).toBe(0);
    expect(ringFraction('2026-10-20', '2026-10-21', '2026-10-15')).toBe(0);
  });
});

describe('redesign PR 2: the motion rules', () => {
  it('the easing in code is the easing in the tokens (expo-out, no overshoot)', () => {
    expect(tokens).toContain(`--ease: cubic-bezier(${EASE.join(', ')});`);
    expect(EASE[1]).toBeLessThanOrEqual(1);
    expect(EASE[3]).toBeLessThanOrEqual(1);
  });

  it('a quick move is 200 to 300 ms and an entrance is at most 600 ms', () => {
    expect(QUICK_S).toBeGreaterThanOrEqual(0.2);
    expect(QUICK_S).toBeLessThanOrEqual(0.3);
    expect(ENTRANCE_S).toBeLessThanOrEqual(0.6);
    expect(tokens).toMatch(/--duration: 200ms;/);
  });

  it('no CSS animation or transition is longer than 600 ms, except the ones that never stop (the shimmer; the light behind the page is in base.css and never stops)', () => {
    const lengths = [...blocks.matchAll(/(?:animation|transition)(?:-duration)?:\s*([^;]+);/g)].flatMap((m) => [...(m[1] as string).matchAll(/(?<![\w.-])([\d.]+)(ms|s)\b/g)].map((d) => Number(d[1]) * (d[2] === 's' ? 1000 : 1)));
    const slow = [...blocks.matchAll(/(animation|transition)(?:-duration)?:\s*([^;]+);/g)].filter((m) => !/infinite/.test(m[2] as string) && [...(m[2] as string).matchAll(/(?<![\w.-])([\d.]+)(ms|s)\b/g)].some((d) => Number(d[1]) * (d[2] === 's' ? 1000 : 1) > 600));
    expect(lengths.length).toBeGreaterThan(2);
    expect(slow.map((m) => m[0])).toEqual([]);
  });

  it('nothing bounces: no spring, and no easing that goes past 1', () => {
    expect(blocks + base).not.toMatch(/bounce|spring|elastic/i);
    for (const m of (blocks + base + tokens).matchAll(/cubic-bezier\(([^)]*)\)/g)) {
      const [, y1, , y2] = (m[1] as string).split(',').map(Number);
      expect(y1).toBeLessThanOrEqual(1);
      expect(y1).toBeGreaterThanOrEqual(0);
      expect(y2).toBeLessThanOrEqual(1);
    }
  });

  it('reduced motion turns every CSS animation and transition off', () => {
    expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important;[\s\S]*transition: none !important;/);
  });

  it('the screens rise with a short fade and at most 6 px, and keep nothing afterwards (no fill forwards)', () => {
    const rise = /@keyframes rise \{\s*from \{([^}]*)\}/.exec(blocks)?.[1] ?? '';
    expect(rise).toMatch(/translateY\(6px\)/);
    expect(blocks).toMatch(/\.screen > \* \{\s*animation: rise 360ms var\(--ease\) backwards;/);
  });

  it('the rolling digits are written here, not by a library that needs a style element the content policy forbids', () => {
    const own = readdirSync(new URL('../src/', import.meta.url), { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f));
    for (const f of own) expect(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), f).not.toMatch(/number-flow/);
    const packageJson = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    expect(packageJson).not.toMatch(/number-flow/);
  });
});
