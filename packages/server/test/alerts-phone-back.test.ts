import { afterEach, describe, expect, it } from 'vitest';
import { alertKey, type AlertFacts } from '../src/alerts/alerts.js';
import { readOutbox } from '../src/alerts/outbox.js';
import { planSends, replacedBy, sendKindOf, type Unsent } from '../src/alerts/sending.js';
import { memoryLog } from '../src/log.js';
import { AlertTimer } from '../src/serve/alert-timer.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { FakeClock } from './fake-clock.js';
import { FakePhone } from './fake-phone.js';
import { choose, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// 10.9 (QUESTIONS.md A40, his answer Oct 12: option 2): alerts the phone could
// not be given (it could not be reached, or no phone had notifications on).
// When it can be given them again, of what waited only the newest of each kind
// goes, and only if it is still true then; the rest stay in the list in the
// app, "Not sent: a newer one went." or "Not sent: no longer true." What only
// waited for quiet hours (10.8, B188) still all goes. Every name and number is
// made up. New York: EDT is UTC-4 until Nov 1 2026.

const review = (date: string, waiting = 1): AlertFacts => ({ kind: 'daily-review', date, waiting });
const reminder = (daysBefore: number): AlertFacts => ({ kind: 'card-reminder', card: 'everyday-card', dueDate: '2026-10-10', daysBefore, minimumPayment: 3_500, statementBalance: 45_025 });
const low = (bucket: 'needs' | 'wants', period: number): AlertFacts => ({ kind: 'low-bucket', bucket, period, amount: 1_000, startedWith: 20_000 });
const tookBack = (id: string): AlertFacts => ({ kind: 'bank-took-back', id, date: '2026-10-03', description: 'MADE UP CAFE', amount: 1_150 });

// One not sent yet, due at hour h of Oct 3 (UTC), tried `tries` times.
const unsent = (facts: AlertFacts, h: number, tries: number): Unsent => {
  const at = `2026-10-03T${String(h).padStart(2, '0')}:00:00.000Z`;
  return { key: alertKey(facts), facts, dueAt: at, createdAt: at, tries };
};
const all = (): boolean => true;

describe('10.9 A40 which of what waited for the phone goes, worked out on its own', () => {
  it('10.9 A40 the kinds: one daily review, one per card (a reminder and the overdue alert together), each bucket\'s low and empty alerts on their own, one of each lasting alert, each take-back its own', () => {
    const kinds = [
      review('2026-10-02'),
      review('2026-10-03'),
      reminder(7),
      reminder(2),
      { kind: 'card-overdue', card: 'everyday-card', dueDate: '2026-10-10', minimumPayment: 3_500, date: '2026-10-11' },
      { kind: 'card-reminder', card: 'old-card', dueDate: '2026-10-10', daysBefore: 7, minimumPayment: 6_000, statementBalance: null },
      low('needs', 3),
      low('needs', 4),
      low('wants', 4),
      { kind: 'empty-bucket', bucket: 'needs', period: 4, amount: 0 },
      { kind: 'totals-mismatch', time: 1, difference: 100, day: '2026-10-02', again: false },
      { kind: 'totals-mismatch', time: 1, difference: 100, day: '2026-10-03', again: true },
      { kind: 'totals-mismatch', time: 2, difference: 100, day: '2026-10-04', again: false },
      { kind: 'bank-login', time: 1, day: '2026-10-02', again: false },
      { kind: 'bank-not-read', time: 1, hours: 24, lastRead: '2026-10-02T13:00:00.000Z', lastReadLocal: '2026-10-02T09:00:00-04:00' },
      tookBack('copy-1'),
      tookBack('copy-2'),
    ].map((f) => sendKindOf(alertKey(f as AlertFacts), f as AlertFacts));
    expect(kinds).toEqual([
      'daily-review',
      'daily-review',
      'card everyday-card',
      'card everyday-card',
      'card everyday-card',
      'card old-card',
      'low-bucket needs',
      'low-bucket needs',
      'low-bucket wants',
      'empty-bucket needs',
      'totals-mismatch',
      'totals-mismatch',
      'totals-mismatch',
      'bank-login',
      'bank-not-read',
      'bank-took-back copy-1',
      'bank-took-back copy-2',
    ]);
    // One kept before its facts were (database step 6) is a kind of its own.
    expect(sendKindOf('daily-review 2026-10-01', null)).toBe('daily-review 2026-10-01');
  });

  it('10.9 A40 the newest of each kind goes; older ones that waited for the phone wait behind it, and are not tried', () => {
    const rows = [unsent(review('2026-10-01'), 0, 5), unsent(reminder(7), 1, 5), unsent(review('2026-10-02'), 2, 3), unsent(tookBack('copy-1'), 3, 2), unsent(tookBack('copy-2'), 4, 1), unsent(reminder(2), 5, 1)];
    expect(planSends(rows, all)).toEqual({
      go: ['daily-review 2026-10-02', 'bank-took-back copy-1', 'bank-took-back copy-2', 'card-reminder everyday-card due 2026-10-10 2 days before'],
      held: ['daily-review 2026-10-01', 'card-reminder everyday-card due 2026-10-10 7 days before'],
      notTrue: [],
    });
  });

  it('10.9 A40 the newest of a kind that is no longer true does not go, and neither do the older ones that waited with it', () => {
    const rows = [unsent(review('2026-10-01'), 0, 5), unsent(review('2026-10-02'), 2, 3), unsent(low('needs', 4), 3, 1)];
    const plan = planSends(rows, (f) => f.kind !== 'daily-review');
    expect(plan).toEqual({ go: ['low-bucket needs pay period 4'], held: [], notTrue: ['daily-review 2026-10-01', 'daily-review 2026-10-02'] });
  });

  it('10.9 A40 one alone of its kind that waited goes only if still true; one never tried yet goes either way (it came due just now, or waited only for quiet hours, B188)', () => {
    expect(planSends([unsent(low('needs', 4), 3, 1)], () => false)).toEqual({ go: [], held: [], notTrue: ['low-bucket needs pay period 4'] });
    expect(planSends([unsent(low('needs', 4), 3, 0)], () => false)).toEqual({ go: ['low-bucket needs pay period 4'], held: [], notTrue: [] });
    // Two that waited only for quiet hours, of one kind: both go (10.8 says they wait, not that they are dropped).
    expect(planSends([unsent(review('2026-10-01'), 0, 0), unsent(review('2026-10-02'), 2, 0)], () => false).go).toEqual(['daily-review 2026-10-01', 'daily-review 2026-10-02']);
  });

  it('10.9 A40 an older one that waited for the phone waits behind a newer one that has not been tried yet', () => {
    const rows = [unsent(review('2026-10-01'), 0, 4), unsent(review('2026-10-02'), 2, 0)];
    expect(planSends(rows, () => false)).toEqual({ go: ['daily-review 2026-10-02'], held: ['daily-review 2026-10-01'], notTrue: [] });
  });

  it('10.9 A40 the order is by when each came due, not by the order handed in', () => {
    const rows = [unsent(review('2026-10-02'), 2, 3), unsent(review('2026-10-01'), 0, 5)];
    expect(planSends(rows, all)).toEqual({ go: ['daily-review 2026-10-02'], held: ['daily-review 2026-10-01'], notTrue: [] });
  });

  it('10.9 A40 when one goes, the older ones of its kind that waited for the phone are the ones it replaces: "Not sent: a newer one went."', () => {
    const rows = [unsent(review('2026-10-01'), 0, 5), unsent(review('2026-10-02'), 1, 0), unsent(review('2026-10-03'), 2, 3), unsent(tookBack('copy-1'), 0, 4), unsent(review('2026-10-04'), 4, 1)];
    expect(replacedBy(rows, rows[2]!)).toEqual(['daily-review 2026-10-01']);
    // A newer one is never replaced by an older one, and one alone replaces nothing.
    expect(replacedBy(rows, rows[0]!)).toEqual([]);
    expect(replacedBy(rows, rows[3]!)).toEqual([]);
  });
});

// The real books in a file, the alert timer, and the fake phone, on a clock
// the test moves. Setup day is Oct 1. The bank is read each morning at 8:00
// AM, so a read is never a day old (10.7).
const E = ACCOUNT_IDS.everyday;
const MINUTE = 60_000;

interface Sending {
  readonly life: Life;
  readonly phone: FakePhone;
  readonly timer: AlertTimer;
  until(at: string): Promise<void>;
  // A purchase on the everyday card that no rule sorts: it waits in review.
  waiting(id: string, cents: number): Promise<void>;
  sync(): Promise<void>;
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
  const timer = new AlertTimer({ alerter: life.keeper, sender: phone, clock, log: memoryLog([]) });
  life.keeper.whenChanged(() => timer.poke());
  timer.start();
  await timer.idle();
  const until = async (at: string): Promise<void> => {
    await clock.advance(Date.parse(at) - life.now.getTime(), () => timer.idle());
  };
  const sync = async (): Promise<void> => {
    await life.sync();
    await timer.idle();
  };
  const s: Sending = {
    life,
    phone,
    timer,
    until,
    sync,
    waiting: async (id, cents) => {
      life.h.fake.addPosted({ id, account: E, amount: cents, date: '2026-10-02', description: 'MADE UP SHOP' });
      await sync();
    },
  };
  await sync();
  running.push(s);
  return s;
}

const shown = (phone: FakePhone): string[][] => phone.shown.map((a) => [a.id, a.at, a.due ?? '']);
const notSent = (s: Sending): Record<string, string | null> => {
  const view = s.life.keeper.alertsView();
  return view.state === 'tracking' ? Object.fromEntries(view.alerts.map((a) => [a.key, a.notSent])) : {};
};

describe('10.9 A40 the phone could not be reached for days, with the real books and the timer', () => {
  it('10.9 A40 two evenings missed: only the newest daily review goes when the phone can be reached, saying when it was due; the other is "a newer one went"', async () => {
    const s = await sending();
    await s.waiting('shop-1', 2_500);
    // The phone cannot be reached from 7:00 PM on Oct 2 to 9:00 AM on Oct 4.
    await s.until('2026-10-02T23:00:00Z');
    s.phone.failing = 'the phone cannot be reached';
    await s.until('2026-10-03T12:00:00Z');
    await s.sync();
    await s.until('2026-10-04T11:30:00Z');
    await s.sync();
    await s.until('2026-10-04T13:00:00Z');
    s.phone.failing = null;
    // Tried again an hour apart by now (B181): the next try is at 10:00 AM.
    await s.until('2026-10-04T14:05:00Z');
    expect(shown(s.phone).filter(([id]) => id?.startsWith('daily-review'))).toEqual([['daily-review 2026-10-03', '2026-10-04T14:00:00.000Z', 'Was due Sat, Oct 3, 8:00 PM.']]);
    expect(notSent(s)).toMatchObject({ 'daily-review 2026-10-02': 'newer', 'daily-review 2026-10-03': null });
    expect(s.phone.repeats).toBe(0);
    // Nothing is tried again for the one replaced.
    const tries = s.phone.tries;
    await s.until('2026-10-04T16:00:00Z');
    expect(s.phone.tries).toBe(tries);
  });

  it('10.9 A40 what is no longer true when the phone can be reached does not go: the item was sorted meanwhile', async () => {
    const s = await sending();
    await s.waiting('shop-1', 2_500);
    await s.until('2026-10-02T23:00:00Z');
    s.phone.failing = 'the phone cannot be reached';
    await s.until('2026-10-03T12:00:00Z');
    await s.sync();
    // He sorts it in the app on Oct 3 at 9:00 AM, the phone still cut off.
    expect(choose(s.life.keeper, { item: 'shop-1', choice: { to: 'wants' } })).toMatchObject({ ok: true });
    await s.timer.idle();
    await s.until('2026-10-03T14:00:00Z');
    s.phone.failing = null;
    await s.until('2026-10-03T14:05:00Z');
    expect(s.phone.ids().filter((id) => id.startsWith('daily-review'))).toEqual([]);
    expect(notSent(s)).toMatchObject({ 'daily-review 2026-10-02': 'not-true' });
  });

  it('10.9 A40 each take-back is its own: both go when the phone can be reached', async () => {
    const s = await sending();
    s.phone.failing = 'the phone cannot be reached';
    for (const id of ['copy-1', 'copy-2']) {
      s.life.h.fake.addPosted({ id, account: E, amount: 1_150, date: '2026-10-02', description: 'MADE UP CAFE' });
      await s.sync();
      await s.until(new Date(s.life.now.getTime() + MINUTE).toISOString());
      s.life.h.fake.removePosted(id, { keepBalance: false });
      await s.sync();
    }
    await s.until('2026-10-02T18:00:00Z');
    s.phone.failing = null;
    await s.until('2026-10-02T18:05:00Z');
    expect(s.phone.ids().filter((id) => id.startsWith('bank-took-back')).toSorted()).toEqual(['bank-took-back copy-1', 'bank-took-back copy-2']);
  });

  it('10.9 A40 B183 the list says why each one was not sent, and Settings counts what went', async () => {
    const s = await sending();
    await s.waiting('shop-1', 2_500);
    await s.until('2026-10-02T23:00:00Z');
    s.phone.failing = 'the phone cannot be reached';
    await s.until('2026-10-03T12:00:00Z');
    await s.sync();
    await s.until('2026-10-04T11:30:00Z');
    await s.sync();
    // While the phone is cut off: Oct 2's waits behind Oct 3's, which is tried.
    expect(notSent(s)).toMatchObject({ 'daily-review 2026-10-02': 'held', 'daily-review 2026-10-03': null });
    s.phone.failing = null;
    await s.until('2026-10-04T14:05:00Z');
    expect(notSent(s)).toMatchObject({ 'daily-review 2026-10-02': 'newer', 'daily-review 2026-10-03': null });
    const rows = readOutbox(s.life.h.db, 100).rows;
    expect(rows.find((r) => r.key === 'daily-review 2026-10-02')).toMatchObject({ sentAt: null, notSent: 'newer' });
    expect(rows.map((r) => r.key).toSorted()).toEqual(['daily-review 2026-10-02', 'daily-review 2026-10-03']);
    expect(s.life.keeper.settings().alerts).toEqual({ total: 2, sent: 1, notSent: 0 });
  });

  it('10.9 A40 a restart keeps what was not sent and why, and the one waiting behind still never goes', async () => {
    const s = await sending();
    await s.waiting('shop-1', 2_500);
    await s.until('2026-10-02T23:00:00Z');
    s.phone.failing = 'the phone cannot be reached';
    await s.until('2026-10-03T12:00:00Z');
    await s.sync();
    await s.until('2026-10-04T12:00:00Z');
    await s.timer.stop();
    s.life.restart();
    const clock = new FakeClock(s.life);
    s.phone.failing = null;
    const timer = new AlertTimer({ alerter: s.life.keeper, sender: s.phone, clock, log: memoryLog([]) });
    running.push({ ...s, timer });
    timer.start();
    await timer.idle();
    await clock.advance(2 * 60 * MINUTE, () => timer.idle());
    expect(s.phone.ids().filter((id) => id.startsWith('daily-review'))).toEqual(['daily-review 2026-10-03']);
    expect(notSent(s)).toMatchObject({ 'daily-review 2026-10-02': 'newer' });
  });
});
