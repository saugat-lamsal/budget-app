import { randomInt } from 'node:crypto';
import type { IsoDate } from '@budget-app/money';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { Db } from '../db/database.js';
import { saveServerLine } from '../server-log.js';
import {
  endSession,
  goodCode,
  newSecret,
  readPasskeys,
  readSession,
  saveCode,
  savePasskey,
  savePasskeyCounter,
  saveSession,
  saveStayLoggedInDays,
  stayLoggedInDays,
  useCode,
  userId,
  voidCodes,
} from './auth-db.js';

// Passkey login for the real server (Step 2). Nobody gets in without a
// passkey: not the screens, not the numbers, not his answers.
// - The first passkey is made with a one-time code that npm run serve prints
//   in its own window: good once, for 15 minutes. Lost all his passkeys? npm
//   run login-code prints a new one, on this computer only.
// - Every check of a passkey is done by SimpleWebAuthn, a widely used
//   library that follows the WebAuthn standard; nothing here is our own
//   cryptography.
// - A login is a random secret in an HttpOnly, SameSite=Strict cookie, kept
//   here only as a hash. It lasts the setting's number of days (section 2,
//   30 to start), counted from when he logged in.
// - Logins, new passkeys, log outs and the setting are in the change log (13.5).

export const LOGIN_COOKIE = 'budget-login';
// How long a one-time code is good.
export const CODE_MINUTES = 15;
// After this many wrong codes, no code is good until a new one is made.
export const WRONG_CODES_ALLOWED = 10;
// How long a passkey question (a challenge) can be answered.
const CHALLENGE_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MOST_DAYS = 365;
// The longest login a cookie can carry: 32 bytes in base64url.
const LOGIN_LENGTH = 43;

export interface AuthInput {
  readonly db: Db;
  readonly now: () => Date;
  // The app's own address, as the browser shows it: http://localhost:5190.
  // Passkeys are made for its host name.
  readonly origin: string | (() => string);
  // Today in his home time zone, and how many lines the book's change log
  // has, for the change log (13.5).
  readonly today: () => IsoDate;
  readonly bookLines: () => number;
}

export interface Session {
  readonly token: string;
  readonly device: string;
  readonly createdAt: string;
}

export type Refused = { readonly ok: false; readonly why: string; readonly code?: 'needs-confirmation' };
export type LoginResult = { readonly ok: true; readonly setCookie: string } | Refused;

const NOTHING = 'Nothing was changed.';
const BAD_CODE = `That code is not right, or it was used, or it is more than ${CODE_MINUTES} minutes old. ${NOTHING}`;

type Challenge = { readonly kind: 'login' } | { readonly kind: 'code'; readonly code: string } | { readonly kind: 'passkey'; readonly token: string };

export class Auth {
  readonly #db: Db;
  readonly #now: () => Date;
  readonly #origin: () => string;
  readonly #today: () => IsoDate;
  readonly #bookLines: () => number;
  // Questions asked and not answered yet, each answered once.
  readonly #challenges = new Map<string, { readonly what: Challenge; readonly until: number }>();
  #wrongCodes = 0;

  constructor(input: AuthInput) {
    this.#db = input.db;
    this.#now = input.now;
    const origin = input.origin;
    this.#origin = typeof origin === 'string' ? () => origin : origin;
    this.#today = input.today;
    this.#bookLines = input.bookLines;
  }

  origin(): string {
    return this.#origin();
  }

  #rpId(): string {
    return new URL(this.#origin()).hostname;
  }

