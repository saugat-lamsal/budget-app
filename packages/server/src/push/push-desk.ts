import type { IsoDate } from '@budget-app/money';
import type { Agent } from 'node:https';
import type { Db } from '../db/database.js';
import { todayIn } from '../history/today.js';
import type { Log } from '../log.js';
import { saveServerLine } from '../server-log.js';
import type { PushAnswer, PushOnRequest, PushView } from '../views/push.js';
import { allSubscriptions, removeSubscription, saveSubscription, stoppedOf, subscriptionGone, subscriptionOf, type StoredSubscription } from './push-db.js';
import type { PushKeys } from './push-keys.js';
import { PushSender } from './push-sender.js';
import { endpointProblem } from './push-services.js';

// Phase 5, the phone: Settings' Notifications card, as the real server
// answers it for the device asking (by its login), and the real sender. Each
// device turned on or off, and each one its push service stopped, is a line in
// the change log (13.5), with the device in words.

export interface PushDeskInput {
  readonly db: Db;
  // None: the server writes each alert in its own window (npm run serve without VAPID_* in .env).
  readonly keys: PushKeys | null;
  readonly now: () => Date;
  readonly zone: () => string;
  // How many of the book's change log lines there are, for the order of the log.
  readonly bookLines: () => number;
  readonly log: Log;
  // The tests' made-up push service's certificate. Never set by npm run serve.
  readonly agent?: Agent;
}

// The device asking: its login, and the device in words.
export interface Asking {
  readonly token: string;
  readonly device: string;
}

const NO_KEYS: PushAnswer = { ok: false, why: 'The server is not set up to send notifications: it has no push keys.' };

export class PushDesk {
  readonly #input: PushDeskInput;
  readonly #sender: PushSender | null;

  constructor(input: PushDeskInput) {
    this.#input = input;
    this.#sender =
      input.keys === null
        ? null
        : new PushSender({ db: input.db, keys: input.keys, log: input.log, gone: (s, why) => this.#gone(s, why), ...(input.agent === undefined ? {} : { agent: input.agent }) });
  }

  // The real sender, or null with no keys.
  sender(): PushSender | null {
    return this.#sender;
  }

  #today(): IsoDate {
    return todayIn(this.#input.zone(), this.#input.now());
  }

  view(asking: Asking): PushView {
    const { db, keys } = this.#input;
    if (keys === null) return { state: 'no-keys' };
    const mine = subscriptionOf(db, asking.token);
    const stopped = mine === null ? stoppedOf(db, asking.token) : null;
    return {
      state: 'ready',
      publicKey: keys.publicKey,
      thisDevice: mine !== null ? { on: true, endpoint: mine.endpoint, since: todayIn(this.#input.zone(), new Date(mine.createdAt)) } : { on: false, stopped: stopped === null ? null : { date: todayIn(this.#input.zone(), new Date(stopped.at)), why: stopped.why } },
      devices: allSubscriptions(db).length,
    };
  }

  on(asking: Asking, request: PushOnRequest): PushAnswer {
    if (this.#input.keys === null) return NO_KEYS;
    const problem = endpointProblem(request.endpoint);
    if (problem !== null) return { ok: false, why: problem };
    const { db } = this.#input;
    db.transaction(() => {
      saveSubscription(db, asking.token, { endpoint: request.endpoint, p256dh: request.keys.p256dh, auth: request.keys.auth, device: asking.device, createdAt: this.#input.now().toISOString() });
      this.#line({ action: 'notifications-on', device: asking.device });
    })();
    return { ok: true };
  }

  off(asking: Asking): PushAnswer {
    const { db } = this.#input;
    db.transaction(() => {
      if (removeSubscription(db, asking.token) !== null) this.#line({ action: 'notifications-off', device: asking.device });
    })();
    return { ok: true };
  }

  // A test alert to this device only, now: not one of the rules' alerts, so
  // it is not kept in the history or the outbox.
  async test(asking: Asking): Promise<PushAnswer> {
    if (this.#sender === null) return NO_KEYS;
    const mine = subscriptionOf(this.#input.db, asking.token);
    if (mine === null) return { ok: false, why: 'Notifications are off on this phone. Turn them on first.' };
    const outcome = await this.#sender.deliver([mine], { id: `test ${this.#input.now().toISOString()}`, title: 'Test alert', body: 'Notifications are on for this phone. Alerts come like this one.', due: null, screen: '/settings' });
    if (outcome.delivered.length > 0) return { ok: true };
    if (outcome.gone.length > 0) return { ok: false, why: "This phone's push service would not take it: notifications stopped here. Turn them on to start again." };
    return { ok: false, why: `Couldn't reach this phone's push service (${outcome.failed[0]?.why ?? 'no answer'}). Try again later.` };
  }

  #gone(s: StoredSubscription, why: string): void {
    const { db } = this.#input;
    db.transaction(() => {
      if (subscriptionGone(db, s, this.#input.now().toISOString(), why)) this.#line({ action: 'notifications-stopped', device: s.device, why });
    })();
  }

  #line(line: { readonly action: 'notifications-on' | 'notifications-off'; readonly device: string } | { readonly action: 'notifications-stopped'; readonly device: string; readonly why: string }): void {
    saveServerLine(this.#input.db, { date: this.#today(), ...line, afterBookLines: this.#input.bookLines() });
  }
}
