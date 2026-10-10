import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Auth, LOGIN_COOKIE, type LoginResult } from '../src/auth/auth.js';
import { readPasskeys, saveStayLoggedInDays } from '../src/auth/auth-db.js';
import { openDatabase, type Db } from '../src/db/database.js';
import { serverLinesIn } from '../src/server-log.js';
import { SoftPasskey } from './soft-passkey.js';

// Passkey login (Step 2): the real server lets nobody in without a passkey.
// The first passkey is made with a one-time code printed by npm run serve,
// good once and for 15 minutes. He stays logged in on a device for 30 days
// (a setting, section 2). Logins, new passkeys and log outs are in the change
// log (13.5). The passkey checks are SimpleWebAuthn's; the passkey here is
// made in software (soft-passkey.ts). Every name and number is made up.

const ORIGIN = 'http://localhost:5190';
const START = new Date('2026-10-10T16:00:00Z');
const DEVICE = 'Chrome on Windows';

interface World {
  readonly db: Db;
  readonly auth: Auth;
  now: Date;
  readonly dir: string;
}

const worlds: World[] = [];
afterEach(() => {
  for (const w of worlds.splice(0)) {
    w.db.close();
    rmSync(w.dir, { recursive: true, force: true });
  }
});

function world(): World {
  const dir = mkdtempSync(join(tmpdir(), 'budget-auth-'));
  const db = openDatabase(join(dir, 'books.sqlite'));
  const w: World = { db, dir, now: START, auth: undefined as unknown as Auth };
  (w as { auth: Auth }).auth = new Auth({ db, now: () => w.now, origin: ORIGIN, today: () => w.now.toISOString().slice(0, 10), bookLines: () => 0 });
  worlds.push(w);
  return w;
}

const minutes = (w: World, n: number): void => {
  w.now = new Date(w.now.getTime() + n * 60_000);
};

// The cookie the browser keeps from a Set-Cookie answer.
function cookieOf(result: LoginResult): string {
  if (!result.ok) throw new Error(`refused: ${result.why}`);
  const value = new RegExp(`^${LOGIN_COOKIE}=([^;]+)`).exec(result.setCookie)?.[1];
  if (value === undefined) throw new Error(`no login in ${result.setCookie}`);
  return `${LOGIN_COOKIE}=${value}`;
}

// The first passkey, made with a code, as the login page does it.
async function firstPasskey(w: World, key = new SoftPasskey()): Promise<{ readonly key: SoftPasskey; readonly cookie: string }> {
  const code = w.auth.newCode();
  const asked = await w.auth.codeOptions(code);
  if (!asked.ok) throw new Error(asked.why);
  return { key, cookie: cookieOf(await w.auth.codePasskey(code, key.register(asked.options, ORIGIN), DEVICE)) };
}

async function logIn(w: World, key: SoftPasskey, change?: Parameters<SoftPasskey['answer']>[2]): Promise<LoginResult> {
  const options = await w.auth.loginOptions();
  return w.auth.login(key.answer(options, ORIGIN, change), 'Safari on iPhone');
}

