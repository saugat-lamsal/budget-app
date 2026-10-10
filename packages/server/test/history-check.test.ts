import { Book } from '@budget-app/money';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveConnectionState, readConnection } from '../src/db/store.js';
import { HistoryDoesNotReplay, readHistory } from '../src/history/history-db.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { decision, everything, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// The replay check (the real server keeps everything): the totals the book had
// after each event are saved with it. When the books are opened, the history
// is replayed and checked against them; if any event gives different totals,
// a change to the code would rewrite the past, so the books do not open, and
// it says at which event. Replaying never asks the clock: every date is in
// the history. Every name and number is made up.

const E = ACCOUNT_IDS.everyday;

afterEach(() => {
  vi.restoreAllMocks();
});

// Set up, then a few purchases sorted over a few days.
async function aFewDays(): Promise<Life> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  for (const [day, id, amount, description, to] of [
    ['2026-10-02', 'store-1', 2_345, 'CORNER STORE 12', 'wants'],
    ['2026-10-03', 'store-2', 1_200, 'CORNER STORE 12', 'needs'],
    ['2026-10-05', 'cafe-1', 650, 'MADE UP CAFE', 'wants'],
  ] as const) {
    life.now = noonInNewYork(day);
    life.h.fake.addPosted({ id, account: E, amount, date: day, description });
    await life.sync();
    const done = life.keeper.choice({ id: decision(), item: id, choice: { to } });
    if (!done.ok) throw new Error(done.why);
  }
  return life;
}

