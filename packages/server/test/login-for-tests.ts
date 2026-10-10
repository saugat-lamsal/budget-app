import { newSecret, saveSession } from '../src/auth/auth-db.js';
import type { Db } from '../src/db/database.js';

// The tests' way in, and theirs only (Step 2): a login written straight into
// a test's own database, as if he had logged in with a passkey at `now`. The
// server has no such way: it reads logins from its database and makes them
// only after a passkey checks out (login-guard.test.ts checks that nothing in
// the server loads this file, and that only the passkey code saves a login).
// Returns the Cookie header a browser would send.
export function loginForTests(db: Db, now: Date, device = 'A test browser'): string {
  const token = newSecret();
  saveSession(db, token, { device, passkeyId: 'test-passkey', createdAt: now.toISOString() });
  return `budget-login=${token}`;
}

// The same login as a cookie for a Playwright browser context.
export function loginCookieForTests(db: Db, now: Date, url: string): { name: string; value: string; url: string; httpOnly: boolean; sameSite: 'Strict' } {
  const value = loginForTests(db, now).slice('budget-login='.length);
  return { name: 'budget-login', value, url, httpOnly: true, sameSite: 'Strict' };
}
