import { parseDollars } from '@budget-app/money';
import { readFileSync } from 'node:fs';

// Reads the "Check:" lines of packages/web/worked-examples.txt, so the file
// checked by hand and the tests can never drift apart. Amounts are in
// dollars and cents (read as cents); plain counts are whole numbers.

const text = readFileSync(new URL('../worked-examples.txt', import.meta.url), 'utf8');

// Which demo life each example is.
export const EXAMPLE_LIVES: Readonly<Record<number, string>> = { 1: 'normal', 2: 'mismatch', 3: 'low', 4: 'overspent' };

export function checksOf(number: number): Map<string, number> {
  const block = text.split(/^EXAMPLE /m).find((b) => b.startsWith(`${number}.`));
  if (block === undefined) throw new Error(`no example ${number}`);
  const checks = new Map<string, number>();
  for (const line of block.matchAll(/^Check: (.*)$/gm)) {
    for (const part of (line[1] ?? '').split('|')) {
      const m = /^\s*([a-z][a-z ]*?)\s+(-?[\d,]+(?:\.\d{2})?)\s*$/.exec(part);
      if (m === null) throw new Error(`cannot read "${part}" in example ${number}`);
      const value = m[2] ?? '';
      checks.set(m[1] ?? '', value.includes('.') ? parseDollars(value) : Number(value));
    }
  }
  if (checks.size === 0) throw new Error(`example ${number} has no Check lines`);
  return checks;
}

export function exampleNumbers(): number[] {
  return [...text.matchAll(/^EXAMPLE (\d+)\./gm)].map((m) => Number(m[1]));
}
