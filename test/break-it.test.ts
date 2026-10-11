import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultWorkers,
  formatResults,
  parseArgs,
  removeStaleRuns,
  restoreLeftovers,
  runBreakIt,
  selectBreaks,
  vitestRunner,
  type BreakSpec,
  type TestRun,
} from '../scripts/break-it-lib.mjs';

// The tool that breaks the code on purpose (scripts/break-it.mjs) is checked
// here on a small made-up project, so these tests never touch this one:
//  - nothing in the project folder is ever written, not even while it runs
//  - each worker breaks its own copy, and a copy starts as the project is now
//  - the results are the same whatever the number of workers
//  - the check with nothing broken runs once, first
//  - every copy is gone afterward, and the project's node_modules is not hurt
//  - a run that is killed leaves the project folder as it was
//
// A break-it run (BREAK_IT_RUN) skips this file: it breaks the money, bank, and
// screens code, which these tests do not use, and it would only make every
// break slower.
const insideBreakIt = process.env['BREAK_IT_RUN'] === '1';
const scriptsFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts');

const made: string[] = [];
afterEach(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
});

function git(cwd: string, ...args: string[]): string {
  const run = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout;
}

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

// A project like this one in the ways that matter: a git repository with
// workspaces, a node_modules that git ignores, and a package linked into it by
// a directory link that points into the project (the trap: a copy that kept
// that link would run the project's code, not its own).
interface Project {
  readonly root: string;
  readonly workDir: string;
  readonly base: string;
}

function makeProject(): Project {
  const base = mkdtempSync(join(tmpdir(), 'break-it-test-'));
  made.push(base);
  const root = join(base, 'project');
  const workDir = join(base, 'copies');
  mkdirSync(root);
  git(root, 'init', '--quiet', '--initial-branch=main');
  put(root, 'package.json', JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }));
  put(root, '.gitignore', 'node_modules/\n');
  // As in this project: files are checked out with LF endings whatever the computer's setting.
  put(root, '.gitattributes', '* text=auto eol=lf\n');
  put(root, 'packages/a/package.json', '{"name":"@fixture/a"}');
  put(root, 'packages/a/src/value.txt', 'good\n');
  put(root, 'packages/a/src/second.txt', 'one\n');
  put(root, 'packages/a/src/third.txt', 'x x\n');
  put(root, 'packages/a/src/gone.txt', 'will be deleted\n');
  put(root, 'notes.txt', 'committed\n');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'fixture');
  put(root, 'node_modules/some-dep/index.js', 'module.exports = 1;\n');
  put(root, 'node_modules/.vite/cache.txt', 'a cache that no two copies may share');
  mkdirSync(join(root, 'node_modules', '@fixture'), { recursive: true });
  symlinkSync(join(root, 'packages', 'a'), join(root, 'node_modules', '@fixture', 'a'), 'junction');
  // What differs from the last commit: an edit, a new file, a deleted file.
  put(root, 'notes.txt', 'edited\n');
  put(root, 'packages/a/src/new.txt', 'new\n');
  rmSync(join(root, 'packages/a/src/gone.txt'));
  // A change that is staged but not committed, and a new file that is staged.
  put(root, 'packages/a/src/staged.txt', 'staged\n');
  git(root, 'add', 'notes.txt', 'packages/a/src/staged.txt');
  return { root, workDir, base };
}

// Every file under a folder, as name and content (a link counts as its target
// name and is not followed), so a change anywhere shows. .git is left out: git
// keeps its own records there.
function fingerprint(root: string): Record<string, string> {
  const found: Record<string, string> = {};
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder).sort()) {
      if (folder === root && name === '.git') continue;
      const path = join(folder, name);
      const info = lstatSync(path);
      const key = path.slice(root.length);
      if (info.isSymbolicLink()) found[key] = `link to ${readlinkSync(path)}`;
      else if (info.isDirectory()) walk(path);
      else found[key] = createHash('sha1').update(readFileSync(path)).digest('hex');
    }
  };
  walk(root);
  return found;
}

const VALUE = 'packages/a/src/value.txt';
const caughtBreak = (n: number): BreakSpec => ({ section: 1, file: VALUE, find: 'good', replace: 'x'.repeat(n), why: `caught by ${n}` });
const MIXED: BreakSpec[] = [
  caughtBreak(3),
  { section: 1, file: 'packages/a/src/second.txt', find: 'one', replace: 'two', why: 'no test reads this file' },
  { section: 2, file: VALUE, find: 'good', replace: 'crash', why: 'the tests cannot start' },
  { section: 2, file: VALUE, find: 'absent text', replace: 'x', why: 'text that is not there' },
  { section: 3, file: 'packages/a/src/third.txt', find: 'x', replace: 'y', why: 'text that is there twice' },
  caughtBreak(1),
  caughtBreak(5),
  { section: 'home', file: VALUE, find: 'good', replace: 'xxxx', why: 'a screens break' },
];

