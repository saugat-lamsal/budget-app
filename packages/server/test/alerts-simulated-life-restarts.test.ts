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
});
