// Break-it check (CLAUDE.md, testing bar point 3).
//
// Breaks the code on purpose, one way at a time, and runs every test. Some
// test must fail each time. Each break is a find-and-replace listed in
// packages/money/break-it.json (the money math), packages/server/break-it.json
// (the bank connection, section "bank"), or packages/web/break-it.json (the
// screens, section "home").
//
// The breaks are never applied in the project folder. Each worker has its own
// copy of the code (a git worktree in the temp folder, made from the last
// commit plus what is changed or new in the project folder when the run
// starts), applies a break there, runs the tests there, and puts the file
// back. So other work can go on in the project folder while this runs; edits
// made after it started are not tested. The workers run side by side.
//
// The browser tests run only for the screens' breaks (section "home"); every
// other break is judged by the rest of the tests. That can only make a break
// look less caught, never more.
//
//   node scripts/break-it.mjs                    every break
//   node scripts/break-it.mjs 3 4                only breaks for rulebook sections 3 and 4
//   node scripts/break-it.mjs bank               only breaks for the bank connection
//   node scripts/break-it.mjs home               only breaks for the screens
//   node scripts/break-it.mjs --workers 4        use 4 workers (the default is the number of
//                                                cores minus 2; 1 judges one break at a time)
//   node scripts/break-it.mjs --restore          put back files an older version of this
//                                                script left broken, and remove copies left by
//                                                a run that was killed
//   node scripts/break-it.mjs --only <test file> judge every break by that one test file,
//                                                to see what it catches on its own
//   node scripts/break-it.mjs --match <pattern>  only breaks whose reason matches the pattern
//                                                (a regular expression), such as "A14"
//   node scripts/break-it.mjs --file <pattern>   only breaks in files whose path matches the pattern
//                                                (a regular expression), such as "ui/blocks"
//
// BROWSER_ENGINE=chromium (or webkit) in the environment makes the browser
// tests run one engine only, to go faster: a break one engine catches is caught.
//
// The nothing-broken check runs once, before the workers start. The results
// are listed in the order of the break lists, whatever order the workers
// finished in, and are the same whatever the number of workers. Progress and
// the time taken go to stderr.
//
// Exits non-zero if any break survives (no test failed) or cannot be applied,
// or if the tests fail before anything is broken.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BREAK_LISTS, defaultWorkDir, defaultWorkers, formatResults, loadBreaks, parseArgs, removeStaleRuns, restoreLeftovers, runBreakIt, selectBreaks, vitestRunner } from './break-it-lib.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}

const breaks = loadBreaks(root, BREAK_LISTS);
restoreLeftovers(root, breaks);
if (options.restore) {
  removeStaleRuns(root, defaultWorkDir());
  process.exit(0);
}

const chosen = selectBreaks(breaks, options);
const workers = options.workers ?? defaultWorkers();
const started = Date.now();
const outcome = await runBreakIt({
  root,
  breaks: chosen,
  workers,
  runTests: vitestRunner({ only: options.only }),
  progress: (done, total, r) => console.error(`[${done}/${total}] ${r.outcome} ${r.why}`),
});

if (outcome.control) {
  const { control } = outcome;
  console.log(control.error ? String(control.error) : `${control.stdout}${control.stderr}`);
  console.log('Stopped before breaking anything: the tests fail with nothing broken, so no break can be judged. Fix that first.');
  process.exit(1);
}

const { text, ok } = formatResults(outcome.results);
console.log(text);
const seconds = Math.round((Date.now() - started) / 1000);
console.error(`Took ${Math.floor(seconds / 60)} min ${seconds % 60} s with ${Math.min(workers, Math.max(chosen.length, 1))} worker${workers === 1 ? '' : 's'}.`);
process.exit(ok ? 0 : 1);
