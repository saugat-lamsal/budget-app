// The end-of-phase table (CLAUDE.md, testing bar point 7): every numbered
// rule in the rulebook and the tests named after it, from the results of a
// full run.
//
//   npx vitest run --reporter=json --outputFile=results.json
//   node scripts/rule-table.mjs results.json
//
// A test counts for a rule when its name (with the names of the groups it is
// in) has the rule's number in it, as the testing bar asks ("4.6 pending
// charge counts once"). Prints one line per rule: its number, the start of the
// rule, how many tests, and the name of one of them; then the totals.
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const file = process.argv[2];
if (file === undefined) {
  console.error('Give the results of a full run: node scripts/rule-table.mjs results.json');
  process.exit(2);
}

// The numbered rules: "4.6  A pending charge counts once. ...", to the next rule.
function rulesOf(text) {
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^(\d{1,2}\.\d{1,2}) +([A-Z"].*)$/.exec(line);
    if (m) rules.push({ number: m[1], text: m[2] });
  }
  return rules;
}

// The rule numbers a test's name has in it.
function numbersIn(name, known) {
  const found = new Set();
  for (const m of name.matchAll(/(?<![\d.$,:/-])(\d{1,2}\.\d{1,2})(?![\d,]|\.\d)/g)) if (known.has(m[1])) found.add(m[1]);
  return found;
}

const rules = rulesOf(readFileSync(new URL('budget-app-rulebook.md', root), 'utf8'));
const known = new Set(rules.map((r) => r.number));
const results = JSON.parse(readFileSync(file, 'utf8'));
const tests = results.testResults.flatMap((f) => f.assertionResults.map((t) => ({ name: [...t.ancestorTitles, t.title].join(' > '), status: t.status })));
const byRule = new Map(rules.map((r) => [r.number, []]));
for (const t of tests) for (const n of numbersIn(t.name, known)) byRule.get(n).push(t);

const pad = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
console.log(`${pad('Rule', 6)}${pad('What it says', 46)}${pad('Tests', 7)}One of them`);
for (const r of rules) {
  const named = byRule.get(r.number);
  const one = named.find((t) => t.name.split(' > ').at(-1).startsWith(r.number)) ?? named[0];
  console.log(`${pad(r.number, 6)}${pad(r.text, 46)}${pad(String(named.length), 7)}${one === undefined ? 'NONE' : pad(one.name.split(' > ').at(-1), 90)}`);
}
const passed = tests.filter((t) => t.status === 'passed').length;
const without = rules.filter((r) => byRule.get(r.number).length === 0).map((r) => r.number);
console.log('');
console.log(`Rules: ${rules.length}. Rules without a test named after them: ${without.length === 0 ? 'none' : without.join(', ')}.`);
console.log(`Tests in this run: ${tests.length}, passed: ${passed}, failed: ${tests.filter((t) => t.status === 'failed').length}, skipped: ${tests.length - passed - tests.filter((t) => t.status === 'failed').length}.`);
