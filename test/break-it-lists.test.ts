import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BREAK_LISTS, loadBreaks, staleBreaks, type BreakSpec } from '../scripts/break-it-lib.mjs';

// A break whose text is not in its file exactly once is never tried: the
// break-it run says NOT APPLIED and moves on, and a mistake it was meant to
// catch can come back unnoticed. Code moves (a refactor, a new argument), so
// every break in the three lists is checked here, on every npm test: a break
// that no longer matches the code fails the tests until it is pointed at the
// code again.
//
// A break-it run (BREAK_IT_RUN) skips the check on this project: the copy it
// runs in has one break applied, so that break's text is not there, and this
// test would fail for every break and make each one look caught.
const insideBreakIt = process.env['BREAK_IT_RUN'] === '1';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

describe.skipIf(insideBreakIt)('break-it: every break still matches the code', () => {
  it('every break in the three lists finds its text exactly once in its file', () => {
    const breaks = loadBreaks(root, BREAK_LISTS);
    expect(breaks.length).toBeGreaterThan(700);
    const stale = staleBreaks(root, breaks).map((s) => `${s.file}: ${s.why} (text found ${s.found === null ? 'nowhere: no such file' : `${s.found} times`})`);
    expect(stale, 'These breaks no longer match the code. Point each at the code as it is now, keeping the mistake it makes.').toEqual([]);
  });

  it('the three lists are the ones the break-it command reads', () => {
    expect(BREAK_LISTS).toEqual(['packages/money/break-it.json', 'packages/server/break-it.json', 'packages/web/break-it.json']);
  });
});

// The check itself, on a made-up project (never this one).
describe('break-it: finding breaks that no longer match', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  function project(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'break-it-lists-'));
    made.push(dir);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    return dir;
  }

  const spec = (file: string, find: string, why: string): BreakSpec => ({ section: '1', file, find, replace: 'x', why });

  it('a break found exactly once is fine', () => {
    const dir = project({ 'src/a.ts': 'const a = 1;\nconst b = 2;\n' });
    expect(staleBreaks(dir, [spec('src/a.ts', 'const a = 1;', 'once')])).toEqual([]);
  });

  it('names a break whose text is not there, is there twice, or whose file is gone', () => {
    const dir = project({ 'src/a.ts': 'x = 1;\nx = 1;\nconst y = 2;\n' });
    const found = staleBreaks(dir, [
      spec('src/a.ts', 'const y = 3;', 'not there'),
      spec('src/a.ts', 'x = 1;', 'twice'),
      spec('src/a.ts', 'const y = 2;', 'once'),
      spec('src/gone.ts', 'anything', 'no file'),
    ]);
    expect(found.map((s) => [s.why, s.found])).toEqual([
      ['not there', 0],
      ['twice', 2],
      ['no file', null],
    ]);
  });

  it('text that spans lines must match the lines exactly, line ends included', () => {
    const dir = project({ 'src/a.ts': 'if (a) {\r\n  b();\r\n}\n' });
    expect(staleBreaks(dir, [spec('src/a.ts', 'if (a) {\n  b();', 'line ends differ')]).map((s) => s.found)).toEqual([0]);
  });

  it('an empty find text is never a break', () => {
    const dir = project({ 'src/a.ts': 'abc' });
    expect(staleBreaks(dir, [spec('src/a.ts', '', 'empty')]).map((s) => s.why)).toEqual(['empty']);
  });
});
