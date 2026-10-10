import { afterEach, describe, expect, it } from 'vitest';
import { readHistory } from '../src/history/history-db.js';
import { memoryLog } from '../src/log.js';
import type { KeyedDetail } from '../src/views/review.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { decision, lifeInAFile, noonInNewYork, screens, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// Step 3: a sync and his answers never write at the same time, and an answer
// about something a sync just changed is refused with why: nothing changes,
// and he looks again (QUESTIONS.md A31). Each item on a screen comes with its
// key, which the screen sends back with the answer (seen). Every name and
// number is made up.

const E = ACCOUNT_IDS.everyday;
const C = ACCOUNT_IDS.checking;

const lives: Life[] = [];
afterEach(() => {
  for (const life of lives.splice(0)) life.done();
});

async function setUp(): Promise<Life> {
  const life = await lifeInAFile();
  lives.push(life);
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-03');
  return life;
}

// The item as Review shows it now.
function shown(life: Life, id: string): KeyedDetail {
  const view = life.keeper.review();
  if (view.state !== 'tracking') throw new Error('not tracking');
  const item = view.items.find((d) => d.item.id === id);
  if (item === undefined) throw new Error(`${id} is not in review`);
  return item;
}

function counts(life: Life): { readonly events: number; readonly decisions: unknown } {
  return { events: readHistory(life.h.db).length, decisions: life.h.db.prepare('SELECT COUNT(*) AS n FROM decisions').get() };
}

