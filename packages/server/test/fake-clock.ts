import type { TimerClock } from '../src/serve/sync-timer.js';

// A clock for the timer's tests: time moves only when a test moves it, and
// each timer runs when its moment comes. The books read the same clock (a
// life's now), so "an hour later" is exact. Real time is never waited for.
export class FakeClock implements TimerClock {
  readonly #timers = new Map<number, { readonly at: number; readonly run: () => void }>();
  readonly #clock: { now: Date };
  #next = 1;

  constructor(clock: { now: Date }) {
    this.#clock = clock;
  }

  get now(): Date {
    return this.#clock.now;
  }

  setTimeout(run: () => void, ms: number): unknown {
    const id = this.#next;
    this.#next += 1;
    this.#timers.set(id, { at: this.#clock.now.getTime() + ms, run });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.#timers.delete(handle as number);
  }

  // How many timers are set.
  get waiting(): number {
    return this.#timers.size;
  }

  // Moves the clock on by ms, running each timer at its moment, oldest first,
  // and after each one waiting for what it started (settle).
  async advance(ms: number, settle: () => Promise<void>): Promise<void> {
    const end = this.#clock.now.getTime() + ms;
    for (;;) {
      let first: [number, { readonly at: number; readonly run: () => void }] | undefined;
      for (const entry of this.#timers) if (entry[1].at <= end && (first === undefined || entry[1].at < first[1].at)) first = entry;
      if (first === undefined) break;
      this.#timers.delete(first[0]);
      if (first[1].at > this.#clock.now.getTime()) this.#clock.now = new Date(first[1].at);
      first[1].run();
      await settle();
    }
    this.#clock.now = new Date(end);
  }
}
