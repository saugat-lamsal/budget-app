import { Book } from '@budget-app/money';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryDoesNotReplay, readHistory } from '../src/history/history-db.js';
import { acceptRetotal, checkRetotal } from '../src/history/retotal.js';
import { runReplayCheck } from '../src/history/replay-check-command.js';
import { serverLinesIn } from '../src/server-log.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { decision, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// QUESTIONS.md A28, his answer (option 1): when the history does not replay
// to the totals saved with it, the server stays stopped. npm run replay-check
// shows each event whose totals would change, before and after, and with his
// yes takes the new totals from that event on. It goes in the change log
// (13.5), dated, with what changed. Every name and number is made up.

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

// A fix to the money math, on purpose: sorting to wants lands in needs.
function wantsLandsInNeeds(): void {
  const sort = Book.prototype.sort;
  vi.spyOn(Book.prototype, 'sort').mockImplementation(function (this: Book, id, choice, date) {
    return sort.call(this, id, 'to' in choice && choice.to === 'wants' ? { to: 'needs' } : choice, date);
  });
}

function opens(life: Life): boolean {
  try {
    life.reopen().close();
    return true;
  } catch (error) {
    if (error instanceof HistoryDoesNotReplay) return false;
    throw error;
  }
}

describe('0.6 A28 when the history does not replay to what was saved', () => {
  it('0.6 A28 a rule changed on purpose stops the server; the check shows every event whose totals would change, before and after, from the first one on', async () => {
    const life = await aFewDays();
    try {
      wantsLandsInNeeds();
      expect(opens(life)).toBe(false);
      const events = readHistory(life.h.db);
      const first = events.find((e) => e.event.kind === 'answer' && e.event.answer.book !== undefined);
      const found = checkRetotal(life.h.db);
      if (found.state !== 'changed') throw new Error(`expected changes, got ${found.state}`);
      // Every event from the first sort to wants on, and none before it.
      expect(found.events.map((e) => e.seq)).toEqual(events.filter((e) => e.seq >= (first?.seq ?? 0)).map((e) => e.seq));
      expect(found.events[0]).toMatchObject({ seq: first?.seq, date: '2026-10-02', what: 'his answer: sort' });
      expect(found.events[0]?.before).toMatchObject({ wants: 20_000 - 2_345 });
      expect(found.events[0]?.after).toMatchObject({ wants: 20_000 });
      expect((found.events[0]?.after?.needs ?? 0) - (found.events[0]?.before?.needs ?? 0)).toBe(-2_345);
      // The last: both purchases to wants landed in needs instead.
      expect(found.events.at(-1)?.after).toMatchObject({ wants: 20_000, needs: (found.events.at(-1)?.before?.needs ?? 0) - 2_345 - 650 });
      // Looking changes nothing.
      expect(readHistory(life.h.db)).toEqual(events);
    } finally {
      life.done();
    }
  });

  it('0.6 A28 13.5 with his yes the new totals are taken from that event on, the change log says so, dated today in his home time zone, and the server starts', async () => {
    const life = await aFewDays();
    try {
      wantsLandsInNeeds();
      const found = checkRetotal(life.h.db);
      if (found.state !== 'changed') throw new Error('expected changes');
      // 11:30 PM in New York on Oct 9 is already Oct 10 in UTC: the line is dated Oct 9.
      const answer = acceptRetotal(life.h.db, found.key, new Date('2026-10-10T03:30:00Z'));
      expect(answer).toEqual({ ok: true, events: found.events.length });
      for (const e of found.events) expect(readHistory(life.h.db).find((s) => s.seq === e.seq)?.totals).toEqual(e.after);
      expect(opens(life)).toBe(true);
      expect(checkRetotal(life.h.db)).toEqual({ state: 'same' });
      const lines = serverLinesIn(life.h.db);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ date: '2026-10-09', action: 'history-retotaled', from: { seq: found.events[0]?.seq, date: '2026-10-02', what: 'his answer: sort' } });
      expect(lines[0]?.action === 'history-retotaled' ? lines[0].events : []).toEqual(found.events);
      // On Settings, among the book's lines, newest first.
      life.restart();
      const settings = life.keeper.settings();
      if (settings.state !== 'tracking') throw new Error('not tracking');
      expect(settings.log[0]).toMatchObject({ kind: 'history-retotaled', date: '2026-10-09', from: { date: '2026-10-02', what: 'his answer: sort' }, events: found.events.length });
    } finally {
      life.done();
    }
  });

  it('0.6 A28 a yes to a list that is not the one there now is refused, and nothing changes', async () => {
    const life = await aFewDays();
    try {
      wantsLandsInNeeds();
      const before = readHistory(life.h.db);
      expect(acceptRetotal(life.h.db, 'not-what-he-saw', new Date())).toEqual({ ok: false, why: 'The history changed since you looked. Nothing was changed; run it again.' });
      expect(readHistory(life.h.db)).toEqual(before);
      expect(serverLinesIn(life.h.db)).toEqual([]);
    } finally {
      life.done();
    }
  });

  it('0.6 A28 when every event replays the same there is nothing to take, and a yes changes nothing', async () => {
    const life = await aFewDays();
    try {
      expect(checkRetotal(life.h.db)).toEqual({ state: 'same' });
      expect(acceptRetotal(life.h.db, 'anything', new Date())).toEqual({ ok: false, why: 'Every event replays to what was saved. Nothing was changed.' });
      expect(serverLinesIn(life.h.db)).toEqual([]);
    } finally {
      life.done();
    }
  });

  it('0.6 A28 totals changed in the database by hand are shown the same way: only that event, before and after', async () => {
    const life = await aFewDays();
    try {
      const receive = readHistory(life.h.db).filter((e) => e.event.kind === 'receive')[1];
      const saved = receive?.totals;
      life.h.db.prepare('UPDATE book_events SET totals = ? WHERE seq = ?').run(JSON.stringify({ ...saved, needs: (saved?.needs ?? 0) + 1 }), receive?.seq);
      const found = checkRetotal(life.h.db);
      if (found.state !== 'changed') throw new Error('expected changes');
      expect(found.events).toEqual([{ seq: receive?.seq, date: '2026-10-03', what: 'from the bank: purchase store-2', before: { ...saved, needs: (saved?.needs ?? 0) + 1 }, after: saved }]);
    } finally {
      life.done();
    }
  });

  it('0.6 A28 A30 an event the code refuses now cannot be fixed with new totals: the check says which, and nothing can be taken', async () => {
    const life = await aFewDays();
    try {
      const answer = readHistory(life.h.db).find((e) => e.event.kind === 'answer' && e.event.answer.book !== undefined);
      life.h.db.prepare('UPDATE book_events SET payload = ? WHERE seq = ?').run(JSON.stringify({ book: [{ method: 'sort', args: ['no-such-item', { to: 'wants' }, '2026-10-02'] }] }), answer?.seq);
      const found = checkRetotal(life.h.db);
      expect(found).toEqual({ state: 'cannot-replay', at: { seq: answer?.seq, date: '2026-10-02', what: 'his answer: sort' }, why: 'the book refuses sort now: no item no-such-item' });
      const before = readHistory(life.h.db);
      expect(acceptRetotal(life.h.db, 'anything', new Date())).toMatchObject({ ok: false });
      expect(readHistory(life.h.db)).toEqual(before);
    } finally {
      life.done();
    }
  });
});

