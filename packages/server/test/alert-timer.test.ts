import { describe, expect, it } from 'vitest';
import { memoryLog, type LogLine } from '../src/log.js';
import { retryAfterMs, type OutboxRow } from '../src/alerts/outbox.js';
import { AlertTimer, type Alerter } from '../src/serve/alert-timer.js';
import { LONGEST_SLEEP_MS } from '../src/serve/sync-timer.js';
import { FakeClock } from './fake-clock.js';
import { FakePhone } from './fake-phone.js';

// Phase 5, part one: the timer that works out the alerts and sends them
// (serve/alert-timer.ts), with a clock the test moves, a made-up outbox, and
// the fake phone. The real books behind it are tested with the simulated life
// (alerts-simulated-life.test.ts). Every name is made up.

class MadeUpOutbox implements Alerter {
  readonly rows: { key: string; dueAt: string; sentAt: string | null; tries: number; nextTryAt: string; lastError: string | null }[] = [];
  checks = 0;
  checkThrows = false;
  // The next evening's moment, as an instant in ms; null before the start.
  evening: number | null = null;
  readonly #now: () => Date;

  constructor(now: () => Date) {
    this.#now = now;
  }

  add(key: string): void {
    const at = this.#now().toISOString();
    this.rows.push({ key, dueAt: at, sentAt: null, tries: 0, nextTryAt: at, lastError: null });
  }

  checkAlerts(): void {
    this.checks += 1;
    if (this.checkThrows) throw new Error('the books cannot be read');
    if (this.evening !== null && this.evening <= this.#now().getTime()) {
      this.add(`evening ${new Date(this.evening).toISOString()}`);
      this.evening += 86_400_000;
    }
  }

  nextEveningIn(): number | null {
    return this.evening === null ? null : this.evening - this.#now().getTime();
  }

  toSend(): readonly OutboxRow[] {
    const now = this.#now().toISOString();
    return this.rows
      .filter((r) => r.sentAt === null && r.nextTryAt <= now)
      .map((r) => ({ key: r.key, seq: 1, kind: 'daily-review', title: `title ${r.key}`, body: 'body', dueAt: r.dueAt, createdAt: r.dueAt, sentAt: null, tries: r.tries, lastTryAt: null, nextTryAt: r.nextTryAt, lastError: r.lastError }));
  }

  nextTryIn(): number | null {
    const waiting = this.rows.filter((r) => r.sentAt === null).map((r) => Date.parse(r.nextTryAt) - this.#now().getTime());
    return waiting.length === 0 ? null : Math.min(...waiting);
  }

  #row(key: string) {
    const row = this.rows.find((r) => r.key === key);
    if (row === undefined) throw new Error(`no ${key}`);
    return row;
  }

  trying(key: string): void {
    this.#row(key).tries += 1;
  }

  sent(key: string): void {
    this.#row(key).sentAt = this.#now().toISOString();
  }

