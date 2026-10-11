import { describe, expect, it } from 'vitest';
import { markFailed, markTrying, nextOutboxTry, readOutbox } from '../src/alerts/outbox.js';
import { HistoryDoesNotReplay, appendEvent, readHistory, type StoredEvent } from '../src/history/history-db.js';
import type { AlertsEvent } from '../src/alerts/plan.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// Phase 5, part one: what went out is kept in the book's history like his
// answers, so the replay check (0.6) covers it: a history that gives the same
// alert twice, or handles an evening twice, does not replay, and the books do
// not open. And the outbox and the history always agree: every row of the
// outbox has the "alerts" event that gave it, and every alert given has its
// row. Every name and number is made up.

const E = ACCOUNT_IDS.everyday;

// Oct 3: a take-back at 3:00 PM, a purchase left waiting, and the evening.
async function aDayOfAlerts(): Promise<Life> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-03');
  await life.sync();
  life.keeper.checkAlerts();
  life.h.fake.addPosted({ id: 'copy-1', account: E, amount: 1_150, date: '2026-10-02', description: 'MADE UP CAFE' });
  life.now = new Date('2026-10-03T18:00:00Z');
  await life.sync();
  life.keeper.checkAlerts();
  life.h.fake.removePosted('copy-1', { keepBalance: false });
  life.now = new Date('2026-10-03T19:00:00Z');
  await life.sync();
  life.keeper.checkAlerts();
  life.h.fake.addPosted({ id: 'shop-1', account: E, amount: 2_399, date: '2026-10-03', description: 'MADE UP SHOP' });
  await life.sync();
  life.now = new Date('2026-10-04T00:00:00Z');
  life.keeper.checkAlerts();
  return life;
}

const alertsEvents = (life: Life): (StoredEvent & { readonly event: { readonly kind: 'alerts'; readonly alerts: AlertsEvent } })[] =>
  readHistory(life.h.db).flatMap((e) => (e.event.kind === 'alerts' ? [e as StoredEvent & { readonly event: { readonly kind: 'alerts'; readonly alerts: AlertsEvent } }] : []));

function opening(life: Life): unknown {
  try {
    life.reopen().close();
    return null;
  } catch (error) {
    return error;
  }
}

describe('B181 the outbox tries again the one due first', () => {
  it('10.3 10.6 B181 with two sends failing at different moments, the next try is the earlier one', async () => {
    const life = await aDayOfAlerts();
    try {
      const db = life.h.db;
      const at = life.now.toISOString();
      // The take-back failed once (tried again in 1 minute); the review twice (in 2 minutes).
      markTrying(db, 'bank-took-back copy-1', at);
      markFailed(db, 'bank-took-back copy-1', at, 'the phone cannot be reached');
      markTrying(db, 'daily-review 2026-10-03', at);
      markTrying(db, 'daily-review 2026-10-03', at);
      markFailed(db, 'daily-review 2026-10-03', at, 'the phone cannot be reached');
      expect(nextOutboxTry(db)).toBe(new Date(life.now.getTime() + 60_000).toISOString());
      expect(life.keeper.nextTryIn()).toBe(60_000);
      expect(life.keeper.toSend()).toEqual([]);
      life.now = new Date(life.now.getTime() + 60_000);
      expect(life.keeper.toSend().map((r) => r.id)).toEqual(['bank-took-back copy-1']);
    } finally {
      life.done();
    }
  });
});

describe('0.6 the replay check covers the alerts', () => {
  it('0.6 10.6 the outbox and the history agree: every row has the event that gave it, and every alert given has its row', async () => {
    const life = await aDayOfAlerts();
    try {
      const events = alertsEvents(life);
      const given = events.flatMap((e) => e.event.alerts.given.map((g) => ({ key: g.key, seq: e.seq, dueAt: g.dueAt, title: g.title, body: g.body })));
      expect(given.map((g) => g.key)).toEqual(['bank-took-back copy-1', 'daily-review 2026-10-03']);
      const rows = readOutbox(life.h.db, 1_000).rows.map((r) => ({ key: r.key, seq: r.seq, dueAt: r.dueAt, title: r.title, body: r.body }));
      const byKey = (a: { readonly key: string }, b: { readonly key: string }): number => a.key.localeCompare(b.key);
      expect(rows.toSorted(byKey)).toEqual(given.toSorted(byKey));
      // Opened again, the books replay the history, alerts and all.
      expect(opening(life)).toBeNull();
    } finally {
      life.done();
    }
  });

  it('0.6 10.6 an alert given twice in the history does not replay: the books do not open, and it says where', async () => {
    const life = await aDayOfAlerts();
    try {
      const gave = alertsEvents(life).find((e) => e.event.alerts.given.some((g) => g.key === 'bank-took-back copy-1'));
      if (gave === undefined) throw new Error('no take-back alert');
      const copy = { ...gave.event.alerts, at: '2026-10-04T00:05:00.000Z', check: { kind: 'change' as const } };
      appendEvent(life.h.db, { event: { kind: 'alerts', alerts: copy }, date: '2026-10-03', sync: null, totals: gave.totals });
      const error = opening(life);
      expect(error).toBeInstanceOf(HistoryDoesNotReplay);
      expect((error as HistoryDoesNotReplay).at).toMatchObject({ kind: 'alerts' });
    } finally {
      life.done();
    }
  });

  it('0.6 10.3 an evening handled twice does not replay either', async () => {
    const life = await aDayOfAlerts();
    try {
      const evening = alertsEvents(life).find((e) => e.event.alerts.check.kind === 'evening');
      if (evening === undefined) throw new Error('no evening');
      appendEvent(life.h.db, { event: { kind: 'alerts', alerts: { ...evening.event.alerts, given: [] } }, date: '2026-10-03', sync: null, totals: evening.totals });
      expect(opening(life)).toBeInstanceOf(HistoryDoesNotReplay);
    } finally {
      life.done();
    }
  });
});
