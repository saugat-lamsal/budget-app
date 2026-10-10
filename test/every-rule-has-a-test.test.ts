import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CLAUDE.md: every numbered rule in the rulebook gets at least one test,
// named after the rule number ("4.6 pending charge counts once"). This
// fails if one has none: a rule added to the rulebook without its test, or a
// test renamed so that no test is named after its rule any more. It reads the
// names as they are written in the test files (the end-of-phase table,
// scripts/rule-table.mjs, counts them from a full run).

const root = fileURLToPath(new URL('..', import.meta.url));

function rules(): string[] {
  return readFileSync(join(root, 'budget-app-rulebook.md'), 'utf8')
    .split(/\r?\n/)
    .flatMap((line) => /^(\d{1,2}\.\d{1,2}) +[A-Z"]/.exec(line)?.[1] ?? []);
}

function testFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'dist') return [];
    if (statSync(path).isDirectory()) return testFiles(path);
    return name.endsWith('.test.ts') ? [path] : [];
  });
}

// The names a test file gives its tests and groups: the first argument of
// it, test, describe (and their .each, .runIf and .skipIf), and of the
// pay period's own parts and their names (pay-period.test.ts).
function names(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/\b(?:it|test|describe|part)(?:\.(?:each|runIf|skipIf)\([^)]*\))?\(\s*(['"`])(.*?)\1/g)) found.push(m[2] ?? '');
  for (const m of text.matchAll(/^\s*'\d{4}-\d{2}-\d{2}': '(.*)',$/gm)) found.push(m[1] ?? '');
  return found;
}

const numbersIn = (name: string): string[] => [...name.matchAll(/(?<![\d.$,:/-])(\d{1,2}\.\d{1,2})(?![\d,]|\.\d)/g)].map((m) => m[1] ?? '');

describe('every rule has a test', () => {
  it('the rulebook has numbered rules to look for, and the tests have names', () => {
    expect(rules().length).toBeGreaterThan(70);
    expect(testFiles(join(root, 'packages')).length).toBeGreaterThan(100);
  });

  it('every numbered rule in the rulebook has at least one test named after it', () => {
    const named = new Set<string>();
    for (const file of [...testFiles(join(root, 'packages')), ...testFiles(join(root, 'test'))]) for (const name of names(readFileSync(file, 'utf8'))) for (const n of numbersIn(name)) named.add(n);
    expect(rules().filter((r) => !named.has(r))).toEqual([]);
  });
});
