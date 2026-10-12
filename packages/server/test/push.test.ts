import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, type Db } from '../src/db/database.js';
import { saveSession } from '../src/auth/auth-db.js';
import { memoryLog, type LogLine } from '../src/log.js';
import { alertScreen, type AlertFacts } from '../src/alerts/alerts.js';
import { allSubscriptions, removeSubscription, saveSubscription, stoppedOf, subscriptionGone, subscriptionOf, type StoredSubscription } from '../src/push/push-db.js';
import { newPushKeys, pushKeysFromEnv } from '../src/push/push-keys.js';
import { PUSH_TTL_SECONDS, PushSender, topicOf } from '../src/push/push-sender.js';
import { endpointLock, endpointProblem } from '../src/push/push-services.js';
import type { OutgoingAlert } from '../src/serve/alert-timer.js';
import { FakePushService, type TestPhone } from './fake-push-service.js';

// Phase 5, the phone: the pieces the real sender is made of. Where it may
// send (only a push service's address, and under the tests only this
// computer), the app's own push keys (only from the environment, the private
// one never shown), the subscriptions kept (database step 7, tied to each
// device's login), and the sender itself, through the web-push library, to
// the made-up push service on this computer (fake-push-service.ts), which
// checks the signature and opens each alert with the phone's own keys.
// Every name, key and number is made up, and made fresh each run.

const NOW = new Date('2026-10-12T16:00:00Z');
const APPLE = 'https://web.push.apple.com/QGuQyavXutnMH8kxhNLB9VhQ';

const services: FakePushService[] = [];
afterEach(async () => {
  for (const s of services.splice(0)) await s.close();
});

describe('Phase 5 where the server may send an alert', () => {
  it('Phase 5 only a push service, over https: Apple\'s for the iPhone, and the ones a browser on his computer may use', () => {
    for (const ok of [APPLE, 'https://api.push.apple.com/3/device/x', 'https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://wns2-par02p.notify.windows.com/w/?token=abc']) {
      expect(endpointProblem(ok, 'push-services'), ok).toBeNull();
    }
    for (const bad of ['http://web.push.apple.com/x', 'https://push.apple.com.example.com/x', 'https://evil.example/push', 'https://127.0.0.1:443/push', 'https://user:pw@web.push.apple.com/x', 'not a url', '', 42, null]) {
      expect(endpointProblem(bad, 'push-services'), String(bad)).not.toBeNull();
    }
  });

  it('Phase 5 under the tests, this computer only, whatever a test asks for: no test can reach a real push service', () => {
    expect(endpointLock()).toBe('this-computer');
    expect(endpointLock({})).toBe('push-services');
    expect(endpointProblem(APPLE)).toBe('Under the tests the server sends to this computer only.');
    expect(endpointProblem('https://127.0.0.1:5555/push/phone-1')).toBeNull();
    expect(endpointProblem('https://localhost:5555/push/phone-1')).not.toBeNull();
  });
});