  hasPasskeys(): boolean {
    return readPasskeys(this.#db).length > 0;
  }

  // ----- The one-time code -----

  // A new code, three groups of four digits: the only good one, for 15 minutes.
  newCode(): string {
    const code = Array.from({ length: 3 }, () => String(randomInt(0, 10_000)).padStart(4, '0')).join('-');
    const now = this.#now();
    saveCode(this.#db, code, now.toISOString(), new Date(now.getTime() + CODE_MINUTES * 60_000).toISOString());
    this.#wrongCodes = 0;
    return code;
  }

  // The code as typed, with or without its dashes (the phone's digit pad has
  // none), if it is good now. Ten wrong ones in a row and no code is good.
  #goodCode(typed: unknown): string | null {
    const digits = typeof typed === 'string' && typed.length <= 32 ? typed.replace(/[\s-]/g, '') : '';
    const code = /^\d{12}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}` : null;
    if (code !== null && goodCode(this.#db, code, this.#now().toISOString())) {
      this.#wrongCodes = 0;
      return code;
    }
    this.#wrongCodes += 1;
    if (this.#wrongCodes >= WRONG_CODES_ALLOWED) voidCodes(this.#db, this.#now().toISOString());
    return null;
  }

  // With a good code: what the browser needs to make a passkey.
  async codeOptions(typed: unknown): Promise<{ readonly ok: true; readonly options: PublicKeyCredentialCreationOptionsJSON } | Refused> {
    const code = this.#goodCode(typed);
    if (code === null) return { ok: false, why: BAD_CODE };
    return { ok: true, options: await this.#creation({ kind: 'code', code }) };
  }

  // The passkey made with a good code: kept, the code used up, and he is
  // logged in on this device.
  async codePasskey(typed: unknown, response: unknown, device: string): Promise<LoginResult> {
    const code = this.#goodCode(typed);
    if (code === null) return { ok: false, why: BAD_CODE };
    const made = await this.#made(response, (what) => what.kind === 'code' && what.code === code);
    if (!made.ok) return made;
    const now = this.#now().toISOString();
    if (!goodCode(this.#db, code, now)) return { ok: false, why: BAD_CODE };
    const token = newSecret();
    this.#db.transaction(() => {
      savePasskey(this.#db, { ...made.passkey, device, createdAt: now });
      useCode(this.#db, code, now);
      this.#line({ action: 'passkey-added', device });
      this.#startSession(token, device, made.passkey.id, now);
    })();
    return { ok: true, setCookie: this.#cookie(token) };
  }

  // ----- Logging in with a passkey -----

  async loginOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const options = await generateAuthenticationOptions({ rpID: this.#rpId(), userVerification: 'required' });
    this.#ask(options.challenge, { kind: 'login' });
    return options;
  }

  async login(response: unknown, device: string): Promise<LoginResult> {
    const answer = response as AuthenticationResponseJSON;
    const passkey = readPasskeys(this.#db).find((p) => typeof answer === 'object' && answer !== null && p.id === answer.id);
    const challenge = this.#challengeOf(answer, 'clientDataJSON');
    const asked = challenge === null ? undefined : this.#take(challenge);
    if (passkey === undefined) return { ok: false, why: `That passkey isn't one of yours here. ${NOTHING}` };
    if (asked?.kind !== 'login') return { ok: false, why: `That login was not asked for, or was answered already. ${NOTHING}` };
    let verified: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verified = await verifyAuthenticationResponse({
        response: answer,
        expectedChallenge: challenge ?? '',
        expectedOrigin: this.#origin(),
        expectedRPID: this.#rpId(),
        credential: { id: passkey.id, publicKey: passkey.publicKey, counter: passkey.counter, transports: [...passkey.transports] },
        requireUserVerification: true,
      });
    } catch {
      return { ok: false, why: `That passkey could not be checked. ${NOTHING}` };
    }
    if (!verified.verified) return { ok: false, why: `That passkey could not be checked. ${NOTHING}` };
    const token = newSecret();
    const now = this.#now().toISOString();
    this.#db.transaction(() => {
      savePasskeyCounter(this.#db, passkey.id, verified.authenticationInfo.newCounter);
      this.#startSession(token, device, passkey.id, now);
    })();
    return { ok: true, setCookie: this.#cookie(token) };
  }

  // ----- Who is asking -----

  // The login in a Cookie header, if it is good now: made here, and not
  // older than the setting's number of days.
  session(cookieHeader: string | undefined): Session | null {
    const token = tokenIn(cookieHeader);
    if (token === null) return null;
    const stored = readSession(this.#db, token);
    if (stored === null) return null;
    const until = Date.parse(stored.createdAt) + stayLoggedInDays(this.#db) * DAY_MS;
    if (!(this.#now().getTime() < until)) return null;
    return { token, device: stored.device, createdAt: stored.createdAt };
  }

  logout(session: Session): { readonly setCookie: string } {
    this.#db.transaction(() => {
      endSession(this.#db, session.token);
      this.#line({ action: 'logged-out', device: session.device });
    })();
    return { setCookie: `${LOGIN_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${this.#secure()}` };
  }

  // ----- Another passkey, logged in -----

  // It asks first (confirmed false gives the question).
  async passkeyOptions(session: Session, confirmed: boolean): Promise<{ readonly ok: true; readonly options: PublicKeyCredentialCreationOptionsJSON } | Refused> {
    if (!confirmed) return { ok: false, code: 'needs-confirmation', why: 'Add a passkey on this device? Anyone with it can open your budget.' };
    return { ok: true, options: await this.#creation({ kind: 'passkey', token: session.token }) };
  }

  async addPasskey(session: Session, response: unknown, device: string): Promise<{ readonly ok: true } | Refused> {
    const made = await this.#made(response, (what) => what.kind === 'passkey' && what.token === session.token);
    if (!made.ok) return made;
    if (readPasskeys(this.#db).some((p) => p.id === made.passkey.id)) return { ok: false, why: `That passkey is already one of yours. ${NOTHING}` };
    this.#db.transaction(() => {
      savePasskey(this.#db, { ...made.passkey, device, createdAt: this.#now().toISOString() });
      this.#line({ action: 'passkey-added', device });
    })();
    return { ok: true };
  }

  // ----- The setting -----

  stayLoggedInDays(): number {
    return stayLoggedInDays(this.#db);
  }

  passkeys(): readonly { readonly device: string; readonly createdAt: string }[] {
    return readPasskeys(this.#db).map((p) => ({ device: p.device, createdAt: p.createdAt }));
  }

  // How long he stays logged in on a device (section 2): a whole number of
  // days, 1 to 365. It applies right away, to every device (13.1).
  changeStayLoggedIn(_session: Session, days: unknown): { readonly ok: true } | Refused {
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MOST_DAYS) return { ok: false, why: `Stay logged in takes a whole number of days, 1 to ${MOST_DAYS}. ${NOTHING}` };
    const before = stayLoggedInDays(this.#db);
    if (days === before) return { ok: false, why: `That is already the setting. ${NOTHING}` };
    this.#db.transaction(() => {
      saveStayLoggedInDays(this.#db, days);
      this.#line({ action: 'stay-logged-in-changed', before, after: days });
    })();
    return { ok: true };
  }

  // ----- Inside -----

  async #creation(what: Challenge): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const options = await generateRegistrationOptions({
      rpName: 'Budget',
      rpID: this.#rpId(),
      userID: userId(this.#db),
      userName: 'budget',
      userDisplayName: 'Budget',
      attestationType: 'none',
      excludeCredentials: readPasskeys(this.#db).map((p) => ({ id: p.id, transports: [...p.transports] })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    this.#ask(options.challenge, what);
    return options;
  }

  // Checks a passkey the browser made, against a question this server asked.
  async #made(response: unknown, fits: (what: Challenge) => boolean): Promise<{ readonly ok: true; readonly passkey: { readonly id: string; readonly publicKey: Uint8Array<ArrayBuffer>; readonly counter: number; readonly transports: readonly string[] } } | Refused> {
    const answer = response as RegistrationResponseJSON;
    const challenge = this.#challengeOf(answer, 'clientDataJSON');
    const asked = challenge === null ? undefined : this.#take(challenge);
    if (asked === undefined || !fits(asked)) return { ok: false, why: `That passkey was not asked for, or was answered already. ${NOTHING}` };
    try {
      const verified = await verifyRegistrationResponse({
        response: answer,
        expectedChallenge: challenge ?? '',
        expectedOrigin: this.#origin(),
        expectedRPID: this.#rpId(),
        requireUserVerification: true,
      });
      if (!verified.verified) return { ok: false, why: `That passkey could not be checked. ${NOTHING}` };
      const { credential } = verified.registrationInfo;
      return { ok: true, passkey: { id: credential.id, publicKey: credential.publicKey, counter: credential.counter, transports: credential.transports ?? [] } };
    } catch {
      return { ok: false, why: `That passkey could not be checked. ${NOTHING}` };
    }
  }

  #ask(challenge: string, what: Challenge): void {
    const now = this.#now().getTime();
    for (const [key, c] of this.#challenges) if (c.until <= now) this.#challenges.delete(key);
    this.#challenges.set(challenge, { what, until: now + CHALLENGE_MS });
  }

  // A question asked and not answered yet, now answered: it cannot be used again.
  #take(challenge: string): Challenge | undefined {
    const found = this.#challenges.get(challenge);
    this.#challenges.delete(challenge);
    return found !== undefined && this.#now().getTime() < found.until ? found.what : undefined;
  }

  // The challenge the browser says it answered, read from its client data;
  // the library checks it again against the one asked.
  #challengeOf(answer: unknown, field: 'clientDataJSON'): string | null {
    try {
      const data = (answer as { response?: Record<string, unknown> }).response?.[field];
      if (typeof data !== 'string' || data.length > 4096) return null;
      const challenge = (JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as { challenge?: unknown }).challenge;
      return typeof challenge === 'string' ? challenge : null;
    } catch {
      return null;
    }
  }

  #startSession(token: string, device: string, passkeyId: string, now: string): void {
    saveSession(this.#db, token, { device, passkeyId, createdAt: now });
    this.#line({ action: 'logged-in', device });
  }

  #line(line: { readonly action: 'logged-in' | 'logged-out' | 'passkey-added'; readonly device: string } | { readonly action: 'stay-logged-in-changed'; readonly before: number; readonly after: number }): void {
    saveServerLine(this.#db, { date: this.#today(), ...line, afterBookLines: this.#bookLines() });
  }

  #secure(): string {
    return this.#origin().startsWith('https:') ? '; Secure' : '';
  }

  #cookie(token: string): string {
    return `${LOGIN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${stayLoggedInDays(this.#db) * 24 * 60 * 60}${this.#secure()}`;
  }
}

// The login in a Cookie header, if it carries one that looks like ours.
export function tokenIn(cookieHeader: string | undefined): string | null {
  if (cookieHeader === undefined) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    const value = rest.join('=');
    if (name === LOGIN_COOKIE && value.length === LOGIN_LENGTH && /^[A-Za-z0-9_-]+$/.test(value)) return value;
  }
  return null;
}
