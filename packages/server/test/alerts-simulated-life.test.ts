import { describe, expect, it } from 'vitest';
import { throughTheServer } from './alerts-sim.js';

// Phase 5, part one: the simulated you through the real server, one server
// for months (the way of living it is in alerts-sim.ts). Every name and number
// is made up.

const ONE_SERVER_YEARS = Number(process.env['ALERT_SIM_ONE_SERVER_YEARS'] ?? 0.4);

describe('Phase 5 the simulated you through the real server: every alert sent once, at its moment, and nothing else', () => {
  it('10.1 10.2 10.3 10.6 9.1 9.2 9.3 9.4 one server for months, over both clock changes: the phone failing now and then over the evening, syncs in the night', async () => {
    const o = await throughTheServer(188, ONE_SERVER_YEARS, 'one-server');
    expect(o.days).toBe(Math.round(ONE_SERVER_YEARS * 365));
    expect(o.alerts).toBeGreaterThan(30);
    expect(o.late).toBeGreaterThan(0);
    expect(o.nightSyncs).toBeGreaterThan(5);
    expect([...o.offsets].toSorted()).toEqual(['-04:00', '-05:00']);
  }, 1_800_000);
});