describe('Phase 5 the app\'s push keys, from the environment only', () => {
  const keys = newPushKeys('mailto:made-up@example.com');

  it('Phase 5 none set: no keys (the server then writes each alert in its own window); all three set: the keys', () => {
    expect(pushKeysFromEnv({})).toBeNull();
    const read = pushKeysFromEnv({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:made-up@example.com' });
    expect(read?.publicKey).toBe(keys.publicKey);
    expect(read?.privateKey).toBe(keys.privateKey);
  });

  it('Phase 5 wrong or missing ones are refused, saying which, never repeating a key', () => {
    const good = { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:made-up@example.com' };
    for (const [env, says] of [
      [{ ...good, VAPID_PUBLIC_KEY: 'short' }, 'VAPID_PUBLIC_KEY'],
      [{ ...good, VAPID_PRIVATE_KEY: keys.publicKey }, 'VAPID_PRIVATE_KEY'],
      [{ ...good, VAPID_SUBJECT: 'someone' }, 'VAPID_SUBJECT'],
      [{ VAPID_PUBLIC_KEY: keys.publicKey }, 'VAPID_PRIVATE_KEY'],
    ] as const) {
      let message = '';
      try {
        pushKeysFromEnv(env);
      } catch (error) {
        message = String(error);
      }
      expect(message, says).toContain(says);
      expect(message).not.toContain(keys.privateKey);
      expect(message).not.toContain(keys.publicKey);
    }
  });

  it('Phase 5 printing, logging or sending the keys shows the public key at most, never the private one', () => {
    expect(JSON.stringify(keys)).not.toContain(keys.privateKey);
    expect(String(keys)).toBe('[push keys]');
    expect(Object.keys(keys)).not.toContain('privateKey');
    const lines: LogLine[] = [];
    memoryLog(lines).info('keys', { keys });
    expect(JSON.stringify(lines)).not.toContain(keys.privateKey);
  });
});

// A database with two devices logged in.
function twoDevices(): Db {
  const db = openDatabase(':memory:');
  saveSession(db, 'login-phone', { device: 'Safari on iPhone', passkeyId: 'pk', createdAt: '2026-10-01T16:00:00.000Z' });
  saveSession(db, 'login-computer', { device: 'Chrome on Windows', passkeyId: 'pk', createdAt: '2026-10-01T16:00:00.000Z' });
  return db;
}

const sub = (endpoint: string, at = '2026-10-12T16:00:00.000Z'): Omit<StoredSubscription, 'sessionHash'> => ({ endpoint, p256dh: 'p256dh-key', auth: 'auth-secret', device: 'Safari on iPhone', createdAt: at });

describe('Phase 5 database step 7: each device\'s subscription, tied to its login', () => {
  it('Phase 5 one per device; turned on again it replaces the one before; the same phone logged in again takes its subscription with it', () => {
    const db = twoDevices();
    saveSubscription(db, 'login-phone', sub('https://127.0.0.1:1/push/a'));
    saveSubscription(db, 'login-phone', sub('https://127.0.0.1:1/push/b'));
    expect(subscriptionOf(db, 'login-phone')?.endpoint).toBe('https://127.0.0.1:1/push/b');
    saveSubscription(db, 'login-computer', sub('https://127.0.0.1:1/push/b', '2026-10-12T17:00:00.000Z'));
    expect(subscriptionOf(db, 'login-phone')).toBeNull();
    expect(allSubscriptions(db).map((s) => s.endpoint)).toEqual(['https://127.0.0.1:1/push/b']);
  });

  it('Phase 5 logging out on a device takes its subscription away with the login', () => {
    const db = twoDevices();
    saveSubscription(db, 'login-phone', sub('https://127.0.0.1:1/push/a'));
    saveSubscription(db, 'login-computer', sub('https://127.0.0.1:1/push/c'));
    db.prepare('DELETE FROM sessions WHERE device = ?').run('Safari on iPhone');
    expect(allSubscriptions(db).map((s) => s.endpoint)).toEqual(['https://127.0.0.1:1/push/c']);
  });

  it('Phase 5 turned off: gone; gone at its push service: removed, and its device knows when and why, until it is turned on again', () => {
    const db = twoDevices();
    saveSubscription(db, 'login-phone', sub('https://127.0.0.1:1/push/a'));
    expect(removeSubscription(db, 'login-phone')?.endpoint).toBe('https://127.0.0.1:1/push/a');
    expect(removeSubscription(db, 'login-phone')).toBeNull();
    saveSubscription(db, 'login-phone', sub('https://127.0.0.1:1/push/a'));
    const s = subscriptionOf(db, 'login-phone')!;
    expect(subscriptionGone(db, s, '2026-10-13T00:00:00.000Z', 'its push service answered 410')).toBe(true);
    expect(subscriptionGone(db, s, '2026-10-13T00:00:00.000Z', 'its push service answered 410')).toBe(false);
    expect(subscriptionOf(db, 'login-phone')).toBeNull();
    expect(stoppedOf(db, 'login-phone')).toEqual({ at: '2026-10-13T00:00:00.000Z', device: 'Safari on iPhone', why: 'its push service answered 410' });
    saveSubscription(db, 'login-phone', sub('https://127.0.0.1:1/push/d'));
    expect(stoppedOf(db, 'login-phone')).toBeNull();
  });

  it('Phase 5 a subscription needs a device logged in', () => {
    const db = openDatabase(':memory:');
    expect(() => saveSubscription(db, 'no-such-login', sub('https://127.0.0.1:1/push/a'))).toThrow();
  });
});

describe('Phase 5 the real sender, through web push, to the made-up push service', () => {
  async function setUp(phones = 1): Promise<{ db: Db; service: FakePushService; phones: TestPhone[]; sender: PushSender; gone: string[]; lines: LogLine[] }> {
    const keys = newPushKeys('mailto:made-up@example.com');
    const service = await FakePushService.start({ now: () => NOW, serverKey: keys.publicKey });
    services.push(service);
    const db = twoDevices();
    const made = Array.from({ length: phones }, () => service.newPhone());
    made.forEach((p, i) => saveSubscription(db, i === 0 ? 'login-phone' : 'login-computer', { endpoint: p.endpoint, ...p.subscription().keys, device: i === 0 ? 'Safari on iPhone' : 'Chrome on Windows', createdAt: `2026-10-12T16:0${i}:00.000Z` }));
    const gone: string[] = [];
    const lines: LogLine[] = [];
    const sender = new PushSender({ db, keys, log: memoryLog(lines), agent: service.agent, gone: (s, why) => gone.push(`${s.device}: ${why}`) });
    return { db, service, phones: made, sender, gone, lines };
  }

  const alert: OutgoingAlert = { id: 'low-bucket needs pay period 3', title: 'Needs is low', body: 'Open the app to see what is left this pay period.', dueAt: '2026-10-12T16:00:00.000Z', due: null, screen: '/buckets/needs' };

  it('Phase 5 an alert reaches every device, signed by the app and opened with each phone\'s own keys, with its id as the tag and the screen a tap opens', async () => {
    const t = await setUp(2);
    await t.sender.send(alert);
    expect(t.service.problems).toEqual([]);
    for (const phone of t.phones) {
      expect(phone.shown.map((s) => [s.id, s.title, s.body, s.due, s.notification])).toEqual([
        [alert.id, 'Needs is low', alert.body, null, { title: 'Needs is low', body: alert.body, tag: alert.id, screen: '/buckets/needs' }],
      ]);
    }
    // A day to live at the push service, and its topic, so a try sent again replaces one still waiting.
    expect(t.service.received.map((r) => [r.status, r.ttl, r.topic, r.urgency])).toEqual([
      [201, String(PUSH_TTL_SECONDS), topicOf(alert.id), 'normal'],
      [201, String(PUSH_TTL_SECONDS), topicOf(alert.id), 'normal'],
    ]);
    expect(topicOf(alert.id)).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('Phase 5 B185 one sent late says when it was due after its words', async () => {
    const t = await setUp();
    await t.sender.send({ ...alert, due: 'Was due 3:10 AM.' });
    expect(t.phones[0]?.shown[0]?.notification.body).toBe(`${alert.body} Was due 3:10 AM.`);
  });

  it('Phase 5 B181 the same alert sent again (a try the server could not mark as done) is shown once: the phone drops the repeat', async () => {
    const t = await setUp();
    await t.sender.send(alert);
    await t.sender.send(alert);
    expect(t.phones[0]?.ids()).toEqual([alert.id]);
    expect(t.phones[0]?.repeats).toBe(1);
  });

  it('Phase 5 a phone that cannot be reached fails the send, so the outbox tries again; a phone that can still shows it once', async () => {
    const t = await setUp(2);
    t.phones[1]!.failing = 'off';
    await expect(t.sender.send(alert)).rejects.toThrow('Chrome on Windows: its push service answered 500');
    t.phones[1]!.failing = null;
    await t.sender.send(alert);
    expect(t.phones.map((p) => [p.ids(), p.repeats])).toEqual([
      [[alert.id], 1],
      [[alert.id], 0],
    ]);
    expect(t.gone).toEqual([]);
  });

  it('Phase 5 a subscription its push service says is gone (410) is handed back to be removed and logged; the other devices still get it', async () => {
    const t = await setUp(2);
    t.phones[0]!.gone = true;
    await t.sender.send(alert);
    expect(t.gone).toEqual(['Safari on iPhone: its push service answered 410: the subscription is gone']);
    expect(t.phones[1]?.ids()).toEqual([alert.id]);
    // The log names the device and what happened, never the address or a key.
    expect(JSON.stringify(t.lines)).not.toContain(t.phones[0]!.endpoint);
  });

  it('Phase 5 B198 one its push service no longer knows (404 Not Found) is gone too: handed back to be removed and logged', async () => {
    const t = await setUp(2);
    t.phones[0]!.gone = true;
    t.phones[0]!.goneAs = 404;
    await t.sender.send(alert);
    expect(t.gone).toEqual(['Safari on iPhone: its push service answered 404: the subscription is gone']);
    expect(t.phones[1]?.ids()).toEqual([alert.id]);
  });

  it('Phase 5 with every device gone, or none with notifications on, the send fails, so the outbox keeps it and tries again', async () => {
    const t = await setUp();
    t.phones[0]!.gone = true;
    await expect(t.sender.send(alert)).rejects.toThrow('every device stopped taking notifications');
    t.db.prepare('DELETE FROM push_subscriptions').run();
    await expect(t.sender.send(alert)).rejects.toThrow('notifications are off on every device');
  });

  it('Phase 5 a subscription for a real push service is never sent to under the tests: it fails before any request is made', async () => {
    const t = await setUp();
    t.db.prepare('UPDATE push_subscriptions SET endpoint = ?').run(APPLE);
    await expect(t.sender.send(alert)).rejects.toThrow('Under the tests the server sends to this computer only.');
    expect(t.service.received).toEqual([]);
  });
});

describe('Phase 5 B201 the screen a tap on an alert opens', () => {
  it("Phase 5 B201 Review for the daily review, the bucket's own list for low and empty, Home for the rest; the list of alerts for one kept without its facts", () => {
    const each: readonly (readonly [AlertFacts, string])[] = [
      [{ kind: 'daily-review', date: '2026-10-12', waiting: 2 }, '/review'],
      [{ kind: 'low-bucket', bucket: 'needs', period: 3, amount: 4_000, startedWith: 30_000 }, '/buckets/needs'],
      [{ kind: 'low-bucket', bucket: 'wants', period: 3, amount: 1_000, startedWith: 20_000 }, '/buckets/wants'],
      [{ kind: 'empty-bucket', bucket: 'needs', period: 3, amount: 0 }, '/buckets/needs'],
      [{ kind: 'empty-bucket', bucket: 'wants', period: 3, amount: -500 }, '/buckets/wants'],
      [{ kind: 'card-reminder', card: 'everyday-card', dueDate: '2026-10-16', daysBefore: 7, minimumPayment: 3_500, statementBalance: 41_234 }, '/home'],
      [{ kind: 'card-overdue', card: 'old-card', dueDate: '2026-10-10', minimumPayment: 2_500, date: '2026-10-12' }, '/home'],
      [{ kind: 'totals-mismatch', time: 1, difference: 1_250, day: '2026-10-12', again: false }, '/home'],
      [{ kind: 'bank-login', time: 1, day: '2026-10-12', again: true }, '/home'],
      [{ kind: 'bank-not-read', time: 1, hours: 24, lastRead: '2026-10-11T13:00:00.000Z', lastReadLocal: '2026-10-11T09:00' }, '/home'],
      [{ kind: 'bank-took-back', id: 'copy-1', date: '2026-10-12', description: 'MADE UP CAFE', amount: 1_299 }, '/home'],
    ];
    expect(new Set(each.map(([f]) => f.kind)).size).toBe(9);
    for (const [facts, screen] of each) expect(alertScreen(facts), facts.kind).toBe(screen);
    expect(alertScreen(null)).toBe('/alerts');
  });
});
