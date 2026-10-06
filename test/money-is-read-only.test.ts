import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Rule 0.4 for the money math: it can only calculate. It has no way to reach
// a bank, a network, a file, or a clock, so it cannot move money.
const sourceDir = new URL('../packages/money/src/', import.meta.url);

function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(sourceDir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ name, text: readFileSync(new URL(name, sourceDir), 'utf8') }));
}

describe('0.4 the app is read-only: the money math cannot move money', () => {
  it('0.4 the money math has source files to check', () => {
    expect(sourceFiles().length).toBeGreaterThan(1);
  });

  it('0.4 the money math imports only its own files', () => {
    for (const { name, text } of sourceFiles()) {
      const imports = [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\brequire\s*\(/g)];
      for (const match of imports) {
        const target = match[1] ?? match[2] ?? 'require(';
        expect(target.startsWith('./'), `${name} imports ${target}`).toBe(true);
      }
    }
  });

  it('0.4 the money math never touches the network, files, timers, or the clock', () => {
    const forbidden = [
      /\b(fetch|XMLHttpRequest|WebSocket|EventSource|navigator|process|globalThis|setTimeout|setInterval|eval)\b/,
      /\bDate\.now\b/,
      /\bnew Date\(\s*\)/,
      /\bMath\.random\b/,
      /\bFunction\(/,
    ];
    for (const { name, text } of sourceFiles()) {
      for (const pattern of forbidden) {
        expect(text.match(pattern)?.[0], name).toBeUndefined();
      }
    }
  });
});
