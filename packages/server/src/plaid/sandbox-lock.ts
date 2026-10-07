// Plaid's test bank (sandbox) only until Phase 7 (CLAUDE.md safety rules).
// The address is fixed here and nowhere else, the environment setting has to
// say sandbox, and keys for any other environment are refused before a
// request is made. test/sandbox-only.test.ts fails if anything in the project
// points elsewhere.
export const PLAID_SANDBOX_URL = 'https://sandbox.plaid.com';

export class SandboxOnlyError extends Error {
  override readonly name = 'SandboxOnlyError';
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

// The Plaid API keys, read from the environment (.env, which git ignores).
// Printing or logging them shows nothing.
export interface PlaidKeys {
  readonly clientId: string;
  readonly secret: string;
}

export function plaidKeysFromEnv(env: Readonly<Record<string, string | undefined>>): PlaidKeys {
  assertSandboxEnvironment(env['PLAID_ENV']);
  const clientId = env['PLAID_CLIENT_ID']?.trim() ?? '';
  const secret = env['PLAID_SECRET']?.trim() ?? '';
  if (clientId === '') throw new Error('PLAID_CLIENT_ID is not set in .env');
  if (secret === '') throw new Error('PLAID_SECRET is not set in .env');
  const keys = {};
  Object.defineProperties(keys, {
    clientId: { value: clientId, enumerable: false },
    secret: { value: secret, enumerable: false },
    toJSON: { value: () => '[Plaid keys]', enumerable: false },
    toString: { value: () => '[Plaid keys]', enumerable: false },
  });
  return keys as PlaidKeys;
}
