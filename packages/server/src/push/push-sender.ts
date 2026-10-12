import { createHash } from 'node:crypto';
import type { Agent } from 'node:https';
import webpush from 'web-push';
import type { Db } from '../db/database.js';
import type { Log } from '../log.js';
import type { AlertSender, OutgoingAlert } from '../serve/alert-timer.js';
import type { PushPayload } from '../views/push.js';
import { allSubscriptions, type StoredSubscription } from './push-db.js';
import type { PushKeys } from './push-keys.js';
import { endpointProblem } from './push-services.js';

// Phase 5, the phone: the real sender behind the AlertSender plug. Each alert
// goes to every device that has notifications on, through web push (the
// web-push library: the payload encrypted for that device, RFC 8291, and the
// request signed with the app's own key, RFC 8292). The outbox decides what
// goes and when (quiet hours, once, tries again, catching up: unchanged);
// this only hands an alert over. The words are what the outbox gives it,
// without amounts unless the setting says so (10.10): no amount leaves the
// server otherwise.
//
// A push service that says a subscription is gone (404 or 410) has it removed
// and logged, and that device's Notifications card says notifications are off
// there. Any other answer is a failure, and the alert is tried again later,
// to every device: one that got it already shows it only once (the service
// worker remembers the ids it showed, and the push service keeps only the
// newest message of a topic waiting).

// How long a push service keeps an alert for a phone that is off: a day. A
// phone off for longer does not get the day's alerts when it is on again;
// they are all in the list in the app (Settings, Alerts sent).
export const PUSH_TTL_SECONDS = 24 * 60 * 60;
// How long one push service may take to answer.
const PUSH_TIMEOUT_MS = 15_000;

export interface PushOutcome {
  readonly delivered: readonly StoredSubscription[];
  readonly gone: readonly StoredSubscription[];
  readonly failed: readonly { readonly subscription: StoredSubscription; readonly why: string }[];
}

export interface PushSenderInput {
  readonly db: Db;
  readonly keys: PushKeys;
  readonly log: Log;
  // A push service said this subscription is gone: remove it and log it.
  readonly gone: (subscription: StoredSubscription, why: string) => void;
  // For the tests: the made-up push service's certificate. Never set by npm run serve.
  readonly agent?: Agent;
}

// The push service keeps only the newest waiting message of a topic, so a
// try of an alert sent again while the phone was off replaces the one before.
// A topic is at most 32 characters of base64url.
export function topicOf(id: string): string {
  return createHash('sha256').update(id).digest('base64url').slice(0, 32);
}

export class PushSender implements AlertSender {
  readonly #input: PushSenderInput;

  constructor(input: PushSenderInput) {
    this.#input = input;
  }

  async send(alert: OutgoingAlert): Promise<void> {
    const subscriptions = allSubscriptions(this.#input.db);
    if (subscriptions.length === 0) throw new Error('notifications are off on every device');
    const outcome = await this.deliver(subscriptions, { id: alert.id, title: alert.title, body: alert.body, due: alert.due, screen: alert.screen });
    if (outcome.failed.length > 0) throw new Error(outcome.failed.map((f) => `${f.subscription.device}: ${f.why}`).join('; '));
    if (outcome.delivered.length === 0) throw new Error('every device stopped taking notifications');
  }

  // One push to each of these subscriptions, all at once.
  async deliver(subscriptions: readonly StoredSubscription[], payload: PushPayload): Promise<PushOutcome> {
    const { keys, log } = this.#input;
    const body = JSON.stringify(payload);
    const results = await Promise.all(
      subscriptions.map(async (s): Promise<{ readonly s: StoredSubscription; readonly outcome: 'delivered' | 'gone' | 'failed'; readonly why: string }> => {
        const problem = endpointProblem(s.endpoint);
        if (problem !== null) return { s, outcome: 'failed', why: problem };
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            vapidDetails: { subject: keys.subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
            TTL: PUSH_TTL_SECONDS,
            urgency: 'normal',
            topic: topicOf(payload.id),
            timeout: PUSH_TIMEOUT_MS,
            ...(this.#input.agent === undefined ? {} : { agent: this.#input.agent }),
          });
          return { s, outcome: 'delivered', why: '' };
        } catch (error) {
          const status = error instanceof webpush.WebPushError ? error.statusCode : null;
          if (status === 404 || status === 410) return { s, outcome: 'gone', why: `its push service answered ${status}: the subscription is gone` };
          return { s, outcome: 'failed', why: status === null ? `its push service could not be reached (${error instanceof Error ? error.message : String(error)})` : `its push service answered ${status}` };
        }
      }),
    );
    for (const r of results) {
      if (r.outcome === 'gone') this.#input.gone(r.s, r.why);
      // The device in words and what went wrong; never the address or the keys.
      if (r.outcome !== 'delivered') log.info('push', { device: r.s.device, outcome: r.outcome, why: r.why });
    }
    return {
      delivered: results.filter((r) => r.outcome === 'delivered').map((r) => r.s),
      gone: results.filter((r) => r.outcome === 'gone').map((r) => r.s),
      failed: results.filter((r) => r.outcome === 'failed').map((r) => ({ subscription: r.s, why: r.why })),
    };
  }
}
