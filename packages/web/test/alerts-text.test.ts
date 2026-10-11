import { describe, expect, it } from 'vitest';
import { alertCountText, alertMomentText, alertWhenText, alertsRowText } from '../src/screens/alerts-text.js';

// The words on the list of alerts sent (Phase 5). The times come from the
// server already in his home time zone, with their offset; these only write
// them, and must write them right whatever the phone's own time zone.

describe('10 the list of alerts sent, how each time is written', () => {
  it('10.3 a time today is the time only, on a 12-hour clock, at its edges', () => {
    expect(alertMomentText('2026-10-12T20:00:00-04:00', '2026-10-12')).toBe('8:00 PM');
    expect(alertMomentText('2026-10-12T00:00:00-04:00', '2026-10-12')).toBe('12:00 AM');
    expect(alertMomentText('2026-10-12T12:00:00-04:00', '2026-10-12')).toBe('12:00 PM');
    expect(alertMomentText('2026-10-12T23:59:59-04:00', '2026-10-12')).toBe('11:59 PM');
    expect(alertMomentText('2026-10-12T09:05:00-04:00', '2026-10-12')).toBe('9:05 AM');
  });

  it('10.3 a time on another day has the day too', () => {
    expect(alertMomentText('2026-10-11T20:00:00-04:00', '2026-10-12')).toBe('Sun, Oct 11, 8:00 PM');
    expect(alertMomentText('2026-12-31T23:59:00-05:00', '2027-01-01')).toBe('Thu, Dec 31, 11:59 PM');
  });

  it('10.3 the time is read as the server wrote it, in his home time zone, on both sides of Nov 1', () => {
    expect(alertMomentText('2026-10-31T20:00:00-04:00', '2026-11-02')).toBe('Sat, Oct 31, 8:00 PM');
    expect(alertMomentText('2026-11-01T20:00:00-05:00', '2026-11-02')).toBe('Sun, Nov 1, 8:00 PM');
    // A time the clock shows twice is written as the clock showed it.
    expect(alertMomentText('2026-11-01T01:30:00-05:00', '2026-11-01')).toBe('1:30 AM');
  });

  it('10.3 a time that is not one is refused, not shown wrong', () => {
    expect(() => alertMomentText('8 PM', '2026-10-12')).toThrow();
    expect(() => alertMomentText('2026-10-12T25:00:00-04:00', '2026-10-12')).toThrow();
  });

  it('10.3 sent: when it came due and when it went out', () => {
    const due = '2026-10-12T20:00:00-04:00';
    expect(alertWhenText({ dueAt: due, sentAt: due, tries: 1, nextTryAt: null, quietUntil: null }, '2026-10-12')).toBe('Due 8:00 PM, sent 8:00 PM');
    expect(alertWhenText({ dueAt: due, sentAt: '2026-10-12T21:30:00-04:00', tries: 1, nextTryAt: null, quietUntil: null }, '2026-10-12')).toBe('Due 8:00 PM, sent 9:30 PM');
    expect(alertWhenText({ dueAt: due, sentAt: '2026-10-13T07:30:00-04:00', tries: 2, nextTryAt: null, quietUntil: null }, '2026-10-13')).toBe('Due Mon, Oct 12, 8:00 PM, sent 7:30 AM');
  });

  it('10.3 not sent yet: never tried, or tried and failing, with when it is tried again', () => {
    const due = '2026-10-12T20:00:00-04:00';
    expect(alertWhenText({ dueAt: due, sentAt: null, tries: 0, nextTryAt: null, quietUntil: null }, '2026-10-12')).toBe('Due 8:00 PM. Not sent yet.');
    expect(alertWhenText({ dueAt: due, sentAt: null, tries: 1, nextTryAt: '2026-10-12T20:01:00-04:00', quietUntil: null }, '2026-10-12')).toBe('Due 8:00 PM. Not sent yet: tried once, trying again at 8:01 PM.');
    expect(alertWhenText({ dueAt: due, sentAt: null, tries: 3, nextTryAt: '2026-10-12T20:07:00-04:00', quietUntil: null }, '2026-10-12')).toBe('Due 8:00 PM. Not sent yet: tried 3 times, trying again at 8:07 PM.');
  });

  it('10.8 not sent yet because it is quiet hours: when they end, whether it was tried or not', () => {
    const due = '2026-10-13T03:10:00-04:00';
    expect(alertWhenText({ dueAt: due, sentAt: null, tries: 0, nextTryAt: null, quietUntil: '2026-10-13T07:00:00-04:00' }, '2026-10-13')).toBe('Due 3:10 AM. Waits for quiet hours to end at 7:00 AM.');
    expect(alertWhenText({ dueAt: '2026-10-12T21:55:00-04:00', sentAt: null, tries: 3, nextTryAt: '2026-10-12T22:02:00-04:00', quietUntil: '2026-10-13T07:00:00-04:00' }, '2026-10-12')).toBe('Due 9:55 PM. Waits for quiet hours to end at Tue, Oct 13, 7:00 AM.');
  });

  it('10.3 how many: none, one, and more than the list shows', () => {
    expect(alertCountText(0, 0)).toBe('No alerts yet');
    expect(alertCountText(1, 1)).toBe('1 alert');
    expect(alertCountText(2, 2)).toBe('2 alerts');
    expect(alertCountText(100, 1234)).toBe('The newest 100 of 1,234 alerts');
    // Exactly one more than the list shows, and exactly as many.
    expect(alertCountText(100, 101)).toBe('The newest 100 of 101 alerts');
    expect(alertCountText(100, 100)).toBe('100 alerts');
  });

  it('10.3 the row on Settings: none yet, all sent, and some not sent yet', () => {
    expect(alertsRowText({ total: 0, notSent: 0 })).toBe('None yet');
    expect(alertsRowText({ total: 1, notSent: 0 })).toBe('1 alert, all sent');
    expect(alertsRowText({ total: 1, notSent: 1 })).toBe('1 alert, 1 not sent yet');
    expect(alertsRowText({ total: 2345, notSent: 2 })).toBe('2,345 alerts, 2 not sent yet');
  });
});
