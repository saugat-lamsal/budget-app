import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../db/database.js';

// What login keeps in the database (step 3): his passkeys (only their public
// keys: the private key never leaves his device), the devices logged in, and
// the one-time codes for making a passkey. A login and a code are kept only
// as a hash, so the database alone lets no one in. Nothing here asks the
// clock; times are handed in.

export interface StoredPasskey {
  // The passkey's id, as the device names it (base64url).
  readonly id: string;
  readonly publicKey: Uint8Array<ArrayBuffer>;
  // How many times the device says it has been used; a copy of a passkey
  // shows itself by going backwards.
  readonly counter: number;
  readonly transports: readonly string[];
  // Where it was made, in words ("Chrome on Windows").
  readonly device: string;
  readonly createdAt: string;
}

export interface StoredSession {
  readonly device: string;
  readonly passkeyId: string;
  // When he logged in, as an instant (ISO, UTC).
  readonly createdAt: string;
}

// The hash a login or a code is kept as.
export function hashOf(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

// A new secret: 32 random bytes, base64url.
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

// ----- His passkeys -----

export function readPasskeys(db: Db): StoredPasskey[] {
  const rows = db.prepare('SELECT id, public_key, counter, transports, device, created_at FROM passkeys ORDER BY rowid').all() as { id: string; public_key: Buffer; counter: number; transports: string; device: string; created_at: string }[];
  return rows.map((r) => ({ id: r.id, publicKey: new Uint8Array(r.public_key), counter: r.counter, transports: JSON.parse(r.transports) as string[], device: r.device, createdAt: r.created_at }));
}

export function savePasskey(db: Db, p: StoredPasskey): void {
  db.prepare('INSERT INTO passkeys (id, public_key, counter, transports, device, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(p.id, Buffer.from(p.publicKey), p.counter, JSON.stringify(p.transports), p.device, p.createdAt);
}

export function savePasskeyCounter(db: Db, id: string, counter: number): void {
  db.prepare('UPDATE passkeys SET counter = ? WHERE id = ?').run(counter, id);
}

// ----- Devices logged in -----

export function saveSession(db: Db, token: string, s: StoredSession): void {
  db.prepare('INSERT INTO sessions (token_hash, device, passkey_id, created_at) VALUES (?, ?, ?, ?)').run(hashOf(token), s.device, s.passkeyId, s.createdAt);
}

export function readSession(db: Db, token: string): StoredSession | null {
  const row = db.prepare('SELECT device, passkey_id, created_at FROM sessions WHERE token_hash = ?').get(hashOf(token)) as { device: string; passkey_id: string; created_at: string } | undefined;
  return row === undefined ? null : { device: row.device, passkeyId: row.passkey_id, createdAt: row.created_at };
}

export function endSession(db: Db, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashOf(token));
}

// ----- One-time codes (the first passkey, or after losing them all) -----

// Keeps a new code, good once until `expiresAt`. Any code not used yet stops
// being good: only the newest one works.
export function saveCode(db: Db, code: string, createdAt: string, expiresAt: string): void {
  db.transaction(() => {
    db.prepare('UPDATE login_codes SET used_at = ? WHERE used_at IS NULL').run(createdAt);
    db.prepare('INSERT INTO login_codes (code_hash, created_at, expires_at, used_at) VALUES (?, ?, ?, NULL)').run(hashOf(code), createdAt, expiresAt);
  })();
}

// The code, if it is good at `now`: not used and not expired.
export function goodCode(db: Db, code: string, now: string): boolean {
  const row = db.prepare('SELECT expires_at FROM login_codes WHERE code_hash = ? AND used_at IS NULL').get(hashOf(code)) as { expires_at: string } | undefined;
  return row !== undefined && now < row.expires_at;
}

export function useCode(db: Db, code: string, now: string): void {
  db.prepare('UPDATE login_codes SET used_at = ? WHERE code_hash = ?').run(now, hashOf(code));
}

// Every code not used yet stops being good (too many wrong tries).
export function voidCodes(db: Db, now: string): void {
  db.prepare('UPDATE login_codes SET used_at = ? WHERE used_at IS NULL').run(now);
}

// ----- Settings kept with them -----

const USER_ID = 'login-user-id';
const STAY_DAYS = 'stay-logged-in-days';
export const STAY_LOGGED_IN_DAYS = 30;

// The id his passkeys are made for: random, made once.
export function userId(db: Db): Uint8Array<ArrayBuffer> {
  const row = db.prepare('SELECT value FROM settings WHERE name = ?').get(USER_ID) as { value: string } | undefined;
  if (row !== undefined) return new Uint8Array(Buffer.from(row.value, 'base64url'));
  const id = randomBytes(16);
  db.prepare('INSERT INTO settings (name, value) VALUES (?, ?)').run(USER_ID, id.toString('base64url'));
  return new Uint8Array(id);
}

// How long he stays logged in on a device (section 2), in days.
export function stayLoggedInDays(db: Db): number {
  const row = db.prepare('SELECT value FROM settings WHERE name = ?').get(STAY_DAYS) as { value: string } | undefined;
  return row === undefined ? STAY_LOGGED_IN_DAYS : Number(JSON.parse(row.value));
}

export function saveStayLoggedInDays(db: Db, days: number): void {
  db.prepare('INSERT INTO settings (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value').run(STAY_DAYS, JSON.stringify(days));
}

