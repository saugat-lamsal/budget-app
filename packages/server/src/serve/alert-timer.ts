import type { Log } from '../log.js';
import { LONGEST_SLEEP_MS, type TimerClock } from './sync-timer.js';

// Phase 5, part one: npm run serve works out the alerts of rulebook sections 9
// and 10 by itself, keeps them, and sends them (alerts/plan.ts says which and
// when; alerts/outbox.ts keeps them).
// - It looks when the server starts, right after each sync and each answer
//   (the books poke it), and on its own at each moment an alert comes due by
//   the clock alone (each evening, the bank not read for a day, 10.7), and
//   when quiet hours end (10.8). It sleeps at most a minute at a time, so a
//   computer waking from sleep, or a setting made earlier, is noticed within
//   a minute.
// - Each alert worked out is kept before it is sent. Then it is handed to the
//   sender, the oldest first, one at a time. A send that fails is tried again
//   later (outbox.ts); one the server stopped in the middle of is tried again
//   after the restart, with the same id, so the phone shows it only once.
// - Nothing that goes wrong stops the server: it is logged, and the timer
//   looks again later.

// One alert as the sender gets it. The id is the same on every try of the
// same alert. The words are for the lock screen: without amounts unless the
// setting says so (10.10).
export interface OutgoingAlert {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  // When it came due, as an instant (ISO, UTC).
  readonly dueAt: string;
  // Sent later than the minute it came due, when that was, on his clock
  // ("Due 3:10 AM."; 10.8, B185); null otherwise.
  readonly due: string | null;
}

// The plug that sends an alert to the phone (web push comes later; tests use
// a fake). It resolves once the alert is handed over, and rejects when it
// could not be. It must show an id it has shown before only once: a repeat
// is a try the server could not mark as done.
export interface AlertSender {
  send(alert: OutgoingAlert): Promise<void>;
}

// npm run serve's plug until the phone's (web push) comes: each alert is
// written to the server's own window, and that counts as sent.
export function logSender(log: Log): AlertSender {
  return {
    send: (alert) => {
      log.info('alert', { title: alert.title, body: alert.body, ...(alert.due === null ? {} : { late: alert.due }), due: alert.dueAt });
      return Promise.resolve();
    },
  };
}

// What the timer works with: the books (Keeper).
export interface Alerter {
  // Works out every alert due now and keeps it (the book's history and the outbox).
  checkAlerts(): void;
  // Milliseconds until the next alert comes due by the clock alone; null when nothing is tracked yet.
  nextDueIn(): number | null;
  // Not sent yet and due to be tried now, the oldest first, as the phone is
  // to get them; none in quiet hours (10.8).
  toSend(): readonly OutgoingAlert[];
  // Milliseconds until the next try of something not sent yet (in quiet
  // hours, not before they end); null when all is sent.
  nextTryIn(): number | null;
  trying(key: string): void;
  sent(key: string): void;
  failed(key: string, why: string): void;
}

export class AlertTimer {
  readonly #alerter: Alerter;
  readonly #sender: AlertSender;
  readonly #clock: TimerClock;
  readonly #log: Log;
  #handle: unknown = null;
  #on = false;
  #running: Promise<void> | null = null;
  #again = false;
  // The last look could not work out the alerts: wait a minute before the next.
  #failing = false;

  constructor(input: { readonly alerter: Alerter; readonly sender: AlertSender; readonly clock: TimerClock; readonly log: Log }) {
    this.#alerter = input.alerter;
    this.#sender = input.sender;
    this.#clock = input.clock;
    this.#log = input.log;
  }

  // Looks at once: what came due while the server was down is worked out now.
  start(): void {
    if (this.#on) return;
    this.#on = true;
    this.#look();
  }

  // Something changed (a sync, an answer): looks now. While a send is on its
  // way, it looks again as soon as that is done.
  poke(): void {
    if (!this.#on) return;
    if (this.#running !== null) {
      this.#again = true;
      this.#check();
      return;
    }
    if (this.#handle !== null) this.#clock.clearTimeout(this.#handle);
    this.#look();
  }

  // Nothing is sent after this; a send on its way is waited for.
  async stop(): Promise<void> {
    this.#on = false;
    if (this.#handle !== null) this.#clock.clearTimeout(this.#handle);
    this.#handle = null;
    await this.#running;
  }

  // Resolves once no send of the timer's is on its way.
  async idle(): Promise<void> {
    while (this.#running !== null) await this.#running;
  }

  #check(): void {
    try {
      this.#alerter.checkAlerts();
      this.#failing = false;
    } catch (error) {
      this.#failing = true;
      this.#log.warn('alerts could not be worked out; it looks again later', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  #look(): void {
    this.#handle = null;
    if (!this.#on) return;
    this.#check();
    this.#again = false;
    this.#running = this.#sendDue().finally(() => {
      this.#running = null;
      if (!this.#on) return;
      if (this.#again) this.#look();
      else this.#sleep();
    });
  }

  async #sendDue(): Promise<void> {
    let rows: readonly OutgoingAlert[];
    try {
      rows = this.#alerter.toSend();
    } catch (error) {
      this.#log.warn('the outbox could not be read; it looks again later', { error: error instanceof Error ? error.message : String(error) });
      return;
    }
    for (const row of rows) {
      if (!this.#on) return;
      try {
        this.#alerter.trying(row.id);
        await this.#sender.send(row);
        this.#alerter.sent(row.id);
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        this.#log.warn('an alert could not be sent; it is tried again later', { alert: row.id, error: why });
        try {
          this.#alerter.failed(row.id, why);
        } catch (also) {
          this.#log.warn('a failed send could not be noted', { alert: row.id, error: also instanceof Error ? also.message : String(also) });
        }
      }
    }
  }

  #sleep(): void {
    let wait = LONGEST_SLEEP_MS;
    try {
      if (!this.#failing) for (const ms of [this.#alerter.nextDueIn(), this.#alerter.nextTryIn()]) if (ms !== null) wait = Math.min(wait, ms);
    } catch (error) {
      this.#log.warn('the timer could not work out when to look; it looks again in a minute', { error: error instanceof Error ? error.message : String(error) });
    }
    this.#handle = this.#clock.setTimeout(() => this.#look(), Math.max(0, wait));
  }
}
