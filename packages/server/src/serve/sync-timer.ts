import type { Log } from '../log.js';
import type { SyncResult } from '../sync/sync.js';

// npm run serve syncs with the bank by itself (Step 3, rulebook section 2):
// every 60 minutes to start, a setting. When it starts, it syncs at once if
// one is due.
// - The interval is real time, counted from the moment the last sync started
//   (Keeper.syncDueIn), so an hour is an hour across both clock changes: what
//   the clock on the wall says never comes into it.
// - It only ever calls Keeper.sync, the same sync as --sync: the calls that
//   read the bank (/transactions/sync, /accounts/get, /liabilities/get), never
//   /transactions/refresh, which costs money on the real plan.
// - Never two syncs at once: the books' own lock sees to that, for the timer
//   and --sync alike.
// - A sync that fails saves nothing, and the next one is one interval later.
// - It sleeps at most a minute at a time, so a computer waking from sleep, or
//   a setting made shorter, is noticed within a minute.
// - Nothing that goes wrong stops the server: it is logged, and the timer
//   looks again later.

export interface TimerClock {
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

// What the timer syncs: the books (Keeper), with the bank to sync with.
export interface Syncer {
  // Milliseconds until the next sync is due; 0 or less, due now; null while
  // there is nothing to sync with (no bank connection yet).
  syncDueIn(): number | null;
  sync(): Promise<SyncResult>;
}

export const LONGEST_SLEEP_MS = 60_000;

export class SyncTimer {
  readonly #syncer: Syncer;
  readonly #clock: TimerClock;
  readonly #log: Log;
  #handle: unknown = null;
  #on = false;
  #running: Promise<void> | null = null;

  constructor(input: { readonly syncer: Syncer; readonly clock: TimerClock; readonly log: Log }) {
    this.#syncer = input.syncer;
    this.#clock = input.clock;
    this.#log = input.log;
  }

  // Looks at once: a sync that is due runs now.
  start(): void {
    if (this.#on) return;
    this.#on = true;
    this.#look();
  }

  // No sync starts after this; one on its way is waited for.
  async stop(): Promise<void> {
    this.#on = false;
    if (this.#handle !== null) this.#clock.clearTimeout(this.#handle);
    this.#handle = null;
    await this.#running;
  }

  // Resolves once no sync of the timer's is on its way.
  async idle(): Promise<void> {
    await this.#running;
  }

  #look(): void {
    this.#handle = null;
    if (!this.#on) return;
    let due: number | null;
    try {
      due = this.#syncer.syncDueIn();
    } catch (error) {
      // Never out of a timer, where it would stop the server: it looks again in a minute.
      this.#log.warn('timer could not look; it looks again in a minute', { error: error instanceof Error ? error.message : String(error) });
      this.#sleep(LONGEST_SLEEP_MS);
      return;
    }
    if (due === null || due > 0) {
      this.#sleep(due === null ? LONGEST_SLEEP_MS : Math.min(due, LONGEST_SLEEP_MS));
      return;
    }
    let syncing: Promise<SyncResult>;
    try {
      syncing = this.#syncer.sync();
    } catch (error) {
      syncing = Promise.reject(error);
    }
    this.#running = syncing.then(
      (result) => {
        if (result.needsLogin) this.#log.warn('timer sync: the bank wants a new login (10.5)');
        else this.#log.info('timer sync', { added: result.added, modified: result.modified, removed: result.removed });
      },
      (error: unknown) => {
        // Nothing was saved; the next one is one interval later.
        this.#log.warn('timer sync failed; the next one is at the next time', { error: error instanceof Error ? error.message : String(error) });
      },
    );
    void this.#running.then(() => {
      this.#running = null;
      this.#look();
    });
  }

  #sleep(ms: number): void {
    this.#handle = this.#clock.setTimeout(() => this.#look(), Math.max(0, ms));
  }
}
