import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { TokenBox, newTokenKey, tokenBoxFromEnv } from '../src/crypto/token-box.js';

// CLAUDE.md safety rules: the Plaid access token lives on the server only,
// encrypted. These are made-up keys and a made-up token.
const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 8).toString('base64');
const TOKEN = 'access-sandbox-11111111-2222-4333-8444-555555555555';
const ITEM = 'item-made-up-1';

describe('safety: the bank key is kept encrypted', () => {
  it('safety: what is sealed opens again to the same key', () => {
    const box = new TokenBox(KEY);
    expect(box.open(box.seal(TOKEN, ITEM), ITEM)).toBe(TOKEN);
  });

  it('safety: the sealed text does not contain the key or any part of it', () => {
    const sealed = new TokenBox(KEY).seal(TOKEN, ITEM);
    expect(sealed).not.toContain(TOKEN);
    for (const part of TOKEN.split('-')) expect(sealed).not.toContain(part);
    expect(sealed).not.toContain(Buffer.from(TOKEN).toString('base64'));
    expect(sealed.startsWith('v1.')).toBe(true);
  });

  it('safety: sealing the same key twice gives different text', () => {
    const box = new TokenBox(KEY);
    expect(box.seal(TOKEN, ITEM)).not.toBe(box.seal(TOKEN, ITEM));
  });

  it('safety: it only opens for the connection it was sealed for', () => {
    const box = new TokenBox(KEY);
    expect(() => box.open(box.seal(TOKEN, ITEM), 'item-made-up-2')).toThrow(/cannot be opened/);
  });

  it('safety: it only opens with the same encryption key', () => {
    const sealed = new TokenBox(KEY).seal(TOKEN, ITEM);
    expect(() => new TokenBox(OTHER_KEY).open(sealed, ITEM)).toThrow(/cannot be opened/);
  });

  it('safety: any change to the sealed text is caught', () => {
    const box = new TokenBox(KEY);
    const sealed = box.seal(TOKEN, ITEM);
    const parts = sealed.split('.');
    for (let i = 1; i < parts.length; i += 1) {
      const part = parts[i] ?? '';
      const flipped = (part[0] === 'A' ? 'B' : 'A') + part.slice(1);
      const changed = [...parts.slice(0, i), flipped, ...parts.slice(i + 1)].join('.');
      expect(() => box.open(changed, ITEM), `part ${i}`).toThrow(/cannot be opened/);
    }
    expect(() => box.open(sealed.replace('v1.', 'v2.'), ITEM)).toThrow(/cannot be opened/);
    expect(() => box.open('', ITEM)).toThrow(/cannot be opened/);
    expect(() => box.open(sealed.slice(0, -4), ITEM)).toThrow(/cannot be opened/);
  });

  it('safety: the encryption key must be 32 random bytes, written in base64', () => {
    for (const bad of ['', 'short', Buffer.alloc(16, 1).toString('base64'), Buffer.alloc(33, 1).toString('base64'), `${KEY}!`]) {
      expect(() => new TokenBox(bad), bad).toThrow(/BANK_TOKEN_KEY/);
    }
    expect(() => tokenBoxFromEnv({})).toThrow(/BANK_TOKEN_KEY/);
    expect(tokenBoxFromEnv({ BANK_TOKEN_KEY: ` ${KEY}\r` }).open(new TokenBox(KEY).seal(TOKEN, ITEM), ITEM)).toBe(TOKEN);
  });

  it('safety: a new encryption key is 32 random bytes', () => {
    const a = newTokenKey();
    const b = newTokenKey();
    expect(Buffer.from(a, 'base64')).toHaveLength(32);
    expect(a).not.toBe(b);
    expect(() => new TokenBox(a)).not.toThrow();
  });

  it('safety: the box never shows its encryption key', () => {
    const box = new TokenBox(KEY);
    for (const shown of [JSON.stringify(box), String(box), inspect(box, { showHidden: true, depth: 5 }), JSON.stringify({ box })]) {
      expect(shown).not.toContain(KEY);
      expect(shown).not.toContain(Buffer.alloc(32, 7).toString('hex'));
    }
  });
});
