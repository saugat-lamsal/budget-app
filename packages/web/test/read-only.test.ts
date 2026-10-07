import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Rule 0.4 for the screens: they only read. They ask the app's own server
// for numbers and never send anything that could change them, let alone
// move money. Nothing about money is kept on the phone either.
const sourceDir = new URL('../src/', import.meta.url);

function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(sourceDir, { recursive: true, encoding: 'utf8' })
    .filter((name) => /\.(ts|tsx)$/.test(name))
    .map((name) => ({ name, text: readFileSync(new URL(name, sourceDir), 'utf8') }));
}

describe('0.4 the screens only read', () => {
  it('0.4 the screens have source files to check', () => {
    expect(sourceFiles().length).toBeGreaterThan(5);
  });

  it("0.4 every request goes to the app's own server, and only reads", () => {
    const calls = sourceFiles().flatMap(({ name, text }) => [...text.matchAll(/\bfetch\(\s*([^,)]+)([^)]*)\)/g)].map((m) => ({ name, url: m[1] ?? '', options: m[2] ?? '' })));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.url, call.name).toMatch(/^'\/api\//);
      expect(call.options, call.name).not.toMatch(/method|body/);
    }
  });

  it('0.4 no other way to send anything, and nothing kept on the phone', () => {
    const forbidden = /\b(XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|document\.cookie|eval)\b|\bFunction\(/;
    for (const { name, text } of sourceFiles()) expect(text.match(forbidden)?.[0], name).toBeUndefined();
  });
});
