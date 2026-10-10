import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Rule 0.4 for the screens: they never move money. They ask the app's own
// server for numbers, and the only things they ever send are that he has
// seen a take-back (10.6, QUESTIONS.md B84), his choice for an item in
// review, which the server's money math decides, and, on the real server, the
// login's own requests (Step 2: who is logged in and with which passkeys,
// never money). None of it reaches the bank. Nothing about money is kept on
// the phone either.
const sourceDir = new URL('../src/', import.meta.url);

function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(sourceDir, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .map((name) => ({ name, text: readFileSync(new URL(name, sourceDir), 'utf8') }));
}

// Every fetch( call with its whole argument list, brackets balanced.
function fetchCalls(): { readonly name: string; readonly call: string }[] {
  return sourceFiles().flatMap(({ name, text }) =>
    [...text.matchAll(/\bfetch\(/g)].map((m) => {
      let depth = 0;
      let i = (m.index ?? 0) + 'fetch'.length;
      do {
        if (text[i] === '(') depth += 1;
        if (text[i] === ')') depth -= 1;
        i += 1;
      } while (depth > 0 && i < text.length);
      return { name, call: text.slice(m.index, i).replace(/\s+/g, ' ') };
    }),
  );
}

describe('0.4 the screens never move money', () => {
  it('0.4 the screens have source files to check', () => {
    expect(sourceFiles().length).toBeGreaterThan(5);
  });

  it("0.4 every request goes to the app's own server", () => {
    const calls = fetchCalls();
    expect(calls.length).toBeGreaterThan(1);
    // The login's requests go to one of its own /api/auth addresses (AuthPath in api.ts).
    for (const { name, call } of calls) expect(call, name).toMatch(/^fetch\( ?('\/api\/|path, )/);
    const api = sourceFiles().find(({ name }) => name.replaceAll('\\', '/') === 'app/api.ts')?.text ?? '';
    expect(api).toMatch(/type AuthPath = ('\/api\/auth\/[a-z/]+'( \| )?)+;/);
  });

  it('0.4 every request only reads, except the ones that send his answers (a take-back seen, a choice in review) and the login\'s own', () => {
    const writes = fetchCalls().filter(({ call }) => /method|body/.test(call));
    expect(writes.map((w) => w.call)).toEqual([
      "fetch('/api/seen', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'bank-took-back', id }), })",
      "fetch('/api/choice', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), })",
      "fetch(path, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })",
    ]);
  });

  it('0.4 every request is made in one place, app/api.ts, and the screens only call what it offers', () => {
    const makers = sourceFiles()
      .filter(({ text }) => /\bfetch\(/.test(text))
      .map(({ name }) => name.replaceAll('\\', '/'));
    expect(makers).toEqual(['app/api.ts']);
  });

  it('0.4 no other way to send anything, and nothing kept on the phone', () => {
    const forbidden = /\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|document\.cookie|eval)\b|\bFunction\(/;
    for (const { name, text } of sourceFiles()) expect(text.match(forbidden)?.[0], name).toBeUndefined();
  });
});
