import type { AlertSender, OutgoingAlert } from '../src/serve/alert-timer.js';

// The phone, for the tests: the sending plug (Phase 5, part one). It shows
// each alert once, by its id, as a phone does with a notification's tag: an id
// it has shown already is a repeat, counted, and not shown again. It can be
// made to fail, as a phone that cannot be reached, and it notes the moment
// each alert reached it from the clock it is given.
export interface Shown extends OutgoingAlert {
  // When it reached the phone, as an instant.
  readonly at: string;
}

export class FakePhone implements AlertSender {
  readonly shown: Shown[] = [];
  readonly #ids = new Set<string>();
  // Sends of an id already shown (a try the server could not mark as done).
  repeats = 0;
  tries = 0;
  // While set, each send fails with this.
  failing: string | null = null;
  // For one send: what happens once it is handed over, before the server hears back.
  afterShowing: ((alert: OutgoingAlert) => void) | null = null;
  readonly #now: () => Date;

  constructor(now: () => Date) {
    this.#now = now;
  }

  async send(alert: OutgoingAlert): Promise<void> {
    this.tries += 1;
    await Promise.resolve();
    if (this.failing !== null) throw new Error(this.failing);
    if (this.#ids.has(alert.id)) this.repeats += 1;
    else {
      this.#ids.add(alert.id);
      this.shown.push({ ...alert, at: this.#now().toISOString() });
    }
    const after = this.afterShowing;
    this.afterShowing = null;
    after?.(alert);
  }

  ids(): string[] {
    return this.shown.map((s) => s.id);
  }
}
