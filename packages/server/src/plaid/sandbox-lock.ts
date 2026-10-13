// Plaid's test bank (sandbox) until Phase 7 (CLAUDE.md safety rules), and the
// production switch for Phase 7 (his OK, Oct 12, 2026). Both addresses are
// fixed here and nowhere else. The real bank is used only when PLAID_ENV says
// production on the hosted server (APP_ORIGIN https), and never under the
// tests, in a break-it run, or where PLAID_LOCK=sandbox: the lock can only be
// made tighter. The client asks the lock again right before every request.
// test/sandbox-only.test.ts fails if anything else names the real address,
// or sets PLAID_ENV to it.

export type PlaidEnvironment = 'sandbox' | 'production';

export const PLAID_URLS: Readonly<Record<PlaidEnvironment, string>> = Object.freeze({
  sandbox: 'https://sandbox.plaid.com',
  production: 'https://production.plaid.com',
});

export const PLAID_SANDBOX_URL = PLAID_URLS.sandbox;

export class SandboxOnlyError extends Error {
  override readonly name = 'SandboxOnlyError';
}

// 'sandbox-only' under the tests (VITEST), in a break-it run (BREAK_IT_RUN), or
// with PLAID_LOCK=sandbox, in the environment passed or the process's own:
// a test cannot loosen it by handing over an environment of its own.
export type PlaidLock = 'sandbox-only' | 'hosted';

export function plaidLock(env: Readonly<Record<string, string | undefined>> = {}, own: Readonly<Record<string, string | undefined>> = process.env): PlaidLock {
  const tight = (e: Readonly<Record<string, string | undefined>>): boolean => e['VITEST'] !== undefined || e['BREAK_IT_RUN'] !== undefined || e['PLAID_LOCK']?.trim() === 'sandbox';
  return tight(env) || tight(own) ? 'sandbox-only' : 'hosted';
}

// Which of Plaid's banks the app may use, from PLAID_ENV.
export function plaidEnvironment(env: Readonly<Record<string, string | undefined>>, lock: PlaidLock = plaidLock(env)): PlaidEnvironment {
  const said = env['PLAID_ENV']?.trim();
  if (said === 'sandbox') return 'sandbox';
  if (said === 'production') {
    if (lock !== 'hosted') throw new SandboxOnlyError('Plaid\'s real bank is never reached under the tests, in a break-it run, or with PLAID_LOCK=sandbox');
    if (!(env['APP_ORIGIN']?.trim() ?? '').startsWith('https://')) throw new SandboxOnlyError('PLAID_ENV "production" only on the hosted server (APP_ORIGIN https)');
    return 'production';
  }
  throw new SandboxOnlyError(`PLAID_ENV must be "sandbox", or "production" on the hosted server (got ${said === undefined ? 'nothing' : JSON.stringify(said)})`);
}

export function assertSandboxEnvironment(env: string | undefined): void {
  if (env?.trim() !== 'sandbox') {
    throw new SandboxOnlyError(`PLAID_ENV must be "sandbox": test bank only until Phase 7 (got ${env === undefined ? 'nothing' : JSON.stringify(env)})`);
  }
}

// The keys say which environment they belong to. Neither message repeats the
// key it refused.
export function assertSandboxAccessToken(token: string): void {
  if (!token.startsWith('access-sandbox-')) throw new SandboxOnlyError('that bank key is not a test-bank key');
}

export function assertSandboxPublicToken(token: string): void {
  if (!token.startsWith('public-sandbox-')) throw new SandboxOnlyError('that link key is not a test-bank key');
}

// Which bank a key is for, from its first part; anything else is refused.
export function tokenEnvironment(token: string, kind: 'access' | 'public'): PlaidEnvironment {
  for (const environment of ['sandbox', 'production'] as const) if (token.startsWith(`${kind}-${environment}-`) && token.length > `${kind}-${environment}-`.length) return environment;
  throw new SandboxOnlyError(kind === 'access' ? 'that bank key is not a key for the test bank or the real one' : 'that link key is not a key for the test bank or the real one');
}

// The Plaid API keys, read from the environment (.env, which git ignores, or
// Fly's secrets), and which bank they are for. Printing or logging them shows nothing.
export interface PlaidKeys {
  readonly clientId: string;
  readonly secret: string;
  readonly environment: PlaidEnvironment;
}

export function plaidKeysFromEnv(env: Readonly<Record<string, string | undefined>>, lock: PlaidLock = plaidLock(env)): PlaidKeys {
  const environment = plaidEnvironment(env, lock);
  const clientId = env['PLAID_CLIENT_ID']?.trim() ?? '';
  const secret = env['PLAID_SECRET']?.trim() ?? '';
  if (clientId === '') throw new Error('PLAID_CLIENT_ID is not set in .env');
  if (secret === '') throw new Error('PLAID_SECRET is not set in .env');
  const keys = {};
  Object.defineProperties(keys, {
    clientId: { value: clientId, enumerable: false },
    secret: { value: secret, enumerable: false },
    environment: { value: environment, enumerable: false },
    toJSON: { value: () => '[Plaid keys]', enumerable: false },
    toString: { value: () => '[Plaid keys]', enumerable: false },
  });
  return keys as PlaidKeys;
}
