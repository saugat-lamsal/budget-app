import { describe, expect, it } from 'vitest';
import { FakeClock } from './fake-clock.js';

// The clock the timer tests move. A timer that keeps setting itself again for
// the same moment never lets the clock move, and the test's own time limit
// can never fire (it all runs as promises): break-it found a break that did
// that and held a worker for hours (Oct 11). It fails at once instead.

describe('the fake clock for the timer tests', () => {
  it('runs each timer at its moment, in order, and ends at the moment asked for', async () => {
    const clock = { now: new Date('2026-10-02T12:00:00Z') };
    const fake = new FakeClock(clock);
    const ran: string[] = [];
    fake.setTimeout(() => ran.push(`b ${clock.now.toISOString()}`), 2_000);
    fake.setTimeout(() => ran.push(`a ${clock.now.toISOString()}`), 1_000);
    await fake.advance(5_000, () => Promise.resolve());
    expect(ran).toEqual(['a 2026-10-02T12:00:01.000Z', 'b 2026-10-02T12:00:02.000Z']);
    expect(clock.now.toISOString()).toBe('2026-10-02T12:00:05.000Z');
  });

  it('a timer that keeps setting itself again for the same moment fails at once, saying when', async () => {
    const clock = { now: new Date('2026-10-03T11:00:00Z') };
    const fake = new FakeClock(clock);
    const again = (): void => {
      fake.setTimeout(again, 0);
    };
    fake.setTimeout(again, 0);
    await expect(fake.advance(60_000, () => Promise.resolve())).rejects.toThrow('the timers keep firing at 2026-10-03T11:00:00.000Z without the clock moving');
  });

  it('many timers at one moment, each once, are fine', async () => {
    const clock = { now: new Date('2026-10-03T11:00:00Z') };
    const fake = new FakeClock(clock);
    let ran = 0;
    for (let i = 0; i < FakeClock.MOST_AT_ONE_MOMENT; i += 1) fake.setTimeout(() => (ran += 1), 0);
    await fake.advance(0, () => Promise.resolve());
    expect(ran).toBe(FakeClock.MOST_AT_ONE_MOMENT);
  });
});
