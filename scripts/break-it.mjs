// Break-it check (CLAUDE.md, testing bar point 3).
//
// Breaks the money math on purpose, one way at a time, and runs every test.
// Some test must fail each time. Each break is a find-and-replace listed in
// packages/money/break-it.json. The file is always restored afterward.
//
//   node scripts/break-it.mjs            every break
//   node scripts/break-it.mjs 3 4        only breaks for rulebook sections 3 and 4
//   node scripts/break-it.mjs --restore  only put back files a stopped run left broken
//
// Exits non-zero if any break survives (no test failed) or cannot be applied,
// or if the tests fail before anything is broken.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const breaks = JSON.parse(readFileSync(new URL('packages/money/break-it.json', root), 'utf8'));
const args = process.argv.slice(2);
const sections = args.filter((arg) => arg !== '--restore');
const chosen = sections.length === 0 ? breaks : breaks.filter((b) => sections.includes(String(b.section)));

// While a break is applied, the untouched file is also kept next to it as
// <file>.break-it-backup. If a run is killed before it can restore the file,
// the test suite fails until the file is put back (test/break-it-guard.test.ts),
// and the next run puts it back first.
const backupName = (file) => `${file}.break-it-backup`;
const backupOf = (file) => new URL(backupName(file), root);
for (const file of new Set(breaks.map((b) => b.file))) {
  if (existsSync(backupOf(file))) {
    writeFileSync(new URL(file, root), readFileSync(backupOf(file), 'utf8'));
    rmSync(backupOf(file));
    console.log(`Restored ${file}: an earlier run was stopped while it was broken.`);
  }
}
if (args.includes('--restore')) process.exit(0);

const originals = new Map();
function restoreAll() {
  for (const [file, text] of originals) {
    writeFileSync(new URL(file, root), text);
    rmSync(backupOf(file), { force: true });
  }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    restoreAll();
    process.exit(130);
  });
}

// Runs every test, with node itself (npx cannot be started this way on
// Windows). The break being tested has its backup in place, so the run is told
// which backup is expected (BREAK_IT_BACKUP); the guard still fails on any other.
const vitest = fileURLToPath(new URL('node_modules/vitest/vitest.mjs', root));
function runTests(file) {
  return spawnSync(process.execPath, [vitest, 'run'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BREAK_IT_BACKUP: backupName(file) },
  });
}

// Control run: with a backup in place and nothing broken, every test must
// pass. If one fails anyway, every break below would look caught.
if (chosen.length > 0) {
  const { file } = chosen[0];
  originals.set(file, readFileSync(new URL(file, root), 'utf8'));
  writeFileSync(backupOf(file), originals.get(file));
  let control;
  try {
    control = runTests(file);
  } finally {
    rmSync(backupOf(file), { force: true });
    originals.delete(file);
  }
  if (control.status !== 0) {
    console.log(control.error ? String(control.error) : `${control.stdout}${control.stderr}`);
    console.log('Stopped before breaking anything: the tests fail with nothing broken, so no break can be judged. Fix that first.');
    process.exit(1);
  }
}

const results = [];
for (const b of chosen) {
  const url = new URL(b.file, root);
  const original = readFileSync(url, 'utf8');
  const count = original.split(b.find).length - 1;
  if (count !== 1) {
    results.push({ ...b, outcome: `NOT APPLIED (text found ${count} times)` });
    continue;
  }
  originals.set(b.file, original);
  writeFileSync(backupOf(b.file), original);
  try {
    writeFileSync(url, original.replace(b.find, () => b.replace));
    const run = runTests(b.file);
    const output = `${run.stdout}${run.stderr}`;
    const failed = /Tests\s+(\d+) failed/.exec(output)?.[1];
    // A break that stops the tests from loading proves nothing, so it counts
    // as a bad break to fix, not as caught.
    const outcome = run.status === 0 ? 'SURVIVED (no test failed)' : failed ? `caught (${failed} tests failed)` : 'INVALID (tests did not run)';
    results.push({ ...b, outcome });
  } finally {
    writeFileSync(url, original);
    rmSync(backupOf(b.file), { force: true });
    originals.delete(b.file);
  }
}

for (const r of results) console.log(`${String(r.section).padEnd(4)} ${r.outcome.padEnd(30)} ${r.why}`);
const bad = results.filter((r) => !r.outcome.startsWith('caught'));
console.log(`\n${results.length} breaks, ${results.length - bad.length} caught, ${bad.length} not caught or not applied.`);
process.exit(bad.length === 0 ? 0 : 1);
