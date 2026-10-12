import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Phase 6's checklist: the phone app holds no secret. The screens and the
// service worker are built exactly as for the server (vite, packages/web),
// into a folder of their own, with made-up secrets of every kind the server
// has in the environment while it builds, and every file built is searched:
// for those values, for the values in this computer's .env if there is one
// (never shown: a failure names the setting only), for the names of the
// secrets, and for anything shaped like a key.

const SECRETS: Record<string, string> = {
  PLAID_CLIENT_ID: 'made-up-client-id-6f1c2a',
  PLAID_SECRET: 'made-up-plaid-secret-93be7d10',
  BANK_TOKEN_KEY: 'bWFkZS11cC1iYW5rLWtleS1mb3ItdGhlLXRlc3RzISE=',
  VAPID_PRIVATE_KEY: 'made-up-vapid-private-key-0c4d9a77e1',
  R2_ACCESS_KEY_ID: 'MADEUPACCESSKEY4E1F',
  R2_SECRET_ACCESS_KEY: 'made-up-r2-secret-access-key-5b2c81',
  VITE_MADE_UP_SECRET: 'made-up-vite-secret-1d8e40',
};

let out = '';
let files: { readonly name: string; readonly text: string }[] = [];
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'budget-build-scan-'));
  for (const [name, value] of Object.entries(SECRETS)) {
    saved[name] = process.env[name];
    process.env[name] = value;
  }
  try {
    await build({ root: fileURLToPath(new URL('../', import.meta.url)), logLevel: 'error', build: { outDir: out, emptyOutDir: true } });
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  files = readdirSync(out, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { name: path.slice(out.length + 1).split(sep).join('/'), text: readFileSync(path).toString('latin1') };
    });
}, 120_000);

afterAll(() => {
  if (out !== '') rmSync(out, { recursive: true, force: true });
});

describe('Phase 6 the built phone app holds no secret', () => {
  it('Phase 6 the build is the whole app: the page, its scripts and styles, the service worker, the manifest', () => {
    const names = files.map((f) => f.name);
    expect(names).toContain('index.html');
    expect(names).toContain('sw.js');
    expect(names).toContain('manifest.webmanifest');
    expect(names.some((n) => /^assets\/.+\.js$/.test(n))).toBe(true);
  });

  it('Phase 6 none of the server\'s secrets that were in the environment while it was built is in any file', () => {
    for (const { name, text } of files) for (const [setting, value] of Object.entries(SECRETS)) expect(text.includes(value), `${setting} in ${name}`).toBe(false);
  });

  it.runIf(existsSync(new URL('../../../.env', import.meta.url)))('Phase 6 none of the values in this computer\'s .env is in any file (a failure names the setting, never the value)', () => {
    const values = readFileSync(new URL('../../../.env', import.meta.url), 'utf8')
      .split(/\r?\n/)
      .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1] ?? '', (m[2] ?? '').replace(/^(['"])(.*)\1$/, '$2')] as const)
      .filter(([name, value]) => value.length >= 8 && name !== 'PLAID_ENV');
    for (const { name, text } of files) for (const [setting, value] of values) expect(text.includes(value), `the value of ${setting} in ${name}`).toBe(false);
  });

  it('Phase 6 no file names a secret, a key\'s form, or where the server keeps them', () => {
    const patterns: [string, RegExp][] = [
      ['a secret\'s name', /PLAID_SECRET|PLAID_CLIENT_ID|BANK_TOKEN_KEY|VAPID_PRIVATE|R2_SECRET|R2_ACCESS|LITESTREAM_/],
      ['a bank connection\'s key', /\b(?:access|public)-(?:sandbox|development|production)-[A-Za-z0-9-]+/],
      ['a private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
      ['Plaid\'s address', /plaid\.com/i],
      ['the backup\'s address', /cloudflarestorage/i],
      ['the server\'s environment', /process\.env/],
    ];
    for (const { name, text } of files) for (const [what, pattern] of patterns) expect(pattern.test(text), `${what} in ${name}`).toBe(false);
  });
});
