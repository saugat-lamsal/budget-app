import { MOVABLE_POTS, type Book } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { busyBook } from '../../money/test/busy-book.js';
import { ReplayFailed, recorderOf, replayCall, sameTotals, totalsOf } from '../src/history/history.js';

// The book's history (the real server keeps everything): each answer of his
// is written down exactly as the book took it, and given to the book again
// on a replay, with the dates it was made on. Made-up names only.

const TODAY = '2026-10-09';

function leftoverId(book: Book, bucket: 'needs' | 'wants'): string {
  const item = book.reviewItems().find((i) => i.type === 'leftover' && i.bucket === bucket);
  if (item === undefined) throw new Error(`no ${bucket} leftover question`);
  return item.id;
}

// Everything the screens can read from a book.
export function everything(book: Book): unknown {
  const periods = book.period().number;
  return {
    pots: book.pots(),
    debt: book.oldCardDebt(),
    inTransit: book.inTransit(),
    settings: book.settings(),
    rules: book.rules(),
    review: book.reviewDetails(),
    purchases: book.purchases(),
    log: book.changeLog(),
    paychecks: book.paychecks(),
    period: book.period(),
    payday: book.paydayReport(),
    activity: MOVABLE_POTS.map((pot) => Array.from({ length: periods }, (_, i) => book.activity(pot, i + 1))),
    summaries: Array.from({ length: periods }, (_, i) => book.periodSummary(i + 1)),
  };
}

describe('the history: his answers, written down as the book took them', () => {
  it('each answer the book takes is written down as it was given, with its date; reading, refusals, a move that only asks, and a preview are not', () => {
    const recorder = recorderOf(busyBook());
    const book = recorder.book;
    // Outside a recording nothing is written down.
    book.moveMoney({ from: 'needs', to: 'wants', amount: 100 }, TODAY);
    recorder.start();
    book.pots();
    book.reviewDetails();
    book.sort('market', { to: 'wants' }, TODAY);
    expect(() => book.sort('no-such-item', { to: 'needs' }, TODAY)).toThrow();
    expect(book.moveMoney({ from: 'savings', to: 'wants', amount: 500 }, TODAY)).toMatchObject({ moved: false });
    book.moveMoney({ from: 'savings', to: 'wants', amount: 500, confirmed: true }, TODAY);
    book.previewSettingsChange({ momRule: { contains: 'MADE UP' } }, TODAY);
    book.answerLeftover(leftoverId(book, 'needs'), 'roll-over', TODAY);
    book.sortAlways('store', { to: 'needs' }, { id: 'always-1', contains: 'CORNER STORE' }, '2026-10-10');
    expect(recorder.take()).toEqual([
      { method: 'sort', args: ['market', { to: 'wants' }, TODAY] },
      { method: 'moveMoney', args: [{ from: 'savings', to: 'wants', amount: 500, confirmed: true }, TODAY] },
      { method: 'answerLeftover', args: [expect.any(String), 'roll-over', TODAY] },
      { method: 'sortAlways', args: ['store', { to: 'needs' }, { id: 'always-1', contains: 'CORNER STORE' }, '2026-10-10'] },
    ]);
    // Taken once: the next take starts empty.
    expect(recorder.take()).toEqual([]);
  });

  it('what is written down is a copy: changing what was handed to the book later changes nothing in it', () => {
    const recorder = recorderOf(busyBook());
    recorder.start();
    const choice = { split: [{ bucket: 'needs' as const, amount: 1_000 }, { bucket: 'wants' as const, amount: 1_317 }] };
    recorder.book.sort('market', choice, TODAY);
    choice.split[0]!.amount = 1;
    expect(recorder.take()[0]?.args[1]).toEqual({ split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wants', amount: 1_317 }] });
  });

  it('replaying the answers on a twin of the book gives the same book: every bucket, review, the change log, each bucket\'s list, Payday, the settings and rules', () => {
    const recorder = recorderOf(busyBook());
    const book = recorder.book;
    recorder.start();
    book.sort('market', { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wants', amount: 1_317 }] }, TODAY);
    book.answerLeftover(leftoverId(book, 'wants'), 'move-to-savings', TODAY);
    book.sort('tax', { to: 'other-income' }, TODAY);
    book.moveMoney({ from: 'wants', to: 'needs', amount: 2_500 }, TODAY);
    book.changeSettings({ lowBucketAlertPercent: 25, homeTimeZone: 'America/Chicago' }, TODAY);
    book.addRule({ id: 'rule-1', for: 'purchase', contains: 'DINER', bucket: 'wants' }, TODAY);
    book.sortAlways('store', { to: 'needs' }, { id: 'always-1', contains: 'CORNER STORE' }, '2026-10-10');
    const calls = recorder.take();
    expect(calls).toHaveLength(7);
    const twin = busyBook();
    expect(everything(twin)).not.toEqual(everything(book));
    for (const call of calls) replayCall(twin, call);
    expect(everything(twin)).toEqual(everything(book));
    expect(sameTotals(totalsOf(twin), totalsOf(book))).toBe(true);
  });

  it('an answer the book refuses now, or a hand move that now only asks, is a replay that failed', () => {
    const twin = busyBook();
    expect(() => replayCall(twin, { method: 'sort', args: ['no-such-item', { to: 'needs' }, TODAY] })).toThrow(ReplayFailed);
    expect(() => replayCall(twin, { method: 'moveMoney', args: [{ from: 'savings', to: 'wants', amount: 500 }, TODAY] })).toThrow(ReplayFailed);
    expect(() => replayCall(twin, { method: 'receive' as never, args: [] })).toThrow(ReplayFailed);
  });

  it('the totals checked after each event: every bucket, money waiting both ways, the old card debt, money in transit, and how many wait; none before setup day', () => {
    const book = busyBook();
    const totals = totalsOf(book);
    const pots = book.pots();
    expect(totals).toEqual({ ...pots, oldCardDebt: book.oldCardDebt(), inTransit: book.inTransit().total, waiting: book.reviewItems().length });
    expect(totalsOf(null)).toBeNull();
    expect(sameTotals(null, null)).toBe(true);
    expect(sameTotals(totals, null)).toBe(false);
    if (totals === null) throw new Error('no totals');
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) {
      expect(sameTotals(totals, { ...totals, [key]: totals[key] + 1 }), key).toBe(false);
    }
  });
});