  failed(key: string, why: string): void {
    const row = this.#row(key);
    row.lastError = why;
    row.nextTryAt = new Date(this.#now().getTime() + retryAfterMs(row.tries)).toISOString();
  }
}

function setUp(start = '2026-10-10T12:00:00Z') {
  const clock = { now: new Date(start) };
  const fake = new FakeClock(clock);
  const outbox = new MadeUpOutbox(() => clock.now);
  const phone = new FakePhone(() => clock.now);
  const lines: LogLine[] = [];
  const timer = new AlertTimer({ alerter: outbox, sender: phone, clock: fake, log: memoryLog(lines) });
  const advance = (ms: number): Promise<void> => fake.advance(ms, () => timer.idle());
  return { clock, fake, outbox, phone, lines, timer, advance };
}

describe('Phase 5 the alert timer', () => {
  it('Phase 5 it looks at once when it starts, and sends what is due, oldest first, each noted as sent', async () => {
    const t = setUp();
    t.outbox.add('first');
    t.outbox.add('second');
    t.timer.start();
    await t.timer.idle();
    expect(t.outbox.checks).toBe(1);
    expect(t.phone.ids()).toEqual(['first', 'second']);
    expect(t.outbox.rows.map((r) => [r.key, r.sentAt, r.tries])).toEqual([
      ['first', '2026-10-10T12:00:00.000Z', 1],
      ['second', '2026-10-10T12:00:00.000Z', 1],
    ]);
    await t.timer.stop();
  });

  it('Phase 5 poked after a change, it works the alerts out and sends them in the same moment', async () => {
    const t = setUp();
    t.timer.start();
    await t.timer.idle();
    await t.advance(5 * 60_000 + 7_000);
    t.outbox.add('made by a sync');
    t.timer.poke();
    await t.timer.idle();
    expect(t.phone.shown.map((s) => [s.id, s.at])).toEqual([['made by a sync', '2026-10-10T12:05:07.000Z']]);
    await t.timer.stop();
  });

  it('Phase 5 a send that fails is tried again after a minute, then twice as long each time, at most an hour apart, and arrives once', async () => {
    const t = setUp();
    t.outbox.add('stuck');
    t.phone.failing = 'the phone cannot be reached';
    t.timer.start();
    await t.timer.idle();
    const tries: string[] = [];
    for (let minute = 0; minute < 300 && t.outbox.rows[0]!.tries < 9; minute += 1) {
      const before = t.outbox.rows[0]!.tries;
      await t.advance(60_000);
      if (t.outbox.rows[0]!.tries !== before) tries.push(t.clock.now.toISOString().slice(11, 16));
    }
    // Tried at 12:00, then after 1, 2, 4, 8, 16, 32, 60 and 60 minutes.
    expect(tries).toEqual(['12:01', '12:03', '12:07', '12:15', '12:31', '13:03', '14:03', '15:03']);
    expect(t.outbox.rows[0]?.lastError).toBe('the phone cannot be reached');
    expect(t.phone.shown).toEqual([]);
    t.phone.failing = null;
    await t.advance(60 * 60_000);
    expect(t.phone.ids()).toEqual(['stuck']);
    expect(t.phone.repeats).toBe(0);
    expect(retryAfterMs(1)).toBe(60_000);
    expect(retryAfterMs(7)).toBe(3_600_000);
    expect(retryAfterMs(1_000)).toBe(3_600_000);
    await t.timer.stop();
  });

  it('Phase 5 it wakes at the evening\'s moment, and otherwise looks at least once a minute', async () => {
    const t = setUp('2026-10-10T23:58:30Z');
    t.outbox.evening = Date.parse('2026-10-11T00:00:00Z');
    t.timer.start();
    await t.timer.idle();
    await t.advance(90_000);
    expect(t.phone.shown.map((s) => [s.id, s.at])).toEqual([['evening 2026-10-11T00:00:00.000Z', '2026-10-11T00:00:00.000Z']]);
    const checks = t.outbox.checks;
    await t.advance(10 * 60_000);
    expect(t.outbox.checks - checks).toBe(10);
    expect(LONGEST_SLEEP_MS).toBe(60_000);
    await t.timer.stop();
  });

  it('Phase 5 alerts that cannot be worked out do not stop it: logged, and it looks again in a minute', async () => {
    const t = setUp();
    t.outbox.checkThrows = true;
    t.outbox.evening = Date.parse('2026-10-10T11:00:00Z');
    t.timer.start();
    await t.timer.idle();
    await t.advance(59_000);
    expect(t.outbox.checks).toBe(1);
    await t.advance(1_000);
    expect(t.outbox.checks).toBe(2);
    expect(t.lines.some((l) => l.event.includes('could not be worked out'))).toBe(true);
    t.outbox.checkThrows = false;
    await t.advance(60_000);
    expect(t.phone.ids()).toEqual(['evening 2026-10-10T11:00:00.000Z']);
    await t.timer.stop();
  });

  it('Phase 5 a poke while a send is on its way looks again right after it', async () => {
    const t = setUp();
    t.outbox.add('first');
    t.phone.afterShowing = () => {
      t.outbox.add('second');
      t.timer.poke();
    };
    t.timer.start();
    await t.timer.idle();
    expect(t.phone.ids()).toEqual(['first', 'second']);
    expect(t.outbox.checks).toBeGreaterThanOrEqual(2);
    await t.timer.stop();
  });

  it('Phase 5 stopped, it waits for the send on its way and sends nothing more', async () => {
    const t = setUp();
    t.outbox.add('first');
    t.outbox.add('second');
    let stopping: Promise<void> | null = null;
    t.phone.afterShowing = () => {
      stopping = t.timer.stop();
    };
    t.timer.start();
    await t.timer.idle();
    await stopping;
    expect(t.phone.ids()).toEqual(['first']);
    expect(t.outbox.rows.map((r) => r.sentAt !== null)).toEqual([true, false]);
    expect(t.fake.waiting).toBe(0);
    t.timer.poke();
    expect(t.phone.ids()).toEqual(['first']);
  });
});