describe('0.6 A28 the command, npm run replay-check', () => {
  async function run(life: Life, reply: string): Promise<{ readonly result: string; readonly printed: string; readonly asked: readonly string[] }> {
    const lines: string[] = [];
    const asked: string[] = [];
    const result = await runReplayCheck({
      db: life.h.db,
      now: () => new Date('2026-10-09T16:00:00Z'),
      print: (line) => lines.push(line),
      ask: async (question) => {
        asked.push(question);
        return reply;
      },
    });
    return { result, printed: lines.join('\n'), asked };
  }

  it('0.6 A28 it shows each event that would change, before and after, in dollars, and asks; anything but yes leaves everything as it was', async () => {
    const life = await aFewDays();
    try {
      wantsLandsInNeeds();
      const before = readHistory(life.h.db);
      const first = before.find((e) => e.event.kind === 'answer' && e.event.answer.book !== undefined);
      for (const reply of ['', 'no', 'y', 'YES please']) {
        const { result, printed, asked } = await run(life, reply);
        expect(result).toBe('left as it was');
        expect(asked).toHaveLength(1);
        expect(printed).toContain(`Event ${first?.seq}, Oct 2, 2026: his answer: sort`);
        expect(printed).toContain('Wants: $176.55 → $200.00');
        expect(printed).toContain('Needs: ');
        expect(printed).toContain('Nothing was changed.');
        expect(readHistory(life.h.db)).toEqual(before);
      }
    } finally {
      life.done();
    }
  });

  it('0.6 A28 13.5 with yes it takes the new totals, logs it, and the server starts again', async () => {
    const life = await aFewDays();
    try {
      wantsLandsInNeeds();
      const { result, printed } = await run(life, 'yes');
      expect(result).toBe('taken');
      expect(printed).toContain('The new totals are saved');
      expect(serverLinesIn(life.h.db)).toMatchObject([{ action: 'history-retotaled', date: '2026-10-09' }]);
      expect(opens(life)).toBe(true);
      // Run again: nothing to do.
      expect((await run(life, 'yes')).result).toBe('nothing to do');
    } finally {
      life.done();
    }
  });

  it('0.6 A28 with nothing to do it says so and asks nothing; with an event that cannot replay it says which, and asks nothing', async () => {
    const life = await aFewDays();
    try {
      const same = await run(life, 'yes');
      expect(same).toMatchObject({ result: 'nothing to do', asked: [] });
      expect(same.printed).toContain('Every event replays to the totals saved with it.');
      const answer = readHistory(life.h.db).find((e) => e.event.kind === 'answer' && e.event.answer.book !== undefined);
      life.h.db.prepare('UPDATE book_events SET payload = ? WHERE seq = ?').run(JSON.stringify({ book: [{ method: 'sort', args: ['no-such-item', { to: 'wants' }, '2026-10-02'] }] }), answer?.seq);
      const cannot = await run(life, 'yes');
      expect(cannot).toMatchObject({ result: 'cannot replay', asked: [] });
      expect(cannot.printed).toContain(`Event ${answer?.seq}, Oct 2, 2026 (his answer: sort) cannot be replayed now: the book refuses sort now: no item no-such-item.`);
    } finally {
      life.done();
    }
  });
});
