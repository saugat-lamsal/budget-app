import { describe, expect, it } from 'vitest';
import { throughTheServer } from './alerts-sim.js';

// Phase 5: the simulated you through the real server, one server for months
// (the way of living it is in alerts-sim.ts). Every name and number is made up.

const ONE_SERVER_YEARS = Number(process.env['ALERT_SIM_ONE_SERVER_YEARS'] ?? 0.4);

describe('Phase 5 the simulated you through the real server: every alert sent once, at its moment, and nothing else', () => {
  it('10.1 10.2 10.3 10.4 10.5 10.6 10.7 10.8 10.10 9.1 9.2 9.3 9.4 9.7 one server for months, over both clock changes: the phone failing now and then over the evening, syncs in the night held for quiet hours, the bank drifting for days, a login lasting days, a day the bank cannot be reached', async () => {
    const o = await throughTheServer(188, ONE_SERVER_YEARS, 'one-server');
    expect(o.days).toBe(Math.round(ONE_SERVER_YEARS * 365));
    expect(o.alerts).toBeGreaterThan(30);
    expect(o.late).toBeGreaterThan(0);
    expect(o.nightSyncs).toBeGreaterThan(5);
    expect(o.quietHeld).toBeGreaterThan(0);
    expect([...o.offsets].toSorted()).toEqual(['-04:00', '-05:00']);
    if (ONE_SERVER_YEARS >= 0.4) {
      expect(o.mismatches).toBe(2);
      expect(o.mismatchRepeats).toBeGreaterThanOrEqual(3);
      expect(o.loginRepeats).toBeGreaterThan(0);
      expect(o.notRead).toBeGreaterThanOrEqual(2);
      expect(o.heldBackDays).toBe(3);
    }
  }, 1_800_000);
});
