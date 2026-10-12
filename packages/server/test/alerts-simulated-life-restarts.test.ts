import { describe, expect, it } from 'vitest';
import { throughTheServer } from './alerts-sim.js';

// Phase 5: the simulated you through the real server, stopped every night and
// started every morning (the way of living it is in alerts-sim.ts).
// ALERT_SIM_SEEDS, ALERT_SIM_FIRST_SEED and ALERT_SIM_YEARS run more. Every
// name and number is made up.

const FIRST_SEED = Number(process.env['ALERT_SIM_FIRST_SEED'] ?? 12);
const SEEDS = Number(process.env['ALERT_SIM_SEEDS'] ?? 1);
const YEARS = Number(process.env['ALERT_SIM_YEARS'] ?? 0.43);

describe('Phase 5 the simulated you through the real server: every alert sent once, at its moment, and nothing else', () => {
  it.each(Array.from({ length: SEEDS }, (_, i) => FIRST_SEED + i))(
    '0.6 10.4 10.5 10.7 10.8 10.9 the server stopped every night and started every morning, down over the evening now and then and over several evenings, back in the night, syncs failing, a login lasting days, the bank drifting for days: seed %i',
    async (seed) => {
      const o = await throughTheServer(seed, YEARS, 'restarts');
      if (process.env['ALERT_SIM_SHOW'] !== undefined) console.log(JSON.stringify({ ...o, offsets: [...o.offsets] }));
      expect(o.days).toBe(Math.round(YEARS * 365));
      expect(o.restarts).toBeGreaterThan(o.days);
      expect(o.late).toBeGreaterThan(0);
      expect(o.failedSyncs).toBeGreaterThan(0);
      expect(o.logins).toBeGreaterThan(0);
      if (YEARS >= 0.43) {
        // Three evenings down at once, and back in the night now and then.
        expect(o.mostEveningsAtOnce).toBe(4);
        expect(o.backInTheNight).toBeGreaterThan(0);
        expect(o.quietHeld).toBeGreaterThan(0);
        expect(o.notRead).toBeGreaterThanOrEqual(4);
        expect(o.loginRepeats).toBe(2);
        expect(o.mismatches).toBe(1);
        expect(o.mismatchRepeats).toBe(2);
        expect(o.heldBackDays).toBe(10);
      }
      if (seed === 12 && YEARS >= 0.43) expect([...o.offsets].toSorted()).toEqual(['-04:00', '-05:00']);
    },
    1_800_000,
  );

  // Found by the long run (Oct 12, seeds 1033 and 1041): a setup day with
  // little starting money leaves needs below zero and wants at zero, so both
  // empty alerts are due the moment tracking starts. The simulated life
  // expected them; this way of living it had left setup day's alerts out.
  it('10.1 10.2 setup day leaves needs below zero and wants at zero: both empty alerts, once, the moment the server first looks: seed 1033', async () => {
    const o = await throughTheServer(1033, 0.05, 'restarts');
    expect(o.days).toBe(18);
    expect(o.alerts).toBeGreaterThanOrEqual(2);
  }, 600_000);

  // Found by the long run too (seed 1034): the bank cannot be read on the day
  // the clocks go forward (Mar 14, 2027, a 23-hour day), so the last good read,
  // 9:00 PM the night before, is 24 hours old at 10:00 PM, in quiet hours. The
  // server keeps it, stops for the night at 11:00 PM, and sends it the moment
  // it is back at 7:30 AM (10.7, 10.8).
  it('10.7 10.8 not read for 24 hours, due in quiet hours on the night the clocks go forward, with the server stopped when they end: sent the moment it is back: seed 1034', async () => {
    const o = await throughTheServer(1034, 0.14, 'restarts');
    expect(o.days).toBe(51);
    expect(o.notRead).toBeGreaterThanOrEqual(1);
    expect(o.quietHeld).toBeGreaterThanOrEqual(1);
    expect([...o.offsets].toSorted()).toEqual(['-04:00', '-05:00']);
  }, 600_000);
});
