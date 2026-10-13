import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Rule 0.4 for the screens: they never move money. They ask the app's own
// server for numbers, and the only things they ever send are that he has
// seen a take-back (10.6, QUESTIONS.md B84), his choice for an item in
// review, which the server's money math decides, and, on the real server, the
// login's own requests (Step 2: who is logged in and with which passkeys,
// never money), how often it syncs with the bank (Step 3: a setting, never
// money), the Notifications card's (Phase 5: which devices get the
// alerts, never money), and the Bank connection screen's (1.1 to 1.3: which
// bank the app reads and which account is which, never money; the bank's own
// login is Plaid's, and the bank key never comes to the phone). None of it
// moves money at the bank. Nothing about money is kept on
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
    // The login's requests go to one of its own /api/auth addresses (AuthPath
    // in api.ts), and the Notifications card's to its three (PushPath).
    for (const { name, call } of calls) expect(call, name).toMatch(/^fetch\( ?('\/api\/|path, |pushPath, |bankPath, )/);
    const api = sourceFiles().find(({ name }) => name.replaceAll('\\', '/') === 'app/api.ts')?.text ?? '';
    expect(api).toMatch(/type AuthPath = ('\/api\/auth\/[a-z/]+'( \| )?)+;/);
    expect(api).toContain("export type PushPath = '/api/push/on' | '/api/push/off' | '/api/push/test';");
    expect(api).toContain("export type BankPath = '/api/bank/link' | '/api/bank/connected' | '/api/bank/roles' | '/api/bank/read';");
  });

  it('0.4 every request only reads, except the ones that send his answers (a take-back seen, a choice in review), the login\'s own, and how often to sync', () => {
    const writes = fetchCalls().filter(({ call }) => /method|body/.test(call));
    expect(writes.map((w) => w.call)).toEqual([
      "fetch('/api/seen', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'bank-took-back', id }), })",
      "fetch('/api/choice', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), })",
      "fetch(path, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })",
      "fetch('/api/sync/every', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ minutes }) })",
      "fetch(pushPath, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })",
      "fetch(bankPath, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })",
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
    // 10.12 (QUESTIONS.md A42): the service worker alone keeps the ids of the alerts it showed; checked below.
    const inWorker = new RegExp(forbidden.source.replace('|indexedDB', ''));
    for (const { name, text } of sourceFiles()) expect(text.match(name.replaceAll('\\', '/') === 'sw/sw.ts' ? inWorker : forbidden)?.[0], name).toBeUndefined();
  });

  it('0.4 10.12 A42 the only thing kept on the phone is the ids of the alerts the service worker showed: one database, opened in sw.ts, holding { id } and nothing else', () => {
    const worker = sourceFiles().find(({ name }) => name.replaceAll('\\', '/') === 'sw/sw.ts')?.text ?? '';
    expect(worker.match(/\bindexedDB\b/g)).toEqual(['indexedDB']);
    expect(worker).toContain("self.indexedDB.open('budget-alerts-shown', 1)");
    // What it writes to its one store: an id, only; nothing is put anywhere else.
    expect([...worker.matchAll(/\bstore\.(add|put)\(([^)]*)\)/g)].map((m) => m[0])).toEqual(['store.add({ id })']);
    expect(worker).not.toMatch(/\.put\(/);
    expect(worker.match(/createObjectStore\(/g)).toHaveLength(1);
  });
});
