import { statement, type Db } from '../db/database.js';
import { hashOf } from '../auth/auth-db.js';

// Phase 5, the phone: the push subscriptions kept in the database (step 7),
// one per device logged in, by a hash of that device's login (the login
// itself is only in the device's cookie). Nothing here asks the clock; times
// are handed in.

export interface StoredSubscription {
  readonly sessionHash: string;
  // The address at the device's push service.
  readonly endpoint: string;
  // The device's public key and secret, base64url: each alert is encrypted for them.
  readonly p256dh: string;
  readonly auth: string;
  // In words ("Safari on iPhone").
  readonly device: string;
  readonly createdAt: string;
}

export interface Stopped {
  readonly at: string;
  readonly device: string;
  readonly why: string;
}

interface Row {
  session_hash: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  device: string;
  created_at: string;
}

const rowOf = (r: Row): StoredSubscription => ({ sessionHash: r.session_hash, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth, device: r.device, createdAt: r.created_at });

// The device of this login turns notifications on: its subscription replaces
// any it had, and the same endpoint under another login (the same phone,
// logged in again) moves to this one. A note that it had stopped goes.
export function saveSubscription(db: Db, token: string, s: Omit<StoredSubscription, 'sessionHash'>): void {
  const sessionHash = hashOf(token);
  db.transaction(() => {
    statement(db, 'DELETE FROM push_subscriptions WHERE session_hash = ? OR endpoint = ?').run(sessionHash, s.endpoint);
    statement(db, 'DELETE FROM push_stopped WHERE session_hash = ?').run(sessionHash);
    statement(db, 'INSERT INTO push_subscriptions (session_hash, endpoint, p256dh, auth, device, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(sessionHash, s.endpoint, s.p256dh, s.auth, s.device, s.createdAt);
  })();
}

// 10.11 (QUESTIONS.md A41): the device of this login, just logged in again,
// already gets notifications under another login (the phone's old one): they
// move to this login, kept since they were turned on. False when no other
// login has that address (turned off there, logged out there, or not known).
export function moveSubscription(db: Db, token: string, endpoint: string, device: string): boolean {
  const sessionHash = hashOf(token);
  return statement(db, 'UPDATE push_subscriptions SET session_hash = ?, device = ? WHERE endpoint = ? AND session_hash <> ?').run(sessionHash, device, endpoint, sessionHash).changes > 0;
}

export function subscriptionOf(db: Db, token: string): StoredSubscription | null {
  const row = statement(db, 'SELECT session_hash, endpoint, p256dh, auth, device, created_at FROM push_subscriptions WHERE session_hash = ?').get(hashOf(token)) as Row | undefined;
  return row === undefined ? null : rowOf(row);
}

// Every device that has notifications on, the oldest first.
export function allSubscriptions(db: Db): StoredSubscription[] {
  return (statement(db, 'SELECT session_hash, endpoint, p256dh, auth, device, created_at FROM push_subscriptions ORDER BY created_at, rowid').all() as Row[]).map(rowOf);
}

// He turned them off on this device.
export function removeSubscription(db: Db, token: string): StoredSubscription | null {
  const found = subscriptionOf(db, token);
  if (found !== null) statement(db, 'DELETE FROM push_subscriptions WHERE session_hash = ?').run(found.sessionHash);
  return found;
}

// The push service said this subscription is gone: it is removed, and its
// device's card can say when and why. False when it was not there any more.
export function subscriptionGone(db: Db, s: StoredSubscription, at: string, why: string): boolean {
  return db.transaction(() => {
    const removed = statement(db, 'DELETE FROM push_subscriptions WHERE session_hash = ? AND endpoint = ?').run(s.sessionHash, s.endpoint).changes > 0;
    if (removed) statement(db, 'INSERT INTO push_stopped (session_hash, at, device, why) VALUES (?, ?, ?, ?) ON CONFLICT (session_hash) DO UPDATE SET at = excluded.at, device = excluded.device, why = excluded.why').run(s.sessionHash, at, s.device, why);
    return removed;
  })();
}

export function stoppedOf(db: Db, token: string): Stopped | null {
  const row = statement(db, 'SELECT at, device, why FROM push_stopped WHERE session_hash = ?').get(hashOf(token)) as Stopped | undefined;
  return row === undefined ? null : { at: row.at, device: row.device, why: row.why };
}
