import type { Log } from '../log.js';
import { EXIT } from './exit-codes.js';
import type { TimerClock } from './sync-timer.js';

// Phase 6: what keeps the hosted server and its backups running on the one
// machine (start.ts runs it). Two programs: Litestream, copying the books to
// R2 as they change, and the server. Litestream starts first and is kept
// running: if it stops, it is started again, a little later each time, and
// each time is in the log. The server is not started again if it stops by
// itself: it stopped for a reason (the history does not replay, 0.6, or a
// key is wrong), which the log says, with what to do. The books stay backed
// up meanwhile, and the uptime monitor sees the app down. Asked to stop (Fly
// stopping or replacing the machine), it stops the server first, so its last
// answer is saved, then Litestream, which copies that last change before it ends.

export interface Child {
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export interface SupervisorInput {
  readonly startServer: () => Child;
  readonly startLitestream: () => Child;
  readonly log: Log;
  readonly clock: TimerClock;
  readonly now?: () => number;
  // How long each may take to stop before it is made to; Fly's kill_timeout covers both.
  readonly stopWithin?: { readonly server: number; readonly litestream: number };
}

// After Litestream stops by itself: 5 s, then twice as long each time, at most a minute.
export const LITESTREAM_RETRY_MS = { first: 5_000, most: 60_000 } as const;
// Running this long without stopping counts as well again: the wait starts from 5 s.
const WELL_AFTER_MS = 10 * 60_000;

interface Running {
  readonly child: Child;
  readonly ended: Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>;
}

function run(child: Child): Running {
  return { child, ended: new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))) };
}

export class Supervisor {
  readonly #input: SupervisorInput;
  #litestream: Running | null = null;
  #server: Running | null = null;
  #stopping = false;
  #retryMs: number = LITESTREAM_RETRY_MS.first;
  #retry: unknown = null;
  #serverEnded: { readonly code: number | null } | null = null;

  constructor(input: SupervisorInput) {
    this.#input = input;
  }

  // Litestream first, so the server's first change is copied too.
  start(): void {
    this.#startLitestream();
    this.#server = run(this.#input.startServer());
    void this.#server.ended.then(({ code, signal }) => {
      this.#serverEnded = { code };
      if (this.#stopping) return;
      this.#input.log.error('the server stopped by itself; it is not started again, and the books are still copied to the backup', { code, signal, what: whatToDo(code) });
    });
  }

  // Whether the server is running (false once it stopped, for whatever reason).
  serverRunning(): boolean {
    return this.#server !== null && this.#serverEnded === null;
  }

  #startLitestream(): void {
    const now = this.#input.now ?? Date.now;
    const started = now();
    const running = run(this.#input.startLitestream());
    this.#litestream = running;
    void running.ended.then(({ code, signal }) => {
      if (this.#stopping || this.#litestream !== running) return;
      if (now() - started >= WELL_AFTER_MS) this.#retryMs = LITESTREAM_RETRY_MS.first;
      const wait = this.#retryMs;
      this.#retryMs = Math.min(this.#retryMs * 2, LITESTREAM_RETRY_MS.most);
      this.#input.log.error('Litestream stopped by itself: the books are not being copied to the backup; starting it again', { code, signal, inSeconds: wait / 1000 });
      this.#retry = this.#input.clock.setTimeout(() => {
        this.#retry = null;
        if (!this.#stopping) this.#startLitestream();
      }, wait);
    });
  }

  // The server first, then Litestream; each made to stop if it takes too long.
  async stop(): Promise<void> {
    if (this.#stopping) return;
    this.#stopping = true;
    if (this.#retry !== null) this.#input.clock.clearTimeout(this.#retry);
    const within = this.#input.stopWithin ?? { server: 20_000, litestream: 35_000 };
    if (this.#server !== null && this.#serverEnded === null) await this.#stopOne(this.#server, within.server);
    if (this.#litestream !== null) await this.#stopOne(this.#litestream, within.litestream);
  }

  async #stopOne(running: Running, within: number): Promise<void> {
    running.child.kill('SIGTERM');
    let timer: unknown = null;
    const late = new Promise<'late'>((resolve) => {
      timer = this.#input.clock.setTimeout(() => resolve('late'), within);
    });
    const how = await Promise.race([running.ended.then(() => 'ended' as const), late]);
    this.#input.clock.clearTimeout(timer);
    if (how === 'late') {
      running.child.kill('SIGKILL');
      await running.ended;
    }
  }
}

// What the log says to do about a server that stopped by itself.
export function whatToDo(code: number | null): string {
  if (code === EXIT.historyDoesNotReplay) return 'the history does not replay to the totals saved with it (0.6): fly ssh console, then node /app/serve/replay-check.mjs; then fly machine restart';
  if (code === EXIT.didNotStart) return 'it could not start: the line above says why (a missing or wrong secret); fix it with fly secrets set, which restarts it';
  return 'it stopped unexpectedly: the lines above say why; fly machine restart starts it again';
}