describe('the replay check: the history must replay to the totals saved with it', () => {
  it('every event is saved with the totals after it, and the books open when they all replay the same', async () => {
    const life = await aFewDays();
    try {
      const events = readHistory(life.h.db);
      // His five Setup day answers come first, then setup day itself.
      expect(events.map((e) => e.event.kind)).toEqual(['answer', 'answer', 'answer', 'answer', 'answer', 'setup', 'receive', 'answer', 'receive', 'answer', 'receive', 'answer']);
      expect(events.slice(0, 5).every((e) => e.totals === null && e.event.kind === 'answer' && e.event.answer.setup !== undefined)).toBe(true);
      // Every one is saved with its totals: none before setup day, then the book's.
      expect(events.every((e) => e.sealed)).toBe(true);
      expect(events.slice(5).every((e) => e.totals !== null)).toBe(true);
      expect(events.at(-1)?.totals).toMatchObject({ wants: 20_000 - 2_345 - 650, unsortedOut: 0, waiting: 0 });
      const again = life.reopen();
      expect(everything(again.keeper.book()!)).toEqual(everything(life.keeper.book()!));
      again.close();
    } finally {
      life.done();
    }
  });

  it('a rule changed on purpose (sorting to wants lands in needs) is caught: the books do not open, and it says at which event', async () => {
    const life = await aFewDays();
    try {
      const sort = Book.prototype.sort;
      vi.spyOn(Book.prototype, 'sort').mockImplementation(function (this: Book, id, choice, date) {
        return sort.call(this, id, 'to' in choice && choice.to === 'wants' ? { to: 'needs' } : choice, date);
      });
      const first = readHistory(life.h.db).find((e) => e.event.kind === 'answer' && e.event.answer.book !== undefined);
      let caught: unknown;
      try {
        life.reopen();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(HistoryDoesNotReplay);
      const error = caught as HistoryDoesNotReplay;
      expect(error.at).toEqual({ seq: first?.seq, kind: 'answer', date: '2026-10-02' });
      expect(error.message).toBe(`The history does not replay to what was saved, at event ${first?.seq} (his answer: sort, 2026-10-02): the totals differ`);
      expect(error.saved).toMatchObject({ wants: 20_000 - 2_345 });
      expect(error.replayed).toMatchObject({ wants: 20_000 });
    } finally {
      vi.restoreAllMocks();
      life.done();
    }
  });

  it('an answer the code would refuse now is caught too, at its event', async () => {
    const life = await aFewDays();
    try {
      vi.spyOn(Book.prototype, 'sort').mockImplementation(() => {
        throw new Error('made up: sorting is broken');
      });
      expect(() => life.reopen()).toThrow(/^made up: sorting is broken$/);
      vi.restoreAllMocks();
      const answer = readHistory(life.h.db).find((e) => e.event.kind === 'answer' && e.event.answer.book !== undefined);
      life.h.db.prepare("UPDATE book_events SET payload = ? WHERE seq = ?").run(JSON.stringify({ book: [{ method: 'sort', args: ['no-such-item', { to: 'wants' }, '2026-10-02'] }] }), answer?.seq);
      expect(() => life.reopen()).toThrow(`at event ${answer?.seq} (his answer: sort, 2026-10-02): the book refuses sort now: no item no-such-item`);
    } finally {
      life.done();
    }
  });

  it('totals changed in the database by hand are caught; what the bank sent is checked the same way', async () => {
    const life = await aFewDays();
    try {
      const receive = readHistory(life.h.db).filter((e) => e.event.kind === 'receive')[1];
      const totals = { ...receive?.totals, needs: (receive?.totals?.needs ?? 0) + 1 };
      life.h.db.prepare('UPDATE book_events SET totals = ? WHERE seq = ?').run(JSON.stringify(totals), receive?.seq);
      expect(() => life.reopen()).toThrow(`at event ${receive?.seq} (from the bank: purchase store-2, 2026-10-03): the totals differ`);
    } finally {
      life.done();
    }
  });

  it('events saved before the totals were (an older database) get them the first time they replay, and are checked from then on', async () => {
    const life = await aFewDays();
    try {
      const saved = readHistory(life.h.db).map((e) => e.totals);
      life.h.db.prepare('UPDATE book_events SET totals = NULL').run();
      const again = life.reopen();
      again.close();
      expect(readHistory(life.h.db).map((e) => e.totals)).toEqual(saved);
      const last = readHistory(life.h.db).at(-1);
      life.h.db.prepare('UPDATE book_events SET totals = ? WHERE seq = ?').run(JSON.stringify({ ...last?.totals, wants: 1 }), last?.seq);
      expect(() => life.reopen()).toThrow(HistoryDoesNotReplay);
    } finally {
      life.done();
    }
  });
});

describe('each event keeps the date it was made on; replaying never asks the clock', () => {
  it('opened with a clock that cannot be read, the books replay in full; only asking for today needs it', async () => {
    const life = await aFewDays();
    try {
      const again = life.reopen({
        now: () => {
          throw new Error('the clock was asked');
        },
      });
      expect(everything(again.keeper.book()!)).toEqual(everything(life.keeper.book()!));
      expect(() => again.keeper.today()).toThrow('the clock was asked');
      again.close();
    } finally {
      life.done();
    }
  });

  it('each answer is dated the day it was made, in the history and in the book; opened a year later, the books are the same', async () => {
    const life = await aFewDays();
    try {
      const answers = readHistory(life.h.db).filter((e) => e.event.kind === 'answer' && e.event.answer.book !== undefined);
      expect(answers.map((e) => e.date)).toEqual(['2026-10-02', '2026-10-03', '2026-10-05']);
      expect(answers.map((e) => (e.event.kind === 'answer' ? e.event.answer.book?.[0]?.args.at(-1) : null))).toEqual(['2026-10-02', '2026-10-03', '2026-10-05']);
      const before = everything(life.keeper.book()!);
      life.now = noonInNewYork('2027-10-05');
      const again = life.reopen();
      expect(everything(again.keeper.book()!)).toEqual(before);
      expect(again.keeper.today()).toBe('2027-10-05');
      again.close();
    } finally {
      life.done();
    }
  });
});

describe('section 2 today is the date in his home time zone, on the real server', () => {
  it('at 11:30 PM in New York, already the next day in UTC, an answer and a sync are dated the New York day; the bank\'s own dates stay as sent', async () => {
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life);
      life.now = new Date('2026-10-03T03:30:00Z');
      expect(life.keeper.today()).toBe('2026-10-02');
      // The bank dates this one Oct 3; it is still Oct 2 in New York.
      life.h.fake.addPosted({ id: 'late-1', account: E, amount: 1_500, date: '2026-10-03', description: 'MADE UP LATE SHOP' });
      await life.sync();
      expect(life.h.db.prepare('SELECT today FROM syncs ORDER BY id DESC LIMIT 1').get()).toEqual({ today: '2026-10-02' });
      expect(life.keeper.book()?.purchases().find((p) => p.id === 'late-1')?.date).toBe('2026-10-03');
      expect(life.keeper.move({ id: decision(), move: { from: 'wants', to: 'needs', amount: 100 } })).toMatchObject({ ok: true });
      expect(readHistory(life.h.db).at(-1)?.date).toBe('2026-10-02');
      expect(life.keeper.book()?.changeLog().at(-1)).toMatchObject({ kind: 'money-moved', date: '2026-10-02' });
    } finally {
      life.done();
    }
  });

  it('with the home time zone changed to Los Angeles, today follows it: 1:30 AM in New York is still the day before there', async () => {
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life);
      life.now = new Date('2026-10-10T05:30:00Z');
      expect(life.keeper.today()).toBe('2026-10-10');
      expect(life.keeper.settingsChange({ id: decision(), settings: { homeTimeZone: 'America/Los_Angeles' } })).toMatchObject({ ok: true });
      expect(life.keeper.today()).toBe('2026-10-09');
      life.restart();
      expect(life.keeper.today()).toBe('2026-10-09');
      // The change itself was dated in New York, where it was made.
      expect(life.keeper.book()?.changeLog().at(-1)).toMatchObject({ kind: 'settings-changed', date: '2026-10-10', changes: { homeTimeZone: 'America/Los_Angeles' } });
    } finally {
      life.done();
    }
  });

  it('before setup day, today is the date in the home time zone tracking will start with (New York)', async () => {
    const life = await lifeInAFile();
    try {
      life.now = new Date('2026-10-02T03:59:59Z');
      expect(life.keeper.today()).toBe('2026-10-01');
      life.now = new Date('2026-10-02T04:00:00Z');
      expect(life.keeper.today()).toBe('2026-10-02');
    } finally {
      life.done();
    }
  });
});

describe('0.5 B82 the last checked safe to spend is kept', () => {
  it('Home keeps the safe to spend the bank backed up, and when; after a restart with the bank wanting a login, Home shows it greyed, with the time in New York', async () => {
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life);
      life.now = new Date('2026-10-02T23:15:00Z');
      const home = life.keeper.home();
      expect(home).toMatchObject({ state: 'tracking', safeToSpend: { shown: true, amount: 20_000 } });
      const connection = readConnection(life.h.db);
      if (connection === null) throw new Error('no connection');
      saveConnectionState(life.h.db, { cursor: connection.cursor, historyComplete: connection.historyComplete, needsLogin: true });
      life.now = new Date('2026-10-05T14:00:00Z');
      life.restart();
      expect(life.keeper.home()).toMatchObject({ state: 'tracking', safeToSpend: { shown: false, why: 'bank-not-read', lastChecked: { amount: 20_000, at: '2026-10-02T19:15:00-04:00' } } });
    } finally {
      life.done();
    }
  });
});
