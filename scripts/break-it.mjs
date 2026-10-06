// Break-it check (CLAUDE.md, testing bar point 3).
//
// Breaks the money math on purpose, one way at a time, and runs every test.
// Some test must fail each time. Each break is a find-and-replace listed in
// packages/money/break-it.json. The file is always restored afterward.
//
//   node scripts/break-it.mjs          every break
//   node scripts/break-it.mjs 3 4      only breaks for rulebook sections 3 and 4
//
// Exits non-zero if any break survives (no test failed) or cannot be applied.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const breaks = JSON.parse(readFileSync(new URL('packages/money/break-it.json', root), 'utf8'));
const sections = process.argv.slice(2);
const chosen = sections.length === 0 ? breaks : breaks.filter((b) => sections.includes(String(b.section)));

const originals = new Map();
function restoreAll() {
  for (const [file, text] of originals) writeFileSync(new URL(file, root), text);
}
process.on('SIGINT', () => {
  restoreAll();
  process.exit(130);
});

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
  try {
    writeFileSync(url, original.replace(b.find, () => b.replace));
    const run = spawnSync('npx', ['vitest', 'run'], { cwd: root, encoding: 'utf8' });
    const output = `${run.stdout}${run.stderr}`;
    const failed = /Tests\s+(\d+) failed/.exec(output)?.[1];
    // A break that stops the tests from loading proves nothing, so it counts
    // as a bad break to fix, not as caught.
    const outcome = run.status === 0 ? 'SURVIVED (no test failed)' : failed ? `caught (${failed} tests failed)` : 'INVALID (tests did not run)';
    results.push({ ...b, outcome });
  } finally {
    writeFileSync(url, original);
    originals.delete(b.file);
  }
}

for (const r of results) console.log(`${String(r.section).padEnd(4)} ${r.outcome.padEnd(30)} ${r.why}`);
const bad = results.filter((r) => !r.outcome.startsWith('caught'));
console.log(`\n${results.length} breaks, ${results.length - bad.length} caught, ${bad.length} not caught or not applied.`);
process.exit(bad.length === 0 ? 0 : 1);
