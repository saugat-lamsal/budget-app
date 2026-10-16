import { createHash, timingSafeEqual } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify, type JWTPayload } from 'jose';
import type { Log } from '../log.js';
import { PlaidError, type PlaidClient } from './client.js';

// Section 2 (QUESTIONS.md A47, his call Oct 14): Plaid calls the app's own
// address when it has something new for his connection (a webhook), and the
// app syncs then; the 60-minute timer stays. The address needs no login
// (Plaid has none), so every call is checked here first, as Plaid says to:
// - the Plaid-Verification header, whatever its case, is a JWT whose alg is
//   exactly ES256, verified with jose (a vetted library, never ES256 by
//   hand) against the key Plaid gives for its kid (/webhook_verification_key
//   /get), kept by kid, asked for again when unknown or a day old, and no
//   good once its expired_at has passed (that is how Plaid rotates keys);
// - it was made (iat) no more than 5 minutes ago, and not ahead of this clock
//   by more than a minute;
// - its request_body_sha256 is the SHA-256 of the exact bytes received (never
//   the JSON written again: the hash depends on every space), compared in
//   constant time.
// Strangers sending made-up kids cannot make the app ask Plaid more than 10
// times an hour. What a call says is used only to decide to sync: nothing in
// it is ever taken as money (webhook-desk.ts).

export { WEBHOOK_BODY_LIMIT, WEBHOOK_PATH } from '../http/webhook-path.js';
export const WEBHOOK_MAX_AGE_SECONDS = 300;
export const WEBHOOK_AHEAD_SECONDS = 60;
export const KEY_FETCHES_PER_HOUR = 10;
export const KEY_REFRESH_MS = 24 * 3_600_000;
const HOUR_MS = 3_600_000;

// A key as /webhook_verification_key/get gives it: a public JWK, with when it
// was made and when it expired (seconds; null while it is good).
export interface WebhookKey {
  readonly alg: string;
  readonly crv: string;
  readonly kty: string;
  readonly use?: string;
  readonly kid: string;
  readonly x: string;
  readonly y: string;
  readonly created_at: number;
  readonly expired_at: number | null;
}

// Plaid's answer for a kid: the key, or that it has none. Throws when Plaid
// cannot be asked.
export type KeyAnswer = { readonly found: true; readonly key: WebhookKey } | { readonly found: false };

export interface KeySource {
  fetch(kid: string): Promise<KeyAnswer>;
}

// Plaid's keys, asked for through the client (and so through the lock), with
// a time limit well inside the 10 seconds Plaid waits for an answer. Plaid's
// "no such key" is a key not found; anything else, a key not had now.
export const KEY_FETCH_LIMIT_MS = 5_000;