describe('login: the one-time code and the first passkey', () => {
  it('login a new database has no passkey; the code makes the first one, logs him in, and is in the change log', async () => {
    const w = world();
    expect(w.auth.hasPasskeys()).toBe(false);
    const { cookie } = await firstPasskey(w);
    expect(w.auth.hasPasskeys()).toBe(true);
    expect(readPasskeys(w.db)).toMatchObject([{ device: DEVICE }]);
    expect(w.auth.session(cookie)).toMatchObject({ device: DEVICE });
    expect(serverLinesIn(w.db).map((l) => l.action)).toEqual(['passkey-added', 'logged-in']);
  });

  it('login the code looks like 1234-5678-9012, and each new one is different', () => {
    const w = world();
    const codes = Array.from({ length: 20 }, () => w.auth.newCode());
    for (const code of codes) expect(code).toMatch(/^\d{4}-\d{4}-\d{4}$/);
    expect(new Set(codes).size).toBe(20);
  });

  it("login the code can be typed without its dashes or with spaces (the phone's digit pad has no dash); anything else is not a code", async () => {
    for (const typed of [(c: string) => c.replaceAll('-', ''), (c: string) => c.replaceAll('-', ' '), (c: string) => ` ${c} `]) {
      const w = world();
      expect((await w.auth.codeOptions(typed(w.auth.newCode()))).ok).toBe(true);
    }
    const w = world();
    const code = w.auth.newCode();
    for (const wrong of [`${code}0`, code.slice(1), code.replaceAll('-', '.'), 123456789012, null, undefined, { code }]) expect((await w.auth.codeOptions(wrong)).ok, String(wrong)).toBe(false);
  });

  it('login a code is good once: used, it is refused', async () => {
    const w = world();
    const code = w.auth.newCode();
    const asked = await w.auth.codeOptions(code);
    if (!asked.ok) throw new Error(asked.why);
    cookieOf(await w.auth.codePasskey(code, new SoftPasskey().register(asked.options, ORIGIN), DEVICE));
    expect(await w.auth.codeOptions(code)).toEqual({ ok: false, why: 'That code is not right, or it was used, or it is more than 15 minutes old. Nothing was changed.' });
    expect(readPasskeys(w.db)).toHaveLength(1);
  });

  it('login a code is good for 15 minutes: at 14 minutes 59 it works, at exactly 15 it is refused', async () => {
    const w = world();
    const code = w.auth.newCode();
    minutes(w, 14.99);
    expect((await w.auth.codeOptions(code)).ok).toBe(true);
    minutes(w, 0.01);
    expect((await w.auth.codeOptions(code)).ok).toBe(false);
  });

  it('login a code asked for in time but used after 15 minutes is refused, and no passkey is kept', async () => {
    const w = world();
    const code = w.auth.newCode();
    const asked = await w.auth.codeOptions(code);
    if (!asked.ok) throw new Error(asked.why);
    minutes(w, 15);
    expect((await w.auth.codePasskey(code, new SoftPasskey().register(asked.options, ORIGIN), DEVICE)).ok).toBe(false);
    expect(readPasskeys(w.db)).toEqual([]);
  });

  it('login only the newest code is good', async () => {
    const w = world();
    const first = w.auth.newCode();
    const second = w.auth.newCode();
    expect((await w.auth.codeOptions(first)).ok).toBe(false);
    expect((await w.auth.codeOptions(second)).ok).toBe(true);
  });

  it('login after 10 wrong codes, the good one stops working too', async () => {
    const w = world();
    const code = w.auth.newCode();
    for (let i = 0; i < 10; i += 1) expect((await w.auth.codeOptions(`0000-0000-000${i}`)).ok).toBe(false);
    expect((await w.auth.codeOptions(code)).ok).toBe(false);
    expect((await w.auth.codeOptions(w.auth.newCode())).ok).toBe(true);
  });

  it('login a passkey made for another address, or not checked with Face ID, or answering another question, is refused', async () => {
    for (const change of [{ rpId: 'example.com' }, { userVerified: false }, { type: 'webauthn.get' }]) {
      const w = world();
      const code = w.auth.newCode();
      const asked = await w.auth.codeOptions(code);
      if (!asked.ok) throw new Error(asked.why);
      const result = await w.auth.codePasskey(code, new SoftPasskey().register(asked.options, ORIGIN, change), DEVICE);
      expect(result.ok, JSON.stringify(change)).toBe(false);
      expect(readPasskeys(w.db), JSON.stringify(change)).toEqual([]);
    }
    // From another web address.
    const w = world();
    const code = w.auth.newCode();
    const asked = await w.auth.codeOptions(code);
    if (!asked.ok) throw new Error(asked.why);
    expect((await w.auth.codePasskey(code, new SoftPasskey().register(asked.options, 'http://localhost:9999', { rpId: 'localhost' }), DEVICE)).ok).toBe(false);
  });
});

describe('login: logging in with a passkey', () => {
  it('login his passkey logs him in on a new device; the login is in the change log', async () => {
    const w = world();
    const { key } = await firstPasskey(w);
    const cookie = cookieOf(await logIn(w, key));
    expect(w.auth.session(cookie)).toMatchObject({ device: 'Safari on iPhone' });
    expect(serverLinesIn(w.db).map((l) => [l.action, 'device' in l ? l.device : ''])).toEqual([
      ['passkey-added', DEVICE],
      ['logged-in', DEVICE],
      ['logged-in', 'Safari on iPhone'],
    ]);
  });

  it('login a passkey it does not know is refused, and nobody is logged in', async () => {
    const w = world();
    await firstPasskey(w);
    expect(await logIn(w, new SoftPasskey())).toEqual({ ok: false, why: "That passkey isn't one of yours here. Nothing was changed." });
  });

  it('login a challenge is answered once: the same answer sent again is refused', async () => {
    const w = world();
    const { key } = await firstPasskey(w);
    const options = await w.auth.loginOptions();
    const answer = key.answer(options, ORIGIN);
    expect((await w.auth.login(answer, DEVICE)).ok).toBe(true);
    expect((await w.auth.login(answer, DEVICE)).ok).toBe(false);
  });

  it('login a copied passkey shows itself: its count going backwards is refused', async () => {
    const w = world();
    const { key } = await firstPasskey(w);
    cookieOf(await logIn(w, key, { count: 50 }));
    expect((await logIn(w, key, { count: 49 })).ok).toBe(false);
  });
});

