import { afterEach, describe, expect, it } from 'vitest';
import { instantIn, isTimeZone, timeIn, todayIn } from '../src/history/today.js';

// Rulebook section 2, the home time zone: the app's today is the date in his
// home time zone, never in the server's own clock zone. Checked one second
// either side of midnight, and on both days the clocks change in New York in
// 2026: Mar 8 (2:00 becomes 3:00) and Nov 1 (2:00 becomes 1:00 again).

const NY = 'America/New_York';
const at = (iso: string): Date => new Date(iso);

describe('section 2 today is the date in his home time zone', () => {
  const tz = process.env['TZ'];
  afterEach(() => {
    if (tz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = tz;
  });

  it('section 2 one second before midnight in New York it is still the day before, though it is already the next day in UTC', () => {
    expect(todayIn(NY, at('2026-10-10T03:59:59Z'))).toBe('2026-10-09');
    expect(todayIn(NY, at('2026-10-10T04:00:00Z'))).toBe('2026-10-10');
    expect(timeIn(NY, at('2026-10-10T03:59:59Z'))).toBe('2026-10-09T23:59:59-04:00');
    expect(timeIn(NY, at('2026-10-10T04:00:00Z'))).toBe('2026-10-10T00:00:00-04:00');
    // The same moments in another home time zone.
    expect(todayIn('America/Chicago', at('2026-10-10T04:00:00Z'))).toBe('2026-10-09');
    expect(todayIn('America/Chicago', at('2026-10-10T05:00:00Z'))).toBe('2026-10-10');
  });

  it('section 2 the spring change (Mar 8, 2026): midnight before it is at 5:00 UTC, after it at 4:00; the clock jumps from 1:59:59 to 3:00', () => {
    expect(todayIn(NY, at('2026-03-08T04:59:59Z'))).toBe('2026-03-07');
    expect(todayIn(NY, at('2026-03-08T05:00:00Z'))).toBe('2026-03-08');
    expect(timeIn(NY, at('2026-03-08T06:59:59Z'))).toBe('2026-03-08T01:59:59-05:00');
    expect(timeIn(NY, at('2026-03-08T07:00:00Z'))).toBe('2026-03-08T03:00:00-04:00');
    expect(todayIn(NY, at('2026-03-09T03:59:59Z'))).toBe('2026-03-08');
    expect(todayIn(NY, at('2026-03-09T04:00:00Z'))).toBe('2026-03-09');
  });

  it('section 2 the fall change (Nov 1, 2026): the hour from 1:00 comes twice, all of it the same day; the next midnight is at 5:00 UTC', () => {
    expect(timeIn(NY, at('2026-11-01T05:59:59Z'))).toBe('2026-11-01T01:59:59-04:00');
    expect(timeIn(NY, at('2026-11-01T06:00:00Z'))).toBe('2026-11-01T01:00:00-05:00');
    expect(todayIn(NY, at('2026-11-01T05:59:59Z'))).toBe('2026-11-01');
    expect(todayIn(NY, at('2026-11-01T06:00:00Z'))).toBe('2026-11-01');
    expect(todayIn(NY, at('2026-11-01T03:59:59Z'))).toBe('2026-10-31');
    expect(todayIn(NY, at('2026-11-02T04:59:59Z'))).toBe('2026-11-01');
    expect(todayIn(NY, at('2026-11-02T05:00:00Z'))).toBe('2026-11-02');
  });

  it("section 2 the server's own clock zone changes nothing", () => {
    const moments = ['2026-10-10T03:59:59Z', '2026-10-10T04:00:00Z', '2026-03-08T07:00:00Z', '2026-11-01T06:00:00Z'];
    const inNewYork = moments.map((m) => [todayIn(NY, at(m)), timeIn(NY, at(m))]);
    for (const serverZone of ['UTC', 'Asia/Tokyo', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Los_Angeles']) {
      process.env['TZ'] = serverZone;
      expect(moments.map((m) => [todayIn(NY, at(m)), timeIn(NY, at(m))]), serverZone).toEqual(inNewYork);
    }
  });

  it('section 2 a zone at UTC itself writes its offset as +00:00', () => {
    expect(timeIn('UTC', at('2026-10-10T04:00:00Z'))).toBe('2026-10-10T04:00:00+00:00');
    expect(timeIn('Asia/Kathmandu', at('2026-10-10T04:00:00Z'))).toBe('2026-10-10T09:45:00+05:45');
  });

  it('section 2 only a time zone this computer knows is one', () => {
    expect([NY, 'America/Phoenix', 'Pacific/Honolulu', 'UTC'].every(isTimeZone)).toBe(true);
    expect(['', 'New York', 'Mars/Olympus_Mons'].some(isTimeZone)).toBe(false);
  });
});

// Phase 5: the moment a time of day comes on a date in his home time zone,
// for the evening's alerts (the daily review time, section 2).
describe('section 2 a time of day in his home time zone, as a moment', () => {
  it('section 2 8:00 PM in New York is 00:00 UTC the next day in summer time, 01:00 in winter time', () => {
    expect(instantIn(NY, '2026-10-10', '20:00').toISOString()).toBe('2026-10-11T00:00:00.000Z');
    expect(instantIn(NY, '2026-12-24', '20:00').toISOString()).toBe('2026-12-25T01:00:00.000Z');
    expect(instantIn('America/Los_Angeles', '2026-10-10', '20:00').toISOString()).toBe('2026-10-11T03:00:00.000Z');
    expect(instantIn('UTC', '2026-10-10', '08:05').toISOString()).toBe('2026-10-10T08:05:00.000Z');
  });

  it('section 2 on the days the clocks change, 8:00 PM is still 8:00 PM on the clock', () => {
    expect(instantIn(NY, '2026-11-01', '20:00').toISOString()).toBe('2026-11-02T01:00:00.000Z');
    expect(instantIn(NY, '2027-03-14', '20:00').toISOString()).toBe('2027-03-15T00:00:00.000Z');
    expect(instantIn(NY, '2026-03-08', '00:00').toISOString()).toBe('2026-03-08T05:00:00.000Z');
  });

  it('section 2 a time the clock shows twice (1:30 AM on Nov 1) is the first of the two; one it skips (2:30 AM on Mar 14) is the moment it jumps', () => {
    expect(instantIn(NY, '2026-11-01', '01:30').toISOString()).toBe('2026-11-01T05:30:00.000Z');
    expect(timeIn(NY, instantIn(NY, '2026-11-01', '01:30'))).toBe('2026-11-01T01:30:00-04:00');
    expect(instantIn(NY, '2027-03-14', '02:30').toISOString()).toBe('2027-03-14T07:00:00.000Z');
    expect(timeIn(NY, instantIn(NY, '2027-03-14', '02:30'))).toBe('2027-03-14T03:00:00-04:00');
    expect(instantIn(NY, '2027-03-14', '01:59').toISOString()).toBe('2027-03-14T06:59:00.000Z');
    expect(instantIn(NY, '2027-03-14', '03:00').toISOString()).toBe('2027-03-14T07:00:00.000Z');
  });

  it('section 2 the date in the zone at that moment is the date asked for, every day of a year', () => {
    for (let day = 0; day < 366; day += 1) {
      const date = new Date(Date.UTC(2026, 9, 1 + day)).toISOString().slice(0, 10);
      for (const time of ['00:00', '08:00', '20:00', '23:59']) expect(todayIn(NY, instantIn(NY, date, time))).toBe(date);
    }
  });
});