export function plaidKeySource(plaid: PlaidClient, limitMs = KEY_FETCH_LIMIT_MS): KeySource {
  return {
    fetch: async (kid) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Plaid took too long to give the key')), limitMs);
      });
      try {
        const reply = await Promise.race([plaid.getWebhookVerificationKey(kid), late]);
        return { found: true, key: reply.key };
      } catch (error) {
        if (error instanceof PlaidError && error.errorType === 'INVALID_INPUT') return { found: false };
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// A key as jose reads it.
type VerifyKey = Awaited<ReturnType<typeof importJWK>>;

type Refused = { readonly ok: false; readonly status: 400 | 401 | 503; readonly why: string };
type GotKey = { readonly ok: true; readonly key: VerifyKey } | Refused;

interface Kept {
  readonly key: WebhookKey;
  readonly cryptoKey: VerifyKey;
  // When it was had from Plaid (ms).
  readonly at: number;
}

const refused = (why: string, status: Refused['status'] = 401): Refused => ({ ok: false, status, why });

// Plaid's keys, by kid.
export class WebhookKeys {
  readonly #source: KeySource;
  readonly #now: () => Date;
  readonly #log: Log;
  readonly #perHour: number;
  readonly #refreshMs: number;
  readonly #kept = new Map<string, Kept>();
  // Kids Plaid said it has no key for, and when (ms): not asked again for an hour.
  readonly #unknown = new Map<string, number>();
  // When Plaid was asked, in the last hour (ms).
  #asked: number[] = [];

  constructor(input: { readonly source: KeySource; readonly now: () => Date; readonly log: Log; readonly perHour?: number; readonly refreshMs?: number }) {
    this.#source = input.source;
    this.#now = input.now;
    this.#log = input.log;
    this.#perHour = input.perHour ?? KEY_FETCHES_PER_HOUR;
    this.#refreshMs = input.refreshMs ?? KEY_REFRESH_MS;
  }

  async get(kid: string): Promise<GotKey> {
    const now = this.#now().getTime();
    const kept = this.#kept.get(kid);
    if (kept !== undefined && now - kept.at < this.#refreshMs) return usable(kept, now);
    const said = this.#unknown.get(kid);
    if (kept === undefined && said !== undefined && now - said < HOUR_MS) return refused('Plaid has no key with that kid');
    if (!this.#mayAsk(now)) return kept !== undefined ? usable(kept, now) : refused('too many unknown keys asked for this hour', 503);
    let answer: KeyAnswer;
    try {
      answer = await this.#source.fetch(kid);
    } catch (error) {
      this.#log.warn('webhook key could not be had from Plaid', { kind: error instanceof Error ? error.name : 'unknown' });
      return kept !== undefined ? usable(kept, now) : refused('the key could not be had from Plaid', 503);
    }
    if (!answer.found) {
      this.#kept.delete(kid);
      this.#unknown.set(kid, now);
      return refused('Plaid has no key with that kid');
    }
    const key = answer.key;
    if (key.kid !== kid || key.alg !== 'ES256' || key.kty !== 'EC' || key.crv !== 'P-256' || typeof key.x !== 'string' || typeof key.y !== 'string') return refused("Plaid's key is not an ES256 P-256 public key");
    let cryptoKey: VerifyKey;
    try {
      cryptoKey = await importJWK({ kty: key.kty, crv: key.crv, x: key.x, y: key.y }, 'ES256');
    } catch {
      return refused("Plaid's key could not be read");
    }
    const entry: Kept = { key, cryptoKey, at: now };
    this.#kept.set(kid, entry);
    this.#unknown.delete(kid);
    return usable(entry, now);
  }

  #mayAsk(now: number): boolean {
    this.#asked = this.#asked.filter((t) => now - t < HOUR_MS);
    if (this.#asked.length >= this.#perHour) return false;
    this.#asked.push(now);
    return true;
  }
}

// No good once its expired_at has passed.
function usable(kept: Kept, now: number): GotKey {
  const expired = kept.key.expired_at;
  if (expired !== null && expired * 1000 <= now) return refused('the key has expired');
  return { ok: true, key: kept.cryptoKey };
}

// What the app reads from a webhook: which kind it is, and which connection.
export interface PlaidWebhook {
  readonly type: string;
  readonly code: string;
  readonly itemId: string | null;
  // ITEM ERROR: the error's code (usually ITEM_LOGIN_REQUIRED).
  readonly errorCode: string | null;
}

export type Verified = { readonly ok: true; readonly webhook: PlaidWebhook; readonly token: string } | Refused;

export async function verifyWebhook(input: {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body: Uint8Array;
  readonly now: Date;
  readonly keys: WebhookKeys;
}): Promise<Verified> {
  const token = headerOf(input.headers, 'plaid-verification');
  if (token === null) return refused('no Plaid-Verification header');
  let kid: unknown;
  let claims: JWTPayload;
  try {
    const header = decodeProtectedHeader(token);
    if (header.alg !== 'ES256') return refused('the JWT is not ES256');
    kid = header.kid;
    claims = decodeJwt(token);
  } catch {
    return refused('the Plaid-Verification header is not a JWT');
  }
  if (typeof kid !== 'string' || kid === '' || kid.length > 200) return refused('the JWT names no key');
  // What the claims say is checked before Plaid is asked for a key, and holds
  // once the signature (over them) verifies.
  const iat = claims.iat;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return refused('the JWT does not say when it was made');
  const age = input.now.getTime() / 1000 - iat;
  if (age > WEBHOOK_MAX_AGE_SECONDS) return refused('the JWT is more than 5 minutes old');
  if (age < -WEBHOOK_AHEAD_SECONDS) return refused('the JWT was made ahead of this clock');
  const claimed = claims['request_body_sha256'];
  if (typeof claimed !== 'string' || !/^[0-9a-f]{64}$/.test(claimed)) return refused('the JWT has no SHA-256 of the body');
  const actual = createHash('sha256').update(input.body).digest();
  if (!timingSafeEqual(actual, Buffer.from(claimed, 'hex'))) return refused('the body is not the one Plaid signed');
  const got = await input.keys.get(kid);
  if (!got.ok) return got;
  try {
    await jwtVerify(token, got.key, { algorithms: ['ES256'], currentDate: input.now });
  } catch {
    return refused('the signature does not verify');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(input.body).toString('utf8'));
  } catch {
    return refused('the body is not JSON', 400);
  }
  const webhook = webhookOf(parsed);
  if (webhook === null) return refused('the body is not a Plaid webhook', 400);
  return { ok: true, webhook, token };
}

// One header, whatever its case; null when missing, empty, or sent twice.
function headerOf(headers: Readonly<Record<string, string | readonly string[] | undefined>>, name: string): string | null {
  const values = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
  if (values.length !== 1) return null;
  const value = values[0]?.[1];
  const one = typeof value === 'string' ? value : value?.length === 1 ? value[0] : undefined;
  return one === undefined || one.trim() === '' ? null : one.trim();
}

function webhookOf(value: unknown): PlaidWebhook | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const type = v['webhook_type'];
  const code = v['webhook_code'];
  if (typeof type !== 'string' || typeof code !== 'string') return null;
  const item = v['item_id'];
  const error = v['error'];
  const errorCode = typeof error === 'object' && error !== null && typeof (error as Record<string, unknown>)['error_code'] === 'string' ? ((error as Record<string, unknown>)['error_code'] as string) : null;
  return { type, code, itemId: typeof item === 'string' && item !== '' ? item : null, errorCode };
}
