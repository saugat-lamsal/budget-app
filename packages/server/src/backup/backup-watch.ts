import type { IncomingHttpHeaders } from 'node:http';

// QUESTIONS.md A43, option 5: how he hears that the backups have stopped.
// Litestream calls the beat address about once a minute, but only while every
// copy of the books has gone through (its heartbeat, litestream.yml). The
// address is this server's own, on the same machine (heartbeatUrl in
// backup.ts): the call never leaves it. /health/backups says "not ok" once
// none has come for 10 minutes, and a second uptime monitor watches it. Only
// the hosted server has the watch: on a computer there is no backup.

export const BACKUP_HEALTH_PATH = '/health/backups';
export const BACKUP_BEAT_PATH = '/health/backups/beat';

// Litestream beats every minute (litestream.yml), so a missed beat or two is
// no alarm. Litestream starts before the server, and beats only after its
// first copies: the same 10 minutes from the server's start.
export const BACKUP_SILENCE_MS = 10 * 60_000;

export class BackupWatch {
  readonly #now: () => number;
  readonly #since: number;
  #last: number | null = null;

  constructor(now: () => number) {
    this.#now = now;
    this.#since = now();
  }

  beat(): void {
    this.#last = this.#now();
  }

  get lastBeat(): number | null {
    return this.#last;
  }

  // Ok while the last beat (or the start, before the first) is less than 10
  // minutes old. A clock that goes back counts from the newest it saw.
  healthy(): boolean {
    return this.#now() - (this.#last ?? this.#since) < BACKUP_SILENCE_MS;
  }
}

// Fly's proxy says where a request came from, and adds these; a request that
// passed through it is from outside, whatever address it seems to come from.
const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-proto', 'fly-client-ip', 'fly-forwarded-port', 'via'];
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// A beat is taken only from this machine (Litestream, beside the server), straight to its port.
export function fromThisMachine(remoteAddress: string | undefined, headers: IncomingHttpHeaders): boolean {
  if (remoteAddress === undefined || !LOOPBACK.has(remoteAddress)) return false;
  return PROXY_HEADERS.every((name) => headers[name] === undefined);
}