describe('Step 3: an answer about something a sync just changed is refused, with why', () => {
  it('A31 a pending charge that posted with a tip after Review showed it: the answer is refused with how it is now, nothing changes; with the new look it goes through', async () => {
    const life = await setUp();
    life.h.fake.addPending({ id: 'cafe-1', account: E, amount: 1_150, date: '2026-10-03', description: 'MADE UP CAFE' });
    await life.sync();
    const seen = shown(life, 'cafe-1');
    // Meanwhile the bank posts it, with a tip.
    life.h.fake.postPending('cafe-1', { id: 'cafe-1-posted', date: '2026-10-04', amount: 1_350 });
    await life.sync();
    const before = { counts: counts(life), screens: screens(life.keeper) };
    const id = decision();
    expect(life.keeper.choice({ id, item: 'cafe-1', choice: { to: 'wants' }, seen: seen.key })).toEqual({
      ok: false,
      code: 'changed',
      why: 'MADE UP CAFE changed since you looked: it is now $13.50. Look at it again, then choose. Nothing was changed.',
    });
    expect(counts(life)).toEqual(before.counts);
    expect(screens(life.keeper)).toEqual(before.screens);
    // Looked at again: the same decision number, with what he sees now, goes through once.
    const now = shown(life, 'cafe-1');
    expect(now.key).not.toBe(seen.key);
    expect(life.keeper.choice({ id, item: 'cafe-1', choice: { to: 'wants' }, seen: now.key })).toMatchObject({ ok: true, replayed: false });
    expect(life.keeper.book()?.pots().wants).toBe(20_000 - 1_350);
  });

  it('A31 a pending charge that posts at the same amount has changed too: it showed as pending', async () => {
    const life = await setUp();
    life.h.fake.addPending({ id: 'cafe-1', account: E, amount: 1_150, date: '2026-10-03', description: 'MADE UP CAFE' });
    await life.sync();
    const seen = shown(life, 'cafe-1');
    life.h.fake.postPending('cafe-1', { id: 'cafe-1-posted', date: '2026-10-04' });
    await life.sync();
    expect(shown(life, 'cafe-1').item.amount).toBe(1_150);
    expect(life.keeper.choice({ id: decision(), item: 'cafe-1', choice: { to: 'wants' }, seen: seen.key })).toEqual({
      ok: false,
      code: 'changed',
      why: 'MADE UP CAFE changed since you looked: it is now $11.50. Look at it again, then choose. Nothing was changed.',
    });
  });

  it('A31 a pending amount the bank changed (4.6) says it is still pending', async () => {
    const life = await setUp();
    life.h.fake.addPending({ id: 'gas-1', account: E, amount: 100, date: '2026-10-03', description: 'MADE UP FUEL' });
    await life.sync();
    const seen = shown(life, 'gas-1');
    life.h.fake.modify('gas-1', { amount: 4_210 });
    await life.sync();
    expect(life.keeper.choice({ id: decision(), item: 'gas-1', choice: { to: 'needs' }, seen: seen.key })).toMatchObject({
      ok: false,
      code: 'changed',
      why: 'MADE UP FUEL changed since you looked: it is now $42.10, still pending. Look at it again, then choose. Nothing was changed.',
    });
  });

  it('A31 an answer about an item the sync did not touch goes through: only what changed is refused', async () => {
    const life = await setUp();
    life.h.fake.addPosted({ id: 'books-1', account: E, amount: 4_210, date: '2026-10-02', description: 'MADE UP BOOKSHOP' });
    life.h.fake.addPending({ id: 'cafe-1', account: E, amount: 1_150, date: '2026-10-03', description: 'MADE UP CAFE' });
    await life.sync();
    const books = shown(life, 'books-1');
    const cafe = shown(life, 'cafe-1');
    life.h.fake.postPending('cafe-1', { id: 'cafe-1-posted', date: '2026-10-04', amount: 1_350 });
    life.h.fake.addPosted({ id: 'store-1', account: E, amount: 999, date: '2026-10-04', description: 'CORNER STORE 12' });
    await life.sync();
    expect(life.keeper.choice({ id: decision(), item: 'books-1', choice: { to: 'wants' }, seen: books.key })).toMatchObject({ ok: true });
    expect(life.keeper.choice({ id: decision(), item: 'cafe-1', choice: { to: 'wants' }, seen: cafe.key })).toMatchObject({ ok: false, code: 'changed' });
  });

  it('A31 4.5 a new purchase joining the likely purchases of a refund waiting in review does not change the refund: matching it to the one he picked goes through', async () => {
    const life = await setUp();
    life.h.fake.addPosted({ id: 'shoes-1', account: E, amount: 8_000, date: '2026-10-02', description: 'MADE UP SHOES' });
    life.h.fake.addPosted({ id: 'shoes-back', account: E, amount: -2_000, date: '2026-10-03', description: 'MADE UP SHOES' });
    await life.sync();
    const refund = shown(life, 'shoes-back');
    expect(refund.likelyPurchases.map((p) => p.id)).toEqual(['shoes-1']);
    life.h.fake.addPosted({ id: 'shoes-2', account: E, amount: 2_000, date: '2026-10-03', description: 'MADE UP SHOES' });
    await life.sync();
    expect(shown(life, 'shoes-back').likelyPurchases.map((p) => p.id).sort()).toEqual(['shoes-1', 'shoes-2']);
    expect(shown(life, 'shoes-back').key).toBe(refund.key);
    const id = decision();
    const asked = life.keeper.choice({ id, item: 'shoes-back', choice: { refundOf: 'shoes-1' }, seen: refund.key });
    expect(asked).toMatchObject({ ok: false, code: 'needs-confirmation' });
    expect(life.keeper.choice({ id, item: 'shoes-back', choice: { refundOf: 'shoes-1' }, seen: refund.key, confirmed: true })).toMatchObject({ ok: true });
  });

  it('A31 3.4 a payday question that spending from before payday made smaller since Payday showed it is refused, with what it asks now', async () => {
    const life = await setUp();
    const k = life.keeper;
    const id = decision();
    const asked = k.settingsChange({ id, settings: { paycheckRule: { contains: 'MADEUP CORP PAYROLL' } } });
    if (asked.ok || asked.preview === undefined) throw new Error('the paycheck rule did not ask first');
    expect(k.settingsChange({ id, settings: { paycheckRule: { contains: 'MADEUP CORP PAYROLL' } }, confirmed: true, seen: asked.preview.key })).toMatchObject({ ok: true });
    life.now = noonInNewYork('2026-10-09');
    life.h.fake.addPosted({ id: 'pay-1', account: C, amount: -250_000, date: '2026-10-09', description: 'MADEUP CORP PAYROLL' });
    await life.sync();
    const payday = k.payday();
    if (payday.state !== 'tracking') throw new Error('not tracking');
    const wants = payday.questions.find((q) => q.item.type === 'leftover' && q.item.bucket === 'wants');
    if (wants === undefined || wants.item.type !== 'leftover') throw new Error('no wants question');
    // A purchase from before payday shows up after it.
    life.h.fake.addPosted({ id: 'late-1', account: E, amount: 2_500, date: '2026-10-08', description: 'MADE UP DINER' });
    await life.sync();
    k.choice({ id: decision(), item: 'late-1', choice: { to: 'wants' } });
    const answer = k.choice({ id: decision(), item: wants.item.id, choice: { leftover: 'move-to-savings' }, seen: wants.key });
    expect(answer).toMatchObject({ ok: false, code: 'changed', why: `Wants leftover changed since you looked: it is now $${((wants.item.amount - 2_500) / 100).toFixed(2)}. Look at it again, then choose. Nothing was changed.` });
  });

  it('A31 4.7 sorting again from a bucket\'s list: a row the bank changed since the list showed it is refused', async () => {
    const life = await setUp();
    life.h.fake.addPending({ id: 'cafe-1', account: E, amount: 1_150, date: '2026-10-03', description: 'MADE UP CAFE' });
    await life.sync();
    expect(life.keeper.choice({ id: decision(), item: 'cafe-1', choice: { to: 'wants' } })).toMatchObject({ ok: true });
    const list = life.keeper.activity('wants');
    if (list.state !== 'tracking') throw new Error('not tracking');
    const key = list.keys['cafe-1'];
    expect(key).toMatch(/^[0-9a-f]{16}$/);
    life.h.fake.postPending('cafe-1', { id: 'cafe-1-posted', date: '2026-10-04', amount: 1_350 });
    await life.sync();
    const events = readHistory(life.h.db).length;
    expect(life.keeper.choice({ id: decision(), item: 'cafe-1', choice: { to: 'needs' }, resort: true, seen: key! })).toMatchObject({
      ok: false,
      code: 'changed',
      why: 'MADE UP CAFE changed since you looked: it is now $13.50. Look at it again, then choose. Nothing was changed.',
    });
    expect(readHistory(life.h.db)).toHaveLength(events);
    const now = life.keeper.activity('wants');
    if (now.state !== 'tracking') throw new Error('not tracking');
    expect(life.keeper.choice({ id: decision(), item: 'cafe-1', choice: { to: 'needs' }, resort: true, seen: now.keys['cafe-1']! })).toMatchObject({ ok: true });
  });

  it('A31 the same item, unchanged, keeps its key: across another answer, a sync with nothing for it, and a restart', async () => {
    const life = await setUp();
    life.h.fake.addPosted({ id: 'books-1', account: E, amount: 4_210, date: '2026-10-02', description: 'MADE UP BOOKSHOP' });
    life.h.fake.addPosted({ id: 'store-1', account: E, amount: 999, date: '2026-10-02', description: 'CORNER STORE 12' });
    await life.sync();
    const key = shown(life, 'books-1').key;
    expect(life.keeper.choice({ id: decision(), item: 'store-1', choice: { to: 'needs' } })).toMatchObject({ ok: true });
    await life.sync();
    life.restart();
    expect(shown(life, 'books-1').key).toBe(key);
    expect(life.keeper.choice({ id: decision(), item: 'books-1', choice: { to: 'wants' }, seen: key })).toMatchObject({ ok: true });
  });

  it('A31 a key that is not one is not a choice at all', async () => {
    const life = await setUp();
    life.h.fake.addPosted({ id: 'books-1', account: E, amount: 4_210, date: '2026-10-02', description: 'MADE UP BOOKSHOP' });
    await life.sync();
    const { parseChoiceRequest } = await import('../src/choices.js');
    for (const seen of ['', 'nope', 'ABCDEF0123456789', '0123456789abcdef0', 42, null]) expect(parseChoiceRequest({ id: decision(), item: 'books-1', choice: { to: 'wants' }, seen }), String(seen)).toBeNull();
    expect(parseChoiceRequest({ id: 'decision-x1', item: 'books-1', choice: { to: 'wants' }, seen: shown(life, 'books-1').key })).not.toBeNull();
  });
});

