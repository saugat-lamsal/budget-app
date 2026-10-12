import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { memoryLog, type LogLine } from '../src/log.js';
import { EXIT } from '../src/serve/exit-codes.js';
import { LITESTREAM_RETRY_MS, Supervisor, whatToDo, type Child } from '../src/serve/supervisor.js';
import { FakeClock } from './fake-clock.js';

// Phase 6: the supervisor that keeps the hosted server and Litestream running
// on the one machine. Here the two programs are stand-ins that end when told
// to (or not), so every way they can end is tried, on a clock the test moves.
// The real programs together: start.test.ts (Linux).

class StandIn extends EventEmitter implements Child {
  readonly name: string;
  readonly signals: string[] = [];
  // Ends by itself when sent SIGTERM (as both real ones do), unless told to hang.
  hangs = false;
  ended = false;

  readonly order: string[];

  constructor(name: string, order: string[]) {
    super();
    this.name = name;
    this.order = order;
    order.push(`${name} started`);
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal);
    this.order.push(`${this.name} ${signal}`);
    if (signal === 'SIGKILL' || !this.hangs) queueMicrotask(() => this.end(signal === 'SIGKILL' ? null : 0, signal));
    return true;
  }

  end(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.ended) return;
    this.ended = true;
    this.order.push(`${this.name} ended`);
    this.emit('exit', code, signal);
  }
}

function setUp() {
  const order: string[] = [];
  const servers: StandIn[] = [];
  const litestreams: StandIn[] = [];
  const lines: LogLine[] = [];
  const clock = { now: new Date('2026-10-12T16:00:00Z') };
  const fake = new FakeClock(clock);
  const supervisor = new Supervisor({
    startServer: () => {
      const s = new StandIn('server', order);
      servers.push(s);
      return s;
    },
    startLitestream: () => {
      const l = new StandIn('litestream', order);
      litestreams.push(l);
      return l;
    },
    log: memoryLog(lines),
    clock: fake,
    now: () => clock.now.getTime(),
    stopWithin: { server: 20_000, litestream: 35_000 },
  });
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  };
  return { supervisor, order, servers, litestreams, lines, fake, settle };
}

describe('Phase 6 the supervisor on the one machine', () => {
  it('Phase 6 Litestream starts first, then the server, so the server\'s first change is copied too', () => {
    const { supervisor, order } = setUp();
    supervisor.start();
    expect(order).toEqual(['litestream started', 'server started']);
    expect(supervisor.serverRunning()).toBe(true);
  });

  it('Phase 6 asked to stop, it stops the server first and waits for it, then Litestream, so the last answer is saved and then copied', async () => {
    const { supervisor, order, servers, litestreams } = setUp();
    supervisor.start();
    await supervisor.stop();
    expect(order).toEqual(['litestream started', 'server started', 'server SIGTERM', 'server ended', 'litestream SIGTERM', 'litestream ended']);
    expect(servers[0]?.signals).toEqual(['SIGTERM']);
    expect(litestreams[0]?.signals).toEqual(['SIGTERM']);
    // Asked twice, it stops once.
    await supervisor.stop();
    expect(order).toHaveLength(6);
  });

  it('Phase 6 one that does not stop in time is made to: the server after 20 s, Litestream after 35 s (Fly waits 60)', async () => {
    const { supervisor, order, servers, litestreams, fake, settle } = setUp();
    supervisor.start();
    const server = servers[0] as StandIn;
    const litestream = litestreams[0] as StandIn;
    server.hangs = true;
    litestream.hangs = true;
    const stopped = supervisor.stop();
    await settle();
    await fake.advance(19_999, settle);
    expect(server.signals).toEqual(['SIGTERM']);
    await fake.advance(1, settle);
    expect(server.signals).toEqual(['SIGTERM', 'SIGKILL']);
    await settle();
    expect(litestream.signals).toEqual(['SIGTERM']);
    await fake.advance(34_999, settle);
    expect(litestream.signals).toEqual(['SIGTERM']);
    await fake.advance(1, settle);
    await stopped;
    expect(order).toEqual(['litestream started', 'server started', 'server SIGTERM', 'server SIGKILL', 'server ended', 'litestream SIGTERM', 'litestream SIGKILL', 'litestream ended']);
  });

  it('Phase 6 Litestream that stops by itself is started again: after 5 s, then twice as long each time, at most a minute, and each time is in the log', async () => {
    const { supervisor, litestreams, lines, fake, settle } = setUp();
    supervisor.start();
    const waits: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      (litestreams[i] as StandIn).end(1);
      await settle();
      const line = lines.at(-1);
      expect(line?.level).toBe('error');
      expect(line?.event).toBe('Litestream stopped by itself: the books are not being copied to the backup; starting it again');
      const wait = (line?.fields as { inSeconds: number }).inSeconds * 1000;
      waits.push(wait);
      await fake.advance(wait - 1, settle);
      expect(litestreams).toHaveLength(i + 1);
      await fake.advance(1, settle);
      expect(litestreams).toHaveLength(i + 2);
    }
    expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
    expect(LITESTREAM_RETRY_MS).toEqual({ first: 5_000, most: 60_000 });
    // After running well for 10 minutes, the wait starts from 5 s again.
    await fake.advance(10 * 60_000, settle);
    (litestreams.at(-1) as StandIn).end(1);
    await settle();
    expect((lines.at(-1)?.fields as { inSeconds: number }).inSeconds).toBe(5);
    expect(supervisor.serverRunning()).toBe(true);
  });

  it('Phase 6 Litestream is not started again once it is asked to stop, nor while it waits to be', async () => {
    const { supervisor, litestreams, fake, settle } = setUp();
    supervisor.start();
    (litestreams[0] as StandIn).end(1);
    await settle();
    await supervisor.stop();
    await fake.advance(120_000, settle);
    expect(litestreams).toHaveLength(1);
    expect(fake.waiting).toBe(0);
  });

  it('Phase 6 a server that stops by itself is not started again; Litestream goes on copying the books; the log says what to do', async () => {
    for (const [code, words] of [
      [EXIT.historyDoesNotReplay, 'the history does not replay to the totals saved with it (0.6): fly ssh console, then node /app/serve/replay-check.mjs; then fly machine restart'],
      [EXIT.didNotStart, 'it could not start: the line above says why (a missing or wrong secret); fix it with fly secrets set, which restarts it'],
      [EXIT.failed, 'it stopped unexpectedly: the lines above say why; fly machine restart starts it again'],
      [null, 'it stopped unexpectedly: the lines above say why; fly machine restart starts it again'],
    ] as const) {
      const { supervisor, servers, litestreams, lines, fake, settle, order } = setUp();
      supervisor.start();
      (servers[0] as StandIn).end(code, code === null ? 'SIGSEGV' : null);
      await settle();
      expect(supervisor.serverRunning()).toBe(false);
      expect(lines.at(-1)).toEqual({ level: 'error', event: 'the server stopped by itself; it is not started again, and the books are still copied to the backup', fields: { code, signal: code === null ? 'SIGSEGV' : null, what: words } });
      expect(whatToDo(code)).toBe(words);
      await fake.advance(60 * 60_000, settle);
      expect(servers).toHaveLength(1);
      expect((litestreams[0] as StandIn).ended).toBe(false);
      // Stopping then stops Litestream only.
      await supervisor.stop();
      expect(order.slice(-2)).toEqual(['litestream SIGTERM', 'litestream ended']);
    }
  });
});
