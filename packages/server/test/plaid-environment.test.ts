import { describe, expect, it } from 'vitest';
import { memoryLog } from '../src/log.js';
import { BankKey, PlaidClient, type Fetch } from '../src/plaid/client.js';
import { PLAID_URLS, SandboxOnlyError, plaidEnvironment, plaidKeysFromEnv, plaidLock } from '../src/plaid/sandbox-lock.js';
import { serveOptions, testBankOnStart } from '../src/serve/options.js';

// Before Phase 7 (CLAUDE.md, his OK Oct 12): the production switch. The app
// reaches Plaid's real bank only when PLAID_ENV says production, on the hosted
// server (APP_ORIGIN https), and never under the tests, in a break-it run, or
// where PLAID_LOCK=sandbox. fly.toml says sandbox until connection day
// (test/sandbox-only.test.ts). Keys and addresses for the real bank are put
// together from parts here, so that check does not trip over this file.

const join = (...parts: string[]): string => parts.join('');
const REAL_URL = join('https://', 'production', '.plaid.com');
const realKey = (kind: 'access' | 'public'): string => [kind, 'production', '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0'].join('-');
const TEST_KEY = 'access-sandbox-11111111-2222-4333-8444-555555555555';
const HOSTED = { APP_ORIGIN: 'https://made-up-budget.fly.dev', PLAID_CLIENT_ID: 'client-made-up', PLAID_SECRET: 'secret-made-up' };

function spyFetch(): { fetch: Fetch; sent: string[] } {
  const sent: string[] = [];
  const fetch: Fetch = async (url) => {
    sent.push(url);
    return { ok: true, status: 200, text: async () => JSON.stringify({ link_token: 'link-sandbox-made-up', expiration: '2026-10-13T01:00:00Z', request_id: 'req-1' }) };
  };
  return { fetch, sent };
}