describe('Step 3: a sync and his answers never write at the same time', () => {
  it('an answer that comes the moment a sync has saved is given to the book with the sync in it: the history replays, and a fresh copy from the database is the same', async () => {
    let atCommit: (() => void) | null = null;
    const life = await lifeInAFile({ beforeCommit: () => atCommit?.() });
    lives.push(life);
    setUpThroughTheDesk(life);
    life.now = noonInNewYork('2026-10-03');
    life.h.fake.addPosted({ id: 'cafe-1', account: E, amount: 1_150, date: '2026-10-03', description: 'MADE UP CAFE' });
    await life.sync();
    life.h.fake.addPosted({ id: 'books-1', account: E, amount: 4_210, date: '2026-10-03', description: 'MADE UP BOOKSHOP' });
    let answered: unknown;
    // The answer is the very next thing to run once the sync's save is committed.
    atCommit = () => {
      atCommit = null;
      queueMicrotask(() => {
        answered = life.keeper.choice({ id: decision(), item: 'cafe-1', choice: { to: 'wants' } });
      });
    };
    await life.sync();
    expect(answered).toMatchObject({ ok: true });
    const history = readHistory(life.h.db);
    expect(history.at(-2)?.event).toMatchObject({ kind: 'receive', txn: { id: 'books-1' } });
    expect(history.at(-1)?.event.kind).toBe('answer');
    expect(history.at(-1)?.totals?.waiting).toBe(1);
    const fresh = life.reopen();
    try {
      expect(screens(fresh.keeper)).toEqual(screens(life.keeper));
    } finally {
      fresh.close();
    }
  });

  it('an answer that comes while a sync is reading the bank is saved first, and the sync saves after it, working from it', async () => {
    const life = await setUp();
    life.h.fake.addPosted({ id: 'cafe-1', account: E, amount: 1_150, date: '2026-10-03', description: 'MADE UP CAFE' });
    await life.sync();
    life.h.fake.addPosted({ id: 'books-1', account: E, amount: 4_210, date: '2026-10-03', description: 'MADE UP BOOKSHOP' });
    let answered: unknown;
    life.h.fake.beforeCall = (endpoint) => {
      if (endpoint === '/accounts/get' && answered === undefined) answered = life.keeper.choice({ id: decision(), item: 'cafe-1', choice: { to: 'wants' } });
      return undefined;
    };
    await life.sync();
    expect(answered).toMatchObject({ ok: true });
    const history = readHistory(life.h.db);
    expect(history.at(-2)?.event.kind).toBe('answer');
    expect(history.at(-1)?.event).toMatchObject({ kind: 'receive', txn: { id: 'books-1' } });
    expect(life.keeper.book()?.reviewItems().map((i) => i.id)).toEqual(['books-1']);
    const fresh = life.reopen();
    try {
      expect(screens(fresh.keeper)).toEqual(screens(life.keeper));
    } finally {
      fresh.close();
    }
  });
});

describe('Step 3: the running books follow the database', () => {
  it('a sync saved by another copy of the server on the same books is in the running books after their next sync, even when that one brings nothing new', async () => {
    const life = await setUp();
    const other = life.reopen();
    try {
      life.h.fake.addPosted({ id: 'books-1', account: E, amount: 4_210, date: '2026-10-03', description: 'MADE UP BOOKSHOP' });
      await other.keeper.sync({ plaid: life.h.plaid, box: life.h.box, log: memoryLog([]), pageSize: 3 });
      expect(other.keeper.book()?.reviewItems().map((i) => i.id)).toEqual(['books-1']);
      await life.sync();
      expect(life.keeper.book()?.reviewItems().map((i) => i.id)).toEqual(['books-1']);
      expect(screens(life.keeper)).toEqual(screens(other.keeper));
    } finally {
      other.close();
    }
  });
});
