import { describe, expect, it } from 'vitest';
import { hideSecrets, memoryLog, type LogLine } from '../src/log.js';

// CLAUDE.md safety rules: the access token never appears in logs. Nothing
// secret should: not the bank keys of any Plaid environment, not the API
// keys. These are made-up values.
const madeUpKey = (kind: string, env: string): string => [kind, env, '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'].join('-');

describe('safety: logs never show a secret', () => {
  it('safety: bank keys of every Plaid environment are hidden', () => {
    for (const env of ['sandbox', 'development', 'production']) {
      for (const kind of ['access', 'public']) {
        const key = madeUpKey(kind, env);
        const text = hideSecrets(`calling with ${key}, then "${key}"`, []);
        expect(text).not.toContain('0f1e2d3c');
        expect(text).toContain('[hidden]');
      }
    }
  });

  it('safety: the API keys it is told about are hidden wherever they show up', () => {
    const text = hideSecrets('id=client-made-up-123 secret:secret-made-up-456;', ['client-made-up-123', 'secret-made-up-456']);
    expect(text).toBe('id=[hidden] secret:[hidden];');
  });

  it('safety: short or empty values are not used to hide text', () => {
    expect(hideSecrets('a b c', ['', ' ', 'a'])).toBe('a b c');
  });

  it('safety: nothing secret gets into a log line, its fields, or an error in it', () => {
    const lines: LogLine[] = [];
    const log = memoryLog(lines, ['secret-made-up-456']);
    const key = madeUpKey('access', 'sandbox');
    const error = new Error(`failed with ${key} and secret-made-up-456`);
    log.info('sync', { token: key, nested: { list: [key, 'ok'] }, secret: 'secret-made-up-456' });
    log.error('sync failed', { error });
    const all = JSON.stringify(lines);
    expect(all).not.toContain('0f1e2d3c');
    expect(all).not.toContain('secret-made-up-456');
    expect(lines[0]?.fields).toEqual({ token: '[hidden]', nested: { list: ['[hidden]', 'ok'] }, secret: '[hidden]' });
    expect(lines[1]?.fields?.['error']).toMatch(/^Error: failed with \[hidden\] and \[hidden\]/);
  });
});
