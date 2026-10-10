import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// CI runs npm test split in three jobs (.github/workflows/test.yml): the type
// check and every test without a browser, then the browser tests in each
// engine. Together they must be exactly npm test: no test left out. These
// checks read the workflow, the test config, and the browser harness as text.

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const workflow = read('.github/workflows/test.yml');
const config = read('vitest.config.ts');
const harness = read('packages/web/test/browser/harness.ts');
const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

interface Step {
  readonly name: string | null;
  readonly if: string | null;
  readonly run: string | null;
  readonly env: Readonly<Record<string, string>>;
}

// The job's steps, each with its name, condition, command, and environment.
function steps(): Step[] {
  const body = workflow.split(/\n    steps:\n/)[1] ?? '';
  return body
    .split(/\n      - /)
    .map((chunk) => chunk.replace(/^\s*- /, ''))
    .filter((chunk) => chunk.trim() !== '' && !chunk.trim().startsWith('#'))
    .map((chunk) => {
      const field = (name: string): string | null => new RegExp(`(?:^|\\n)\\s*${name}: (.+)`).exec(chunk)?.[1]?.trim() ?? null;
      const env: Record<string, string> = {};
      const envBlock = /\n\s*env:\n((?:\s{10,}\S.*\n?)+)/.exec(chunk)?.[1] ?? '';
      for (const line of envBlock.split('\n')) {
        const m = /^\s*([A-Z_]+): (.+)$/.exec(line);
        if (m?.[1] !== undefined && m[2] !== undefined) env[m[1]] = m[2].trim().replace(/^'(.*)'$/, '$1');
      }
      return { name: field('name'), if: field('if'), run: field('run'), env };
    });
}

// The engines the browser tests can be run in, one at a time.
const engines = [...harness.matchAll(/\['(\w+)', \w+\],/g)].map((m) => m[1] ?? '');

describe('CI: the three jobs together are exactly npm test', () => {
  it('npm test is the type check, then every vitest project', () => {
    expect(packageJson.scripts['test']).toBe('npm run typecheck && vitest run');
  });

  it('the browser tests run in Chromium and WebKit, and BROWSER_ENGINE picks one', () => {
    expect(engines).toEqual(['chromium', 'webkit']);
    expect(harness).toContain("process.env['BROWSER_ENGINE'] === undefined || process.env['BROWSER_ENGINE'] === name");
  });

  it('the parts are the checks and one job for each browser engine', () => {
    expect(/\n\s+part: \[(.+)\]/.exec(workflow)?.[1]?.split(',').map((p) => p.trim())).toEqual(['checks', ...engines]);
  });

  it('the checks job runs the type check and every test, with only the browser tests left out', () => {
    const checks = steps().filter((s) => s.if === "matrix.part == 'checks'");
    expect(checks.map((s) => s.run)).toEqual(['npm run typecheck', 'npx vitest run']);
    expect(checks[1]?.env).toEqual({ SKIP_BROWSER_TESTS: '1' });
    // SKIP_BROWSER_TESTS leaves out the web-browser project and nothing else.
    const skipped = /const browserTests = process\.env\['SKIP_BROWSER_TESTS'\] === '1'\s*\? \[\]\s*: \[([\s\S]*?)\n {4}\];/.exec(config)?.[1] ?? '';
    expect([...skipped.matchAll(/name: '([\w-]+)'/g)].map((m) => m[1])).toEqual(['web-browser']);
  });

  it('each browser job runs every browser test in its own engine', () => {
    const browser = steps().filter((s) => s.if === "matrix.part != 'checks'" && s.run?.startsWith('npx vitest') === true);
    expect(browser.map((s) => s.run)).toEqual(['npx vitest run --project web-browser']);
    expect(browser[0]?.env).toEqual({ BROWSER_ENGINE: '${{ matrix.part }}' });
  });

  it('every step runs in every job, or in the checks job, or in the browser jobs: nothing else picks', () => {
    for (const step of steps()) {
      expect([null, "matrix.part == 'checks'", "matrix.part != 'checks'"], `${step.name ?? step.run ?? 'a step'}`).toContain(step.if?.split(' && ')[0] ?? null);
    }
  });
});
