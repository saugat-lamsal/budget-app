import type { Settings } from '@budget-app/money';
import { describe, expect, it, afterEach } from 'vitest';
import { dueWords, quietUntil } from '../src/alerts/sending.js';
import { readOutbox } from '../src/alerts/outbox.js';
import { memoryLog, type LogLine } from '../src/log.js';
import { AlertTimer } from '../src/serve/alert-timer.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { FakeClock } from './fake-clock.js';
import { FakePhone } from './fake-phone.js';
import { decisions, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// Phase 5: sending the alerts the books keep. Quiet hours (10.8, QUESTIONS.md
// A35): nothing is sent from 10:00 PM to 7:00 AM in his home time zone, and
// what comes due then waits until they end and says when it was due. The lock
// screen (10.10, A39): the phone gets words only, unless the setting says
// amounts; the list in the app always has them. Every name and number is
// made up. New York: EDT is UTC-4 until Nov 1 2026, then EST, UTC-5.

const ZONE = 'America/New_York';
const QUIET = { from: '22:00', to: '07:00' };

describe('10.8 A35 quiet hours, worked out on his clock', () => {
  it('10.8 from 10:00 PM to 7:00 AM: in them, it says when they end; a moment either side, not', () => {
    // 9:59:59.999 PM on Oct 2 (EDT): not yet.
    expect(quietUntil(ZONE, QUIET, new Date('2026-10-03T01:59:59.999Z'))).toBeNull();
    // 10:00 PM: until 7:00 AM the next morning.
    expect(quietUntil(ZONE, QUIET, new Date('2026-10-03T02:00:00Z'))?.toISOString()).toBe('2026-10-03T11:00:00.000Z');
    // 3:10 AM: until 7:00 AM that morning.
    expect(quietUntil(ZONE, QUIET, new Date('2026-10-03T07:10:00Z'))?.toISOString()).toBe('2026-10-03T11:00:00.000Z');
    // 6:59:59.999 AM: still in them; 7:00 AM: over.
    expect(quietUntil(ZONE, QUIET, new Date('2026-10-03T10:59:59.999Z'))?.toISOString()).toBe('2026-10-03T11:00:00.000Z');
    expect(quietUntil(ZONE, QUIET, new Date('2026-10-03T11:00:00Z'))).toBeNull();
    expect(quietUntil(ZONE, QUIET, new Date('2026-10-03T16:00:00Z'))).toBeNull();
  });

  it('section 2 10.8 a setting: hours that do not cross midnight, and the same time twice is no quiet hours at all (B188)', () => {
    const early = { from: '01:00', to: '05:30' };
    expect(quietUntil(ZONE, early, new Date('2026-10-03T04:59:00Z'))).toBeNull();
    expect(quietUntil(ZONE, early, new Date('2026-10-03T05:00:00Z'))?.toISOString()).toBe('2026-10-03T09:30:00.000Z');
    expect(quietUntil(ZONE, early, new Date('2026-10-03T09:30:00Z'))).toBeNull();
    for (const at of ['2026-10-03T02:00:00Z', '2026-10-03T07:10:00Z', '2026-10-03T16:00:00Z']) expect(quietUntil(ZONE, { from: '22:00', to: '22:00' }, new Date(at))).toBeNull();
  });

  it('10.8 section 2 they follow his clock across Nov 1 2026 (1:30 AM twice) and Mar 14 2027 (2:30 AM skipped)', () => {
    // 1:30 AM EDT and 1:30 AM EST on Nov 1: both until 7:00 AM EST.
    expect(quietUntil(ZONE, QUIET, new Date('2026-11-01T05:30:00Z'))?.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    expect(quietUntil(ZONE, QUIET, new Date('2026-11-01T06:30:00Z'))?.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    // 10:00 PM EDT on Oct 31: until 7:00 AM EST, 10 hours later.
    expect(quietUntil(ZONE, QUIET, new Date('2026-11-01T02:00:00Z'))?.toISOString()).toBe('2026-11-01T12:00:00.000Z');
    // 1:59 AM EST on Mar 14, then 3:00 AM EDT a minute later: until 7:00 AM EDT.
    expect(quietUntil(ZONE, QUIET, new Date('2027-03-14T06:59:00Z'))?.toISOString()).toBe('2027-03-14T11:00:00.000Z');
    expect(quietUntil(ZONE, QUIET, new Date('2027-03-14T07:00:00Z'))?.toISOString()).toBe('2027-03-14T11:00:00.000Z');
    // A quiet hours end in the skipped hour is the moment the clock jumps.
    expect(quietUntil(ZONE, { from: '22:00', to: '02:30' }, new Date('2027-03-14T06:00:00Z'))?.toISOString()).toBe('2027-03-14T07:00:00.000Z');
  });

  it('10.8 his home time zone, not the server\'s: 10:00 PM in Chicago is 11:00 PM in New York', () => {
    expect(quietUntil('America/Chicago', QUIET, new Date('2026-10-03T02:59:00Z'))).toBeNull();
    expect(quietUntil('America/Chicago', QUIET, new Date('2026-10-03T03:00:00Z'))?.toISOString()).toBe('2026-10-03T12:00:00.000Z');
  });
});

describe('10.8 10.9 B185 an alert sent later than it came due says when it was due', () => {
  it('B185 sent in the minute it came due: nothing more; later that day: the time; another day: the day too', () => {
    expect(dueWords(ZONE, '2026-10-03T00:00:00.000Z', new Date('2026-10-03T00:00:59.999Z'))).toBeNull();
    expect(dueWords(ZONE, '2026-10-03T07:10:00.000Z', new Date('2026-10-03T11:00:00Z'))).toBe('Due 3:10 AM.');
    expect(dueWords(ZONE, '2026-10-03T00:00:00.000Z', new Date('2026-10-03T00:15:00Z'))).toBe('Due 8:00 PM.');
    // Due 9:55 PM on Oct 2, sent at 7:00 AM on Oct 3.
    expect(dueWords(ZONE, '2026-10-03T01:55:00.000Z', new Date('2026-10-03T11:00:00Z'))).toBe('Due Fri, Oct 2, 9:55 PM.');
    expect(dueWords(ZONE, '2026-10-03T16:05:00.000Z', new Date('2026-10-03T16:06:00Z'))).toBe('Due 12:05 PM.');
    expect(dueWords(ZONE, '2026-10-03T04:05:00.000Z', new Date('2026-10-03T11:00:00Z'))).toBe('Due 12:05 AM.');
  });
});

// The real books in a file, the alert timer, and the fake phone, on a clock
// the test moves. Setup day is Oct 1; the made-up bank is read only when the
// test syncs.
const E = ACCOUNT_IDS.everyday;
const MINUTE = 60_000;

interface Sending {
  readonly life: Life;
  readonly phone: FakePhone;
  readonly timer: AlertTimer;
  readonly lines: LogLine[];
  // The clock moves to this instant, with every timer at its own moment.
  until(at: string): Promise<void>;
  // A purchase the bank shows, then takes back, read by two syncs a minute
  // apart: a take-back alert (10.6) due at the second.
  takeBack(id: string, cents: number): Promise<void>;
  // A change of settings through the books, as Settings sends it; the timer
  // looks then (the books poke it), and the clock moves on from there.
  change(settings: Partial<Settings>): Promise<void>;
}

const running: Sending[] = [];
afterEach(async () => {
  for (const s of running.splice(0)) {
    await s.timer.stop();
    s.life.done();
  }
});

async function sending(): Promise<Sending> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-02');
  const clock = new FakeClock(life);
  const phone = new FakePhone(() => life.now);
  const lines: LogLine[] = [];
  const timer = new AlertTimer({ alerter: life.keeper, sender: phone, clock, log: memoryLog(lines) });
  life.keeper.whenChanged(() => timer.poke());
  timer.start();
  await timer.idle();
  const until = async (at: string): Promise<void> => {
    await clock.advance(Date.parse(at) - life.now.getTime(), () => timer.idle());
  };
  const id = decisions('settings');
  const s: Sending = {
    life,
    phone,
    timer,
    lines,
    until,
    takeBack: async (id, cents) => {
      life.h.fake.addPosted({ id, account: E, amount: cents, date: '2026-10-02', description: 'MADE UP CAFE' });
      await life.sync();
      await timer.idle();
      await until(new Date(life.now.getTime() + MINUTE).toISOString());
      life.h.fake.removePosted(id, { keepBalance: false });
      await life.sync();
      await timer.idle();
    },
    change: async (settings) => {
      expect(life.keeper.settingsChange({ id: id(), settings })).toMatchObject({ ok: true });
      await timer.idle();
    },
  };
  running.push(s);
  return s;
}

const shown = (phone: FakePhone): string[][] => phone.shown.map((a) => [a.id, a.at, a.due ?? '']);

describe('10.8 A35 quiet hours, with the real books and the timer', () => {
  it('10.8 A35 an alert that comes due at 3:10 AM is kept then, sent at 7:00 AM, and says when it was due', async () => {
    const s = await sending();
    await s.until('2026-10-03T07:09:00Z');
    await s.takeBack('copy-1', 1_150);
    expect(readOutbox(s.life.h.db, 10).rows.map((r) => [r.key, r.dueAt, r.sentAt])).toEqual([['bank-took-back copy-1', '2026-10-03T07:10:00.000Z', null]]);
    expect(s.phone.tries).toBe(0);
    await s.until('2026-10-03T10:59:59.999Z');
    expect(s.phone.tries).toBe(0);
    await s.until('2026-10-03T11:00:00Z');
    expect(shown(s.phone)).toEqual([['bank-took-back copy-1', '2026-10-03T11:00:00.000Z', 'Due 3:10 AM.']]);
    expect(readOutbox(s.life.h.db, 10).rows[0]?.sentAt).toBe('2026-10-03T11:00:00.000Z');
  });

  it('10.8 what waited goes the moment quiet hours end, not at the timer\'s next look a minute later', async () => {
    const s = await sending();
    // Half a minute off the minute, so the timer's once-a-minute looks fall at :30.
    await s.until('2026-10-03T07:09:30Z');
    await s.takeBack('copy-1', 1_150);
    await s.until('2026-10-03T11:00:00Z');
    expect(shown(s.phone)).toEqual([['bank-took-back copy-1', '2026-10-03T11:00:00.000Z', 'Due 3:10 AM.']]);
  });

  it('10.8 an alert that came due before quiet hours and could not be sent is not tried during them either: it goes at 7:00 AM, once', async () => {
    const s = await sending();
    // 9:54 PM on Oct 2; the phone cannot be reached until 11:00 PM.
    await s.until('2026-10-03T01:54:00Z');
    s.phone.failing = 'the phone cannot be reached';
    await s.takeBack('copy-1', 1_150);
    await s.until('2026-10-03T03:00:00Z');
    // Tried at 9:55, 9:56 and 9:58 PM; the next try would be 10:02 PM, in quiet hours.
    expect(s.phone.tries).toBe(3);
    s.phone.failing = null;
    await s.until('2026-10-03T10:59:00Z');
    expect(s.phone.tries).toBe(3);
    await s.until('2026-10-03T11:00:00Z');
    expect(shown(s.phone)).toEqual([['bank-took-back copy-1', '2026-10-03T11:00:00.000Z', 'Due Fri, Oct 2, 9:55 PM.']]);
    expect(s.phone.repeats).toBe(0);
  });

  it('10.8 B185 an alert sent the moment it came due says nothing more', async () => {
    const s = await sending();
    await s.takeBack('copy-1', 1_150);
    expect(shown(s.phone)).toEqual([['bank-took-back copy-1', '2026-10-02T16:01:00.000Z', '']]);
  });

  it('section 2 10.8 quiet hours are a setting, changed on the books: 11:00 PM to 6:00 AM; and the same time twice is none', async () => {
    const s = await sending();
    await s.change({ quietHours: { from: '23:00', to: '06:00' } });
    // 10:30 PM: sent at once.
    await s.until('2026-10-03T02:29:00Z');
    await s.takeBack('copy-1', 1_150);
    expect(shown(s.phone)).toEqual([['bank-took-back copy-1', '2026-10-03T02:30:00.000Z', '']]);
    // 11:30 PM: waits until 6:00 AM.
    await s.until('2026-10-03T03:29:00Z');
    await s.takeBack('copy-2', 2_200);
    await s.until('2026-10-03T10:00:00Z');
    expect(shown(s.phone).at(-1)).toEqual(['bank-took-back copy-2', '2026-10-03T10:00:00.000Z', 'Due Fri, Oct 2, 11:30 PM.']);
    // The same time twice: an alert at 3:10 AM goes at once.
    await s.change({ quietHours: { from: '23:00', to: '23:00' } });
    await s.until('2026-10-04T07:09:00Z');
    await s.takeBack('copy-3', 3_300);
    expect(shown(s.phone).at(-1)).toEqual(['bank-took-back copy-3', '2026-10-04T07:10:00.000Z', '']);
  });

  it('10.8 B183 the list of alerts says when one waiting for quiet hours will go', async () => {
    const s = await sending();
    await s.until('2026-10-03T07:09:00Z');
    await s.takeBack('copy-1', 1_150);
    expect(s.life.keeper.alertsView()).toMatchObject({ state: 'tracking', alerts: [{ key: 'bank-took-back copy-1', sentAt: null, quietUntil: '2026-10-03T07:00:00-04:00' }] });
    await s.until('2026-10-03T11:00:00Z');
    expect(s.life.keeper.alertsView()).toMatchObject({ state: 'tracking', alerts: [{ key: 'bank-took-back copy-1', sentAt: '2026-10-03T07:00:00-04:00', quietUntil: null }] });
  });
});

describe('10.10 A39 the lock screen, with the real books and the timer', () => {
  it('10.10 A39 off to start: the phone gets words only, and the list in the app has the amounts; turned on, the phone gets them too', async () => {
    const s = await sending();
    await s.takeBack('copy-1', 1_150);
    expect(s.phone.shown.map((a) => [a.title, a.body])).toEqual([['The bank took something back', 'MADE UP CAFE, taken back Fri, Oct 2. It is undone in your buckets too.']]);
    expect(s.life.keeper.alertsView()).toMatchObject({ alerts: [{ body: 'MADE UP CAFE, $11.50, taken back Fri, Oct 2. It is undone in your buckets too.' }] });
    await s.change({ amountsOnLockScreen: true });
    await s.takeBack('copy-2', 2_200);
    expect(s.phone.shown.map((a) => a.body).at(-1)).toBe('MADE UP CAFE, $22.00, taken back Fri, Oct 2. It is undone in your buckets too.');
  });

  it('10.10 the setting when it is sent counts, not when it came due: an alert waiting for quiet hours goes with the words the setting says at 7:00 AM', async () => {
    const s = await sending();
    await s.until('2026-10-03T07:09:00Z');
    await s.takeBack('copy-1', 1_150);
    await s.change({ amountsOnLockScreen: true });
    await s.until('2026-10-03T11:00:00Z');
    expect(s.phone.shown.map((a) => a.body)).toEqual(['MADE UP CAFE, $11.50, taken back Sat, Oct 3. It is undone in your buckets too.']);
  });
});