describe('login: staying logged in, and logging out', () => {
  it('login he stays logged in for 30 days on a device: at 29 days 23 hours 59 minutes still, at exactly 30 days no more', async () => {
    const w = world();
    const { cookie } = await firstPasskey(w);
    minutes(w, 30 * 24 * 60 - 1);
    expect(w.auth.session(cookie)).not.toBeNull();
    minutes(w, 1);
    expect(w.auth.session(cookie)).toBeNull();
  });

  it('login how long is a setting: changed, it applies right away to every device, and the change is logged', async () => {
    const w = world();
    const { cookie } = await firstPasskey(w);
    minutes(w, 8 * 24 * 60);
    const session = w.auth.session(cookie);
    if (session === null) throw new Error('not logged in');
    expect(w.auth.changeStayLoggedIn(session, 7)).toEqual({ ok: true });
    expect(w.auth.session(cookie)).toBeNull();
    expect(serverLinesIn(w.db).at(-1)).toMatchObject({ action: 'stay-logged-in-changed', before: 30, after: 7 });
  });

  it('login the setting takes a whole number of days from 1 to 365', async () => {
    const w = world();
    const { cookie } = await firstPasskey(w);
    const session = w.auth.session(cookie)!;
    for (const days of [0, -1, 366, 1.5, Number.NaN]) expect(w.auth.changeStayLoggedIn(session, days).ok, String(days)).toBe(false);
    for (const days of [1, 365]) expect(w.auth.changeStayLoggedIn(session, days)).toEqual({ ok: true });
    expect(w.auth.changeStayLoggedIn(session, 365)).toEqual({ ok: false, why: 'That is already the setting. Nothing was changed.' });
  });

  it('login the login cookie is HttpOnly and SameSite=Strict, for the whole app, for as long as he stays logged in', async () => {
    const w = world();
    saveStayLoggedInDays(w.db, 30);
    const code = w.auth.newCode();
    const asked = await w.auth.codeOptions(code);
    if (!asked.ok) throw new Error(asked.why);
    const result = await w.auth.codePasskey(code, new SoftPasskey().register(asked.options, ORIGIN), DEVICE);
    if (!result.ok) throw new Error(result.why);
    const parts = result.setCookie.split('; ');
    expect(parts.slice(1).sort()).toEqual(['HttpOnly', `Max-Age=${30 * 24 * 60 * 60}`, 'Path=/', 'SameSite=Strict']);
  });

  it('login log out ends the login on that device only, and is in the change log', async () => {
    const w = world();
    const { key, cookie } = await firstPasskey(w);
    const phone = cookieOf(await logIn(w, key));
    const cleared = w.auth.logout(w.auth.session(cookie)!);
    expect(cleared.setCookie).toBe(`${LOGIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    expect(w.auth.session(cookie)).toBeNull();
    expect(w.auth.session(phone)).not.toBeNull();
    expect(serverLinesIn(w.db).at(-1)).toMatchObject({ action: 'logged-out', device: DEVICE });
  });

  it('login a login from another database is refused there', async () => {
    const a = world();
    const b = world();
    const { cookie } = await firstPasskey(a);
    await firstPasskey(b);
    expect(a.auth.session(cookie)).not.toBeNull();
    expect(b.auth.session(cookie)).toBeNull();
  });

  it('login a made-up or garbled cookie is refused', () => {
    const w = world();
    for (const cookie of [undefined, '', `${LOGIN_COOKIE}=`, `${LOGIN_COOKIE}=abc`, 'other=1', `${LOGIN_COOKIE}=${'x'.repeat(5000)}`]) expect(w.auth.session(cookie), String(cookie)).toBeNull();
  });
});

describe('login: another passkey, later', () => {
  it('login adding another passkey needs him logged in and asks first; then the new one logs in too, and it is logged', async () => {
    const w = world();
    const { cookie } = await firstPasskey(w);
    const session = w.auth.session(cookie)!;
    expect(await w.auth.passkeyOptions(session, false)).toMatchObject({ ok: false, code: 'needs-confirmation' });
    const asked = await w.auth.passkeyOptions(session, true);
    if (!asked.ok) throw new Error(asked.why);
    const phone = new SoftPasskey();
    expect(await w.auth.addPasskey(session, phone.register(asked.options, ORIGIN), 'Safari on iPhone')).toEqual({ ok: true });
    expect(readPasskeys(w.db).map((p) => p.device)).toEqual([DEVICE, 'Safari on iPhone']);
    expect((await logIn(w, phone)).ok).toBe(true);
    expect(serverLinesIn(w.db).map((l) => l.action)).toEqual(['passkey-added', 'logged-in', 'passkey-added', 'logged-in']);
  });

  it('login the same passkey cannot be added twice', async () => {
    const w = world();
    const { key, cookie } = await firstPasskey(w);
    const session = w.auth.session(cookie)!;
    const asked = await w.auth.passkeyOptions(session, true);
    if (!asked.ok) throw new Error(asked.why);
    expect((await w.auth.addPasskey(session, key.register(asked.options, ORIGIN), DEVICE)).ok).toBe(false);
    expect(readPasskeys(w.db)).toHaveLength(1);
  });
});
