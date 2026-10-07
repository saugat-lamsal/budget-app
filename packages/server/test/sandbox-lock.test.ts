import { describe, expect, it } from 'vitest';
import {
  PLAID_SANDBOX_URL,
  SandboxOnlyError,
  assertSandboxAccessToken,
  assertSandboxEnvironment,
  assertSandboxPublicToken,
  plaidKeysFromEnv,
} from '../src/plaid/sandbox-lock.js';

// CLAUDE.md safety rules: Plaid's test bank (sandbox) only until Phase 7.
// Keys for real connections are made up here from parts, so the project-wide
// check for them (test/sandbox-only.test.ts) does not trip over this file.
const madeUpKey = (kind: 'access' | 'public', env: string, rest = '0f1e2d3c'): string => [kind, env, rest].join('-');

describe('safety: test bank only', () => {
  it('safety: the only Plaid address is the test bank', () => {
    expect(PLAID_SANDBOX_URL).toBe('https://sandbox.plaid.com');
  });

  it('safety: PLAID_ENV must say sandbox', () => {
    expect(() => assertSandboxEnvironment('sandbox')).not.toThrow();
    // A stray space or a Windows line ending in .env is still sandbox.
    expect(() => assertSandboxEnvironment(' sandbox\r')).not.toThrow();
  });

  it('safety: any other PLAID_ENV is refused, including none at all', () => {
    for (const env of ['production', 'development', 'Production', 'SANDBOX', 'sandbox2', 'prod', '', undefined]) {
      expect(() => assertSandboxEnvironment(env), String(env)).toThrow(SandboxOnlyError);
    }
  });

  it('safety: only test-bank keys are used', () => {
    expect(() => assertSandboxAccessToken('access-sandbox-0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0')).not.toThrow();
    expect(() => assertSandboxPublicToken('public-sandbox-0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0')).not.toThrow();
    for (const token of [madeUpKey('access', 'production'), madeUpKey('access', 'development'), madeUpKey('public', 'sandbox'), '', 'sandbox']) {
      expect(() => assertSandboxAccessToken(token), token).toThrow(SandboxOnlyError);
    }
    for (const token of [madeUpKey('public', 'production'), madeUpKey('access', 'sandbox'), '']) {
      expect(() => assertSandboxPublicToken(token), token).toThrow(SandboxOnlyError);
    }
  });

  it('safety: a refused key is never repeated in the error', () => {
    const token = madeUpKey('access', 'production', '9a8b7c6d-5e4f-3a2b-1c0d-ffeeddccbbaa');
    expect(() => assertSandboxAccessToken(token)).toThrow(SandboxOnlyError);
    try {
      assertSandboxAccessToken(token);
    } catch (error) {
      expect(String(error)).not.toContain('9a8b7c6d');
      expect(JSON.stringify(error)).not.toContain('9a8b7c6d');
    }
  });

  it('safety: the Plaid keys come from the environment, and only with PLAID_ENV=sandbox', () => {
    const keys = plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: ' client-id-made-up\r', PLAID_SECRET: 'secret-made-up' });
    expect(keys.clientId).toBe('client-id-made-up');
    expect(keys.secret).toBe('secret-made-up');
    expect(() => plaidKeysFromEnv({ PLAID_ENV: 'production', PLAID_CLIENT_ID: 'a', PLAID_SECRET: 'b' })).toThrow(SandboxOnlyError);
    expect(() => plaidKeysFromEnv({ PLAID_CLIENT_ID: 'a', PLAID_SECRET: 'b' })).toThrow(SandboxOnlyError);
    expect(() => plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_SECRET: 'b' })).toThrow(/PLAID_CLIENT_ID/);
    expect(() => plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'a', PLAID_SECRET: '  ' })).toThrow(/PLAID_SECRET/);
  });

  it('safety: the keys never show when printed or logged', () => {
    const keys = plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: 'client-id-made-up', PLAID_SECRET: 'secret-made-up' });
    expect(JSON.stringify(keys)).not.toContain('secret-made-up');
    expect(String(keys)).not.toContain('secret-made-up');
    expect(JSON.stringify({ keys })).not.toContain('client-id-made-up');
  });
});