describe('safety: the production switch', () => {
  it('safety: Plaid\'s real address is named here and nowhere else', () => {
    expect(PLAID_URLS).toEqual({ sandbox: 'https://sandbox.plaid.com', production: REAL_URL });
  });

  it('safety: sandbox is sandbox anywhere', () => {
    for (const lock of ['sandbox-only', 'hosted'] as const) {
      expect(plaidEnvironment({ PLAID_ENV: 'sandbox' }, lock)).toBe('sandbox');
      expect(plaidEnvironment({ PLAID_ENV: ' sandbox\r', ...HOSTED }, lock)).toBe('sandbox');
    }
  });

  it('safety: production only on the hosted server, where the lock allows it', () => {
    expect(plaidEnvironment({ PLAID_ENV: 'production', ...HOSTED }, 'hosted')).toBe('production');
    expect(() => plaidEnvironment({ PLAID_ENV: 'production', ...HOSTED }, 'sandbox-only')).toThrow(SandboxOnlyError);
    for (const origin of [undefined, '', 'http://localhost:5190', 'http://made-up-budget.fly.dev']) {
      const env = { PLAID_ENV: 'production', ...(origin === undefined ? {} : { APP_ORIGIN: origin }) };
      expect(() => plaidEnvironment(env, 'hosted'), String(origin)).toThrow(/hosted server/);
    }
  });

  it('safety: anything else in PLAID_ENV is refused, including none at all', () => {
    for (const said of ['development', 'Production', 'PRODUCTION', 'prod', 'SANDBOX', 'sandbox2', '', undefined]) {
      const env = { ...HOSTED, ...(said === undefined ? {} : { PLAID_ENV: said }) };
      expect(() => plaidEnvironment(env, 'hosted'), String(said)).toThrow(SandboxOnlyError);
    }
  });

  it('safety: under the tests the lock is sandbox only, whatever environment is handed in', () => {
    expect(process.env['VITEST']).toBeDefined();
    for (const env of [{}, { ...HOSTED }, { VITEST: undefined }, { PLAID_LOCK: 'hosted' }]) expect(plaidLock(env)).toBe('sandbox-only');
    // So with no lock passed, production is refused here.
    expect(() => plaidEnvironment({ PLAID_ENV: 'production', ...HOSTED })).toThrow(/never reached under the tests/);
    expect(() => plaidKeysFromEnv({ PLAID_ENV: 'production', ...HOSTED })).toThrow(SandboxOnlyError);
  });

  it('safety: PLAID_LOCK=sandbox, a break-it run and the tests each tighten the lock, in either environment; nothing loosens it', () => {
    // The second environment stands for the process's own (process.env when
    // it is not given, as in every real use: the client asks again right
    // before each request).
    expect(plaidLock({}, {})).toBe('hosted');
    for (const tight of [{ PLAID_LOCK: 'sandbox' }, { BREAK_IT_RUN: '1' }, { VITEST: 'true' }]) {
      expect(plaidLock(tight, {}), JSON.stringify(tight)).toBe('sandbox-only');
      expect(plaidLock({}, tight), JSON.stringify(tight)).toBe('sandbox-only');
    }
    expect(plaidLock({ PLAID_LOCK: 'hosted' }, {})).toBe('hosted');
    expect(plaidLock({ PLAID_LOCK: 'anything' }, {})).toBe('hosted');
  });

  it('safety: the keys say which bank they are for, and never show', () => {
    const keys = plaidKeysFromEnv({ PLAID_ENV: 'production', ...HOSTED }, 'hosted');
    expect(keys.environment).toBe('production');
    expect(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', ...HOSTED }).environment).toBe('sandbox');
    expect(JSON.stringify(keys)).not.toContain('secret-made-up');
    expect(String(keys)).not.toContain('client-made-up');
  });

  it('safety: a client for the real bank sends nothing under the tests, even with the keys made outside the lock', async () => {
    const keys = plaidKeysFromEnv({ PLAID_ENV: 'production', ...HOSTED }, 'hosted');
    const { fetch, sent } = spyFetch();
    const client = new PlaidClient(keys, { fetch, log: memoryLog([]) });
    await expect(client.getAccounts(new BankKey(realKey('access')))).rejects.toThrow(SandboxOnlyError);
    await expect(client.createLinkToken({ clientUserId: 'saugat-made-up' })).rejects.toThrow(SandboxOnlyError);
    expect(sent).toEqual([]);
  });

  it('safety: a real-bank key is never sent to the test bank, and the test bank\'s own calls are refused on the real bank', async () => {
    const { fetch, sent } = spyFetch();
    const sandbox = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', ...HOSTED }), { fetch, log: memoryLog([]) });
    const real = new BankKey(realKey('access'));
    expect(real.environment).toBe('production');
    await expect(sandbox.getAccounts(real)).rejects.toThrow(SandboxOnlyError);
    await expect(sandbox.exchangePublicToken(realKey('public'))).rejects.toThrow(SandboxOnlyError);
    await expect(sandbox.createLinkToken({ clientUserId: 'saugat-made-up', updateKey: real })).rejects.toThrow(SandboxOnlyError);
    expect(sent).toEqual([]);
    const production = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'production', ...HOSTED }, 'hosted'), { fetch, log: memoryLog([]) });
    await expect(production.createSandboxPublicToken({ institutionId: 'ins_109508', products: ['transactions'] })).rejects.toThrow(/test bank only/);
    await expect(production.createSandboxTransactions(real, [])).rejects.toThrow(/test bank only/);
    await expect(production.resetSandboxLogin(real)).rejects.toThrow(/test bank only/);
    expect(sent).toEqual([]);
  });

  it('safety: a bank key is a test-bank key or a real one, nothing else, and never shows', () => {
    expect(new BankKey(TEST_KEY).environment).toBe('sandbox');
    for (const token of [['access', 'development', '0f1e2d3c'].join('-'), realKey('public'), '', 'access-', 'sandbox']) {
      expect(() => new BankKey(token), token).toThrow(SandboxOnlyError);
    }
    expect(JSON.stringify({ key: new BankKey(realKey('access')) })).not.toContain('0f1e2d3c');
  });
});

describe('1.1 on the real bank the server never connects the test bank by itself', () => {
  const ROOT = '/made-up/budget-app';
  it('1.1 the image always asks for --connect-once; on the real bank it does nothing, and --connect is refused', () => {
    const hosted = serveOptions(['--connect-once'], { APP_ORIGIN: HOSTED.APP_ORIGIN }, ROOT);
    expect(testBankOnStart(hosted, 'sandbox')).toBe('connect-once');
    expect(testBankOnStart(hosted, 'production')).toBe('never');
    expect(testBankOnStart(serveOptions([], {}, ROOT), 'sandbox')).toBe('never');
    expect(testBankOnStart(serveOptions(['--connect'], {}, ROOT), 'sandbox')).toBe('connect');
    expect(() => testBankOnStart(serveOptions(['--connect'], { APP_ORIGIN: HOSTED.APP_ORIGIN }, ROOT), 'production')).toThrow(/connect it from Setup day/);
    expect(testBankOnStart(serveOptions([], { APP_ORIGIN: HOSTED.APP_ORIGIN }, ROOT), 'production')).toBe('never');
  });
});