const pass: TestRun = { status: 0, stdout: 'Tests  4 passed (4)', stderr: '' };

// The "tests" of the made-up project: they read the value through the
// workspace link, the way this project's tests reach the money math. The value
// "good" passes; "crash" stops the tests from loading; any other value fails
// as many tests as it has characters.
function runOfValue(workspaceDir: string): TestRun {
  const value = readFileSync(join(workspaceDir, 'node_modules', '@fixture', 'a', 'src', 'value.txt'), 'utf8').trim();
  if (value === 'good') return pass;
  if (value === 'crash') return { status: 1, stdout: 'SyntaxError: nothing ran', stderr: '' };
  return { status: 1, stdout: `Tests  ${value.length} failed | 1 passed (${value.length + 1})`, stderr: '' };
}
const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

describe.skipIf(insideBreakIt)('break-it: running the breaks', () => {
  it('breaks nothing in the project folder, not even while it runs', { timeout: 120_000 }, async () => {
    const { root, workDir } = makeProject();
    const before = fingerprint(root);
    const changedWhileRunning: string[] = [];
    const outcome = await runBreakIt({
      root,
      breaks: MIXED,
      workers: 3,
      workDir,
      runTests: async ({ workspace }) => {
        await pause(40);
        if (JSON.stringify(fingerprint(root)) !== JSON.stringify(before)) changedWhileRunning.push(workspace.dir);
        return runOfValue(workspace.dir);
      },
    });
    expect(outcome.results).toHaveLength(MIXED.length);
    expect(changedWhileRunning).toEqual([]);
    expect(fingerprint(root)).toEqual(before);
  });

  it('each copy starts as the project folder is now: the last commit plus what is changed, new, or deleted', { timeout: 120_000 }, async () => {
    const { root, workDir } = makeProject();
    const seen: string[] = [];
    await runBreakIt({
      root,
      breaks: [caughtBreak(2), caughtBreak(4)],
      workers: 2,
      workDir,
      runTests: ({ workspace }) => {
        const at = (path: string): string | undefined => (existsSync(join(workspace.dir, path)) ? readFileSync(join(workspace.dir, path), 'utf8') : undefined);
        seen.push(JSON.stringify([at('notes.txt'), at('packages/a/src/new.txt'), at('packages/a/src/staged.txt'), at('packages/a/src/gone.txt'), at('packages/a/src/second.txt'), at('node_modules/some-dep/index.js')]));
        return Promise.resolve(pass);
      },
    });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const line of seen) expect(line).toBe(JSON.stringify(['edited\n', 'new\n', 'staged\n', undefined, 'one\n', 'module.exports = 1;\n']));
  });

  it('a package linked into node_modules is linked to the copy, other packages to the project', { timeout: 120_000 }, async () => {
    const { root, workDir } = makeProject();
    const seen: { own: string; shared: string; copy: string; cache: boolean }[] = [];
    await runBreakIt({
      root,
      breaks: [caughtBreak(2)],
      workers: 1,
      workDir,
      runTests: ({ workspace }) => {
        seen.push({
          own: realpathSync(join(workspace.dir, 'node_modules', '@fixture', 'a')),
          shared: realpathSync(join(workspace.dir, 'node_modules', 'some-dep')),
          copy: realpathSync(workspace.dir),
          cache: existsSync(join(workspace.dir, 'node_modules', '.vite')),
        });
        return Promise.resolve(pass);
      },
    });
    for (const { own, shared, copy, cache } of seen) {
      expect(cache).toBe(false);
      expect(own).toBe(join(copy, 'packages', 'a'));
      expect(shared).toBe(realpathSync(join(root, 'node_modules', 'some-dep')));
    }
  });

  it('a break is applied to its own copy only: each copy shows its own break, whatever the others do', { timeout: 120_000 }, async () => {
    const { root, workDir } = makeProject();
    const breaks = [2, 3, 4, 5, 6, 7, 8].map(caughtBreak);
    const trouble: string[] = [];
    const outcome = await runBreakIt({
      root,
      breaks,
      workers: 4,
      workDir,
      runTests: async ({ workspace }) => {
        const first = runOfValue(workspace.dir);
        await pause(60);
        if (JSON.stringify(runOfValue(workspace.dir)) !== JSON.stringify(first)) trouble.push('a copy changed while its tests ran');
        if (readFileSync(join(root, VALUE), 'utf8') !== 'good\n') trouble.push('the project file changed');
        return first;
      },
    });
    expect(trouble).toEqual([]);
    // Break n makes n tests fail, so each result belongs to the break it judged.
    expect(outcome.results?.map((r) => r.outcome)).toEqual([2, 3, 4, 5, 6, 7, 8].map((n) => `caught (${n} tests failed)`));
  });

  it('the results are the same, in the same order, with one worker or several', { timeout: 180_000 }, async () => {
    const { root, workDir } = makeProject();
    const texts: string[] = [];
    for (const workers of [1, 3, 8]) {
      const outcome = await runBreakIt({ root, breaks: MIXED, workers, workDir, runTests: async ({ workspace }) => {
          await pause(20);
          return runOfValue(workspace.dir);
        },
      });
      texts.push(formatResults(outcome.results ?? []).text);
    }
    expect(texts[1]).toBe(texts[0]);
    expect(texts[2]).toBe(texts[0]);
    expect(texts[0]).toBe(
      [
        '1    caught (3 tests failed)        caught by 3',
        '1    SURVIVED (no test failed)      no test reads this file',
        '2    INVALID (tests did not run)    the tests cannot start',
        '2    NOT APPLIED (text found 0 times) text that is not there',
        '3    NOT APPLIED (text found 2 times) text that is there twice',
        '1    caught (1 tests failed)        caught by 1',
        '1    caught (5 tests failed)        caught by 5',
        'home caught (4 tests failed)        a screens break',
        '',
        '8 breaks, 4 caught, 4 not caught or not applied.',
      ].join('\n'),
    );
    expect(formatResults(MIXED.map((b) => ({ ...b, outcome: 'caught (1 tests failed)' }))).ok).toBe(true);
    expect(formatResults(MIXED.map((b, i) => ({ ...b, outcome: i === 0 ? 'SURVIVED (no test failed)' : 'caught (1 tests failed)' }))).ok).toBe(false);
  });

  it('the check with nothing broken runs once, alone, before any break is applied', { timeout: 120_000 }, async () => {
    const { root, workDir } = makeProject();
    const calls: { dir: string; threads: number | undefined; withBrowsers: boolean; value: string; copies: string[] }[] = [];
    await runBreakIt({
      root,
      breaks: MIXED,
      workers: 4,
      workDir,
      runTests: ({ workspace, threads, withBrowsers }) => {
        const runFolder = dirname(workspace.dir);
        calls.push({
          dir: workspace.dir,
          threads,
          withBrowsers,
          value: readFileSync(join(workspace.dir, VALUE), 'utf8'),
          copies: readdirSync(runFolder).filter((name) => /^w\d+$/.test(name)),
        });
        return Promise.resolve(runOfValue(workspace.dir));
      },
    });
    expect(calls).toHaveLength(MIXED.length - 2 + 1); // two breaks cannot be applied; plus the control
    const control = calls[0]!;
    expect(control.value).toBe('good\n');
    expect(control.copies).toEqual(['w1']);
    expect(control.threads).toBeUndefined();
    expect(control.withBrowsers).toBe(true); // one of the breaks is the screens'
    const share = Math.max(1, Math.floor(availableParallelism() / 4));
    for (const call of calls.slice(1)) expect(call.threads).toBe(share);
    expect(calls.slice(1).filter((c) => c.withBrowsers)).toHaveLength(1);
    // The slow breaks (the screens') are started first, the rest in the order of the list.
    expect(calls[1]!.withBrowsers).toBe(true);
    expect(
      calls
        .slice(2)
        .map((c) => c.value.trim())
        .sort(),
    ).toEqual(['crash', 'good', 'x', 'xxx', 'xxxxx']);
  });

  it('no browsers are asked for when no break is the screens', { timeout: 120_000 }, async () => {
    const { root, workDir } = makeProject();
    const asked: boolean[] = [];
    await runBreakIt({ root, breaks: [caughtBreak(2)], workers: 1, workDir, runTests: ({ withBrowsers }) => {
        asked.push(withBrowsers);
        return Promise.resolve(pass);
      },
    });
    expect(asked).toEqual([false, false]);
  });

  it('when the tests fail with nothing broken it stops there, breaks nothing, and leaves nothing behind', { timeout: 120_000 }, async () => {
    const { root, workDir } = makeProject();
    const before = fingerprint(root);
    let calls = 0;
    const outcome = await runBreakIt({
      root,
      breaks: MIXED,
      workers: 4,
      workDir,
      runTests: () => {
        calls++;
        return Promise.resolve({ status: 1, stdout: 'Tests  1 failed | 3 passed (4)', stderr: '' });
      },
    });
    expect(calls).toBe(1);
    expect(outcome.results).toBeUndefined();
    expect(outcome.control?.stdout).toContain('1 failed');
    expect(fingerprint(root)).toEqual(before);
    expect(git(root, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
    expect(existsSync(workDir) ? readdirSync(workDir) : []).toEqual([]);
  });

  it('every copy is removed afterward, and the project node_modules and packages are as they were', { timeout: 120_000 }, async () => {
    const { root, workDir } = makeProject();
    const before = fingerprint(root);
    const copies: string[] = [];
    await runBreakIt({
      root,
      breaks: MIXED,
      workers: 3,
      workDir,
      runTests: ({ workspace }) => {
        copies.push(workspace.dir);
        return Promise.resolve(runOfValue(workspace.dir));
      },
    });
    expect(new Set(copies).size).toBe(3);
    for (const copy of copies) expect(existsSync(copy)).toBe(false);
    expect(existsSync(workDir) ? readdirSync(workDir) : []).toEqual([]);
    expect(git(root, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
    expect(readFileSync(join(root, 'node_modules', 'some-dep', 'index.js'), 'utf8')).toBe('module.exports = 1;\n');
    expect(readFileSync(join(root, 'node_modules', '@fixture', 'a', 'src', 'value.txt'), 'utf8')).toBe('good\n');
    expect(fingerprint(root)).toEqual(before);
  });

  it('there are never more copies than breaks', { timeout: 120_000 }, async () => {
    const { root, workDir } = makeProject();
    const used = new Set<string>();
    let made = 0;
    await runBreakIt({
      root,
      breaks: [caughtBreak(2), caughtBreak(3)],
      workers: 12,
      workDir,
      runTests: ({ workspace }) => {
        used.add(workspace.dir);
        made = Math.max(made, readdirSync(dirname(workspace.dir)).filter((name) => /^w\d+$/.test(name)).length);
        return Promise.resolve(pass);
      },
    });
    expect(used.size).toBe(2);
    expect(made).toBe(2);
  });

  it('with nothing to break it does nothing at all', async () => {
    const { root, workDir } = makeProject();
    const outcome = await runBreakIt({ root, breaks: [], workers: 4, workDir, runTests: () => Promise.reject(new Error('should not run')) });
    expect(outcome.results).toEqual([]);
    expect(existsSync(workDir)).toBe(false);
  });
});

// The first copy is made when the run starts and the others after the
// nothing-broken check, which can take minutes. These change the project folder
// during that check and show that every copy is still the project as it was at
// the start: the same commit, the same changed, new, and deleted files with the
// same contents, and nothing that appeared later.
describe.skipIf(insideBreakIt)('break-it: every copy is the project as it was when the run started', () => {
  const WATCHED = ['notes.txt', 'packages/a/src/new.txt', 'packages/a/src/staged.txt', 'packages/a/src/second.txt', 'packages/a/src/late.txt', 'packages/a/src/appeared.txt', 'packages/a/src/gone.txt'];
  const AT_THE_START: Record<string, string | undefined> = {
    'notes.txt': 'edited\n',
    'packages/a/src/new.txt': 'new\n',
    'packages/a/src/staged.txt': 'staged\n',
    'packages/a/src/second.txt': 'one\n',
    'packages/a/src/late.txt': undefined,
    'packages/a/src/appeared.txt': undefined,
    'packages/a/src/gone.txt': undefined,
  };

  // Every file of a copy except node_modules (links, different in each copy),
  // the git file, and the value that the breaks change.
  function codeOf(dir: string): Record<string, string> {
    const found: Record<string, string> = {};
    const walk = (folder: string): void => {
      for (const name of readdirSync(folder).sort()) {
        const path = join(folder, name);
        const key = path.slice(dir.length);
        if (key === `${sep}.git` || name === 'node_modules' || path === join(dir, VALUE)) continue;
        if (lstatSync(path).isDirectory()) walk(path);
        else found[key] = createHash('sha1').update(readFileSync(path)).digest('hex');
      }
    };
    walk(dir);
    return found;
  }

  interface Seen {
    readonly files: Record<string, string | undefined>;
    readonly head: string;
    readonly code: Record<string, string>;
    readonly depOfPackageB: string | undefined;
  }

  // Runs four breaks on four workers. The first call of runTests is the
  // nothing-broken check: the project is changed there, after the first copy has
  // been looked at and before the other three exist.
  async function copiesWhileProjectChanges(change: (root: string) => void): Promise<{ startCommit: string; seen: Seen[] }> {
    const { root, workDir } = makeProject();
    put(root, 'packages/b/package.json', '{"name":"@fixture/b"}');
    put(root, 'packages/b/node_modules/dep-b/index.js', 'module.exports = 2;\n');
    const startCommit = git(root, 'rev-parse', 'HEAD').trim();
    const seen = new Map<string, Seen>();
    let checking = true;
    await runBreakIt({
      root,
      breaks: [caughtBreak(2), caughtBreak(3), caughtBreak(4), caughtBreak(5)],
      workers: 4,
      workDir,
      runTests: ({ workspace }) => {
        if (!seen.has(workspace.dir)) {
          const at = (path: string): string | undefined => (existsSync(join(workspace.dir, path)) ? readFileSync(join(workspace.dir, path), 'utf8') : undefined);
          seen.set(workspace.dir, {
            files: Object.fromEntries(WATCHED.map((path) => [path, at(path)])),
            head: git(workspace.dir, 'rev-parse', 'HEAD').trim(),
            code: codeOf(workspace.dir),
            depOfPackageB: at('packages/b/node_modules/dep-b/index.js'),
          });
        }
        if (checking) {
          checking = false;
          change(root);
        }
        return Promise.resolve(pass);
      },
    });
    return { startCommit, seen: [...seen.values()] };
  }

  function expectEveryCopyIsTheStart({ startCommit, seen }: { startCommit: string; seen: Seen[] }): void {
    expect(seen).toHaveLength(4);
    for (const copy of seen) {
      expect(copy.head).toBe(startCommit);
      expect(copy.files).toEqual(AT_THE_START);
      expect(copy.code).toEqual(seen[0]!.code);
      expect(copy.depOfPackageB).toBe('module.exports = 2;\n');
    }
  }

  it('a commit that lands during the check is in no copy', { timeout: 120_000 }, async () => {
    const result = await copiesWhileProjectChanges((root) => {
      put(root, 'packages/a/src/second.txt', 'two\n');
      put(root, 'packages/a/src/late.txt', 'late\n');
      git(root, 'add', 'packages/a/src/second.txt', 'packages/a/src/late.txt');
      git(root, 'commit', '--quiet', '-m', 'late', '--', 'packages/a/src/second.txt', 'packages/a/src/late.txt');
    });
    expectEveryCopyIsTheStart(result);
  });

  it('files edited or created in the project during the check are seen by no copy', { timeout: 120_000 }, async () => {
    expectEveryCopyIsTheStart(
      await copiesWhileProjectChanges((root) => {
        put(root, 'notes.txt', 'rewritten during the check\n');
        put(root, 'packages/a/src/new.txt', 'rewritten during the check\n');
        put(root, 'packages/a/src/appeared.txt', 'appeared during the check\n');
      }),
    );
  });

  it('files deleted from the project during the check are still in every copy', { timeout: 120_000 }, async () => {
    expectEveryCopyIsTheStart(
      await copiesWhileProjectChanges((root) => {
        rmSync(join(root, 'packages/a/src/staged.txt'));
        rmSync(join(root, 'packages/a/src/new.txt'));
        rmSync(join(root, 'notes.txt'));
      }),
    );
  });

  it('the list of packages is read once, at the start', { timeout: 120_000 }, async () => {
    expectEveryCopyIsTheStart(
      await copiesWhileProjectChanges((root) => {
        put(root, 'package.json', JSON.stringify({ name: 'fixture', private: true, workspaces: ['elsewhere/*'] }));
      }),
    );
  });

  it('all of it at once', { timeout: 120_000 }, async () => {
    expectEveryCopyIsTheStart(
      await copiesWhileProjectChanges((root) => {
        put(root, 'packages/a/src/second.txt', 'two\n');
        put(root, 'packages/a/src/late.txt', 'late\n');
        git(root, 'add', 'packages/a/src/second.txt', 'packages/a/src/late.txt');
        git(root, 'commit', '--quiet', '-m', 'late', '--', 'packages/a/src/second.txt', 'packages/a/src/late.txt');
        put(root, 'notes.txt', 'rewritten during the check\n');
        put(root, 'packages/a/src/appeared.txt', 'appeared during the check\n');
        rmSync(join(root, 'packages/a/src/staged.txt'));
        rmSync(join(root, 'packages/a/src/new.txt'));
        put(root, 'package.json', JSON.stringify({ name: 'fixture', private: true, workspaces: ['elsewhere/*'] }));
      }),
    );
  });
});

describe.skipIf(insideBreakIt)('break-it: a run that is killed', () => {
  it('leaves the project folder as it was, and the next run clears away its copies', { timeout: 120_000 }, async () => {
    const { root, workDir, base } = makeProject();
    const before = fingerprint(root);
    const marker = join(base, 'a-break-is-being-judged');
    const runner = join(base, 'killed-run.mjs');
    writeFileSync(
      runner,
      `import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runBreakIt } from ${JSON.stringify(pathToFileURL(join(scriptsFolder, 'break-it-lib.mjs')).href)};
const [root, workDir, marker] = process.argv.slice(2);
let calls = 0;
await runBreakIt({
  root, workDir, workers: 2,
  breaks: [
    { section: 1, file: ${JSON.stringify(VALUE)}, find: 'good', replace: 'xx', why: 'one' },
    { section: 1, file: ${JSON.stringify(VALUE)}, find: 'good', replace: 'xxx', why: 'two' },
  ],
  runTests: async ({ workspace }) => {
    if (calls++ === 0) return { status: 0, stdout: '', stderr: '' };
    writeFileSync(marker, readFileSync(join(workspace.dir, ${JSON.stringify(VALUE)}), 'utf8'));
    await new Promise((done) => setTimeout(done, 600_000));
  },
});
`,
    );
    const child = spawn(process.execPath, [runner, root, workDir, marker], { stdio: 'ignore' });
    const exited = new Promise((done) => child.once('exit', done));
    const deadline = Date.now() + 60_000;
    while (!existsSync(marker) && Date.now() < deadline) await pause(100);
    // Killed while a break is applied in a copy.
    expect(readFileSync(marker, 'utf8')).toMatch(/^x+\n$/);
    expect(child.exitCode, 'the run ended by itself').toBeNull();
    child.kill('SIGKILL');
    await exited;

    expect(fingerprint(root)).toEqual(before);
    expect(git(root, 'worktree', 'list', '--porcelain').match(/^worktree /gm)!.length).toBeGreaterThan(1);

    const said: string[] = [];
    removeStaleRuns(root, workDir, (line) => said.push(line));
    expect(said.join('\n')).toContain('Removed the copies left by a run that was stopped');
    expect(existsSync(workDir) ? readdirSync(workDir) : []).toEqual([]);
    expect(git(root, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
    expect(fingerprint(root)).toEqual(before);
    expect(readFileSync(join(root, 'node_modules', 'some-dep', 'index.js'), 'utf8')).toBe('module.exports = 1;\n');
  });

  it('is not mistaken for a stopped run while it is still going', { timeout: 120_000 }, async () => {
    const { root, workDir } = makeProject();
    const said: string[] = [];
    let during: string[] = [];
    await runBreakIt({
      root,
      breaks: [caughtBreak(2), caughtBreak(3)],
      workers: 2,
      workDir,
      runTests: ({ workspace }) => {
        // A second run starting now (its own process id is this one, which is alive).
        removeStaleRuns(root, workDir, (line) => said.push(line));
        during = readdirSync(dirname(workspace.dir));
        return Promise.resolve(pass);
      },
    });
    expect(said).toEqual([]);
    expect(during).toContain('w1');
  });
});

describe.skipIf(insideBreakIt)('break-it: copies left by runs that were stopped', () => {
  it('clears away those of this project, and leaves those of another project alone', () => {
    const { root, workDir, base } = makeProject();
    // The process id of a process that has ended.
    const gone = Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
    for (const [name, owner] of [
      ['r-mine', root],
      ['r-another-project', join(base, 'another-project')],
    ] as const) {
      mkdirSync(join(workDir, name, 'w1'), { recursive: true });
      writeFileSync(join(workDir, name, 'owner.json'), JSON.stringify({ pid: gone, root: owner }));
    }
    mkdirSync(join(workDir, 'not-a-run'));
    const said: string[] = [];
    removeStaleRuns(root, workDir, (line) => said.push(line));
    expect(readdirSync(workDir).sort()).toEqual(['not-a-run', 'r-another-project']);
    expect(said).toEqual(['Removed the copies left by a run that was stopped (r-mine).']);
  });
});

describe.skipIf(insideBreakIt)('break-it: putting back what an older version left broken', () => {
  it('restores a broken file from its backup and removes the backup', () => {
    const { root } = makeProject();
    put(root, VALUE, 'broken on purpose\n');
    put(root, `${VALUE}.break-it-backup`, 'good\n');
    const said: string[] = [];
    const restored = restoreLeftovers(root, MIXED, (line) => said.push(line));
    expect(restored).toEqual([VALUE]);
    expect(said).toEqual([`Restored ${VALUE}: an earlier run was stopped while it was broken.`]);
    expect(readFileSync(join(root, VALUE), 'utf8')).toBe('good\n');
    expect(existsSync(join(root, `${VALUE}.break-it-backup`))).toBe(false);
  });

  it('does nothing when no run was stopped', () => {
    const { root } = makeProject();
    const before = fingerprint(root);
    expect(restoreLeftovers(root, MIXED, () => undefined)).toEqual([]);
    expect(fingerprint(root)).toEqual(before);
  });
});

describe.skipIf(insideBreakIt)('break-it: the test runner is started in the copy', () => {
  it('runs vitest from the copy, with its own temp folder, a share of the cores, and the browser tests only when asked', { timeout: 120_000 }, async () => {
    const { root, workDir, base } = makeProject();
    const log = join(base, 'vitest-calls.jsonl');
    // A stand-in for vitest that writes down how it was started. It passes when
    // it is not told how many files to run at once (the control) and fails otherwise.
    put(
      root,
      'node_modules/vitest/vitest.mjs',
      `import { appendFileSync } from 'node:fs';
const env = process.env;
appendFileSync(env.FAKE_VITEST_LOG, JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), env: { skip: env.SKIP_BROWSER_TESTS, breakIt: env.BREAK_IT_RUN, temp: env.TEMP, tmp: env.TMP, tmpdir: env.TMPDIR } }) + '\\n');
if (process.argv.some((arg) => arg.startsWith('--maxWorkers'))) {
  console.log('Tests  1 failed | 3 passed (4)');
  process.exit(1);
}
`,
    );
    process.env['FAKE_VITEST_LOG'] = log;
    try {
      const breaks: BreakSpec[] = [caughtBreak(2), caughtBreak(3), { ...caughtBreak(4), section: 'home' }, { ...caughtBreak(5), section: 'home' }];
      const outcome = await runBreakIt({ root, breaks, workers: 2, workDir, runTests: vitestRunner({ only: 'some/file.test.ts' }) });
      expect(outcome.results?.map((r) => r.outcome)).toEqual(Array(4).fill('caught (1 tests failed)'));
    } finally {
      delete process.env['FAKE_VITEST_LOG'];
    }
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { cwd: string; args: string[]; env: Record<string, string> });
    expect(calls).toHaveLength(5);
    const [control, ...rest] = calls;
    // The control: every core, nothing told. Then each break gets a share of the cores.
    expect(control!.args).toEqual(['run', 'some/file.test.ts']);
    const share = Math.max(1, Math.floor(availableParallelism() / 2));
    for (const call of rest) expect(call.args).toEqual(['run', `--maxWorkers=${share}`, 'some/file.test.ts']);
    // The tests run in a copy, never in the project folder.
    for (const call of calls) {
      expect(call.cwd.startsWith(workDir)).toBe(true);
      expect(call.cwd.startsWith(root)).toBe(false);
      expect(call.env.breakIt).toBe('1');
    }
    // Each copy has a temp folder of its own, beside it, so that no two workers share a
    // browser profile.
    expect(new Set(calls.map((c) => c.cwd)).size).toBe(2);
    expect(new Set(calls.map((c) => c.env.temp)).size).toBe(2);
    for (const call of calls) {
      expect(call.env.tmp).toBe(call.env.temp);
      expect(call.env.tmpdir).toBe(call.env.temp);
      expect(call.env.temp!.startsWith(workDir)).toBe(true);
      expect(call.env.temp).not.toBe(call.cwd);
    }
    // The browser tests run for the screens' breaks, and for the control, since some are.
    expect(control!.env.skip).toBe('0');
    expect(rest.map((c) => c.env.skip).sort()).toEqual(['0', '0', '1', '1']);
  });
});

// A break can make a test loop for ever, or grow without end: one held a
// worker for eight hours and 16 GB of his RAM (Oct 11). Each break's run is
// stopped after a time limit, which counts as not caught (a test must fail in
// good time), and the tests run with a memory cap.
describe.skipIf(insideBreakIt)('break-it: a run of the tests that never ends, or grows without end', () => {
  const alive = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  it('is stopped after the time limit, said to have hung, counted as not caught, and nothing of it is left running', { timeout: 120_000 }, async () => {
    const { root, workDir, base } = makeProject();
    const pids = join(base, 'pids.txt');
    // A stand-in for vitest: the control passes; a break's run never ends, and has a child of its own, as a test worker would.
    put(
      root,
      'node_modules/vitest/vitest.mjs',
      `import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
if (!process.argv.some((arg) => arg.startsWith('--maxWorkers'))) process.exit(0);
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
appendFileSync(process.env.FAKE_VITEST_PIDS, process.pid + ' ' + child.pid + '\\n');
setInterval(() => {}, 1000);
`,
    );
    process.env['FAKE_VITEST_PIDS'] = pids;
    let results;
    try {
      const outcome = await runBreakIt({ root, breaks: [caughtBreak(2)], workers: 1, workDir, runTests: vitestRunner({ only: undefined, timeLimitMs: 3_000 }) });
      results = outcome.results;
    } finally {
      delete process.env['FAKE_VITEST_PIDS'];
    }
    expect(results?.map((r) => r.outcome)).toEqual(['HUNG (stopped after 3 s)']);
    expect(formatResults(results ?? []).ok).toBe(false);
    const started = readFileSync(pids, 'utf8').trim().split(/\s+/).map(Number);
    expect(started).toHaveLength(2);
    for (const pid of started) expect(alive(pid), `process ${pid} still running`).toBe(false);
  });

  it('runs the tests with a memory cap of 4 GB for each process, added to what NODE_OPTIONS already says', { timeout: 120_000 }, async () => {
    const { root, workDir, base } = makeProject();
    const log = join(base, 'node-options.txt');
    put(root, 'node_modules/vitest/vitest.mjs', `import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.FAKE_VITEST_LOG, (process.env.NODE_OPTIONS ?? '') + '\\n');\nif (process.argv.some((arg) => arg.startsWith('--maxWorkers'))) { console.log('Tests  1 failed | 1 passed (2)'); process.exit(1); }\n`);
    const before = process.env['NODE_OPTIONS'];
    process.env['FAKE_VITEST_LOG'] = log;
    process.env['NODE_OPTIONS'] = '--no-warnings';
    try {
      const outcome = await runBreakIt({ root, breaks: [caughtBreak(2)], workers: 1, workDir, runTests: vitestRunner({ only: undefined }) });
      expect(outcome.results?.map((r) => r.outcome)).toEqual(['caught (1 tests failed)']);
    } finally {
      delete process.env['FAKE_VITEST_LOG'];
      if (before === undefined) delete process.env['NODE_OPTIONS'];
      else process.env['NODE_OPTIONS'] = before;
    }
    expect(readFileSync(log, 'utf8').trim().split('\n')).toEqual(['--no-warnings --max-old-space-size=4096', '--no-warnings --max-old-space-size=4096']);
  });
});

describe('break-it: the command line', () => {
  it('reads the options', () => {
    expect(parseArgs([])).toEqual({ restore: false, only: undefined, match: undefined, file: undefined, workers: undefined, sections: [] });
    const parsed = parseArgs(['3', '4', 'bank', '--workers', '5', '--only', 'a/b.test.ts', '--match', 'A1[0-9]', '--file=ui/blocks', '--restore']);
    expect(parsed.sections).toEqual(['3', '4', 'bank']);
    expect(parsed.workers).toBe(5);
    expect(parsed.only).toBe('a/b.test.ts');
    expect(parsed.match?.test('A14 something')).toBe(true);
    expect(parsed.file?.test('packages/web/src/ui/blocks.tsx')).toBe(true);
    expect(parsed.restore).toBe(true);
  });

  it('a value after a flag is never taken for a section', () => {
    expect(parseArgs(['--workers', '2', '--match', '11', '11']).sections).toEqual(['11']);
  });

  it.each([['--workers', '0'], ['--workers', '-1'], ['--workers', '2.5'], ['--workers', 'many']])('refuses %s %s', (flag, value) => {
    expect(() => parseArgs([flag, value])).toThrow('--workers needs a whole number of 1 or more');
  });

  it('refuses an option it does not know, a missing value, and a bad pattern', () => {
    expect(() => parseArgs(['--worker', '3'])).toThrow('Unknown option --worker');
    expect(() => parseArgs(['--workers'])).toThrow('--workers needs a value');
    expect(() => parseArgs(['--match', '('])).toThrow('--match needs a regular expression');
  });

  it('chooses breaks by section, reason, and file', () => {
    const sections = (words: string[]): string[] => selectBreaks(MIXED, { sections: words, match: undefined, file: undefined }).map((b) => b.why);
    expect(sections([])).toHaveLength(MIXED.length);
    expect(sections(['2'])).toEqual(['the tests cannot start', 'text that is not there']);
    expect(sections(['home'])).toEqual(['a screens break']);
    expect(selectBreaks(MIXED, { sections: ['1'], match: /caught by [15]/, file: undefined }).map((b) => b.why)).toEqual(['caught by 1', 'caught by 5']);
    expect(selectBreaks(MIXED, { sections: [], match: undefined, file: /second/ }).map((b) => b.why)).toEqual(['no test reads this file']);
  });

  it('uses the number of cores minus two by default, and at least one', () => {
    expect(defaultWorkers()).toBe(Math.max(1, availableParallelism() - 2));
  });
});
