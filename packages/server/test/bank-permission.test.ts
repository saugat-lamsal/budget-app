import { type BankBalances, type Book } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { openTestBook } from '../../money/test/helpers.js';
import { alertScreen, alertWords, type AlertFacts } from '../src/alerts/alerts.js';
import { NO_ALERTS, applyAlerts, nextAlertsEvent, stillTrueNow, type AlertLedger, type AlertWorld, type AlertsEvent } from '../src/alerts/plan.js';
import { readConnection } from '../src/db/store.js';
import { readOutbox } from '../src/alerts/outbox.js';
import { lifeInAFile, noonInNewYork, setUpThroughTheDesk } from './keeper-harness.js';

// Rule 10.13 (QUESTIONS.md A45): the bank lets the app read the accounts only
// until a date it sets (Bank of America: a year after connecting or logging
// in again). When the bank gives the date, a sync keeps it, Settings' Bank
// screen shows it, and he is told once, the setting's days before it (7 to
// start), at the daily review time. Logging in again moves the date. Every
// name and number is made up. New York: 8:00 PM in October is 00:00 the next
// day in UTC.

const ZONE = 'America/New_York';
// Tue, Oct 20, 11:00 AM in New York.
const ENDS = '2026-10-20T15:00:00Z';

const BANK_OK = (book: Book): BankBalances => ({ checking: book.appSide() - book.inTransit().total, savings: 0, everydayCard: 0 });

function world(book: Book, now: string, extra: Partial<AlertWorld> = {}): AlertWorld {
  return { book, now: new Date(now), zone: ZONE, bank: BANK_OK(book), needsLogin: false, statements: [], lastRead: null, ...extra };
}

function look(w: AlertWorld, ledger: AlertLedger): { readonly events: AlertsEvent[]; readonly ledger: AlertLedger } {
  const events: AlertsEvent[] = [];
  for (let next = nextAlertsEvent(w, ledger); next !== null; next = nextAlertsEvent(w, ledger)) {
    events.push(next);
    ledger = applyAlerts(ledger, next);
    if (events.length > 100) throw new Error('it never stops');
  }
  return { events, ledger };
}

const given = (l: { readonly events: AlertsEvent[] }) => l.events.flatMap((e) => e.given);
const keys = (l: { readonly events: AlertsEvent[] }) => given(l).map((g) => g.key);

function book(settings: Parameters<typeof openTestBook>[0]['settings'] = {}): Book {
  return openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 150_000 }, settings });
}

function started(b: Book): AlertLedger {
  return look(world(b, '2026-10-01T16:00:00Z'), NO_ALERTS).ledger;
}

describe('10.13 the warning before the bank\'s permission runs out', () => {
  it('10.13 told once, at the daily review time, 7 days before the date the bank gave: not the evening before, and not again', () => {
    const b = book();
    let ledger = started(b);
    // The evening of Oct 12 is 8 days before: nothing.
    let l = look(world(b, '2026-10-13T00:00:00Z', { permissionEnds: ENDS }), ledger);
    expect(keys(l)).toEqual([]);
    ledger = l.ledger;
    // The evening of Oct 13 is 7 days before.
    l = look(world(b, '2026-10-14T00:00:00Z', { permissionEnds: ENDS }), ledger);
    expect(given(l)).toEqual([expect.objectContaining({ key: 'bank-permission ends 2026-10-20', dueAt: '2026-10-14T00:00:00.000Z', facts: { kind: 'bank-permission', ends: '2026-10-20' } })]);
    ledger = l.ledger;
    l = look(world(b, '2026-10-16T00:00:00Z', { permissionEnds: ENDS }), ledger);
    expect(keys(l)).toEqual([]);
  });

  it('10.13 section 2 the days are a setting: at 14, told 14 days before; at 1, the evening before', () => {
    const fourteen = book({ bankPermissionWarnDays: 14 });
    let l = look(world(fourteen, '2026-10-06T00:00:00Z', { permissionEnds: ENDS }), started(fourteen));
    expect(keys(l)).toEqual([]);
    l = look(world(fourteen, '2026-10-07T00:00:00Z', { permissionEnds: ENDS }), l.ledger);
    expect(given(l).map((g) => [g.key, g.dueAt])).toEqual([['bank-permission ends 2026-10-20', '2026-10-07T00:00:00.000Z']]);
    const one = book({ bankPermissionWarnDays: 1 });
    l = look(world(one, '2026-10-19T00:00:00Z', { permissionEnds: ENDS }), started(one));
    expect(keys(l)).toEqual([]);
    l = look(world(one, '2026-10-20T00:00:00Z', { permissionEnds: ENDS }), l.ledger);
    expect(keys(l)).toEqual(['bank-permission ends 2026-10-20']);
  });

  it('10.13 the date is his, in his home time zone: 11:30 PM on Oct 19 in New York is Oct 19, though it is Oct 20 in UTC', () => {
    const b = book();
    const late = '2026-10-20T03:30:00Z';
    const l = look(world(b, '2026-10-13T00:00:00Z', { permissionEnds: late }), started(b));
    expect(given(l).map((g) => [g.key, g.dueAt])).toEqual([['bank-permission ends 2026-10-19', '2026-10-13T00:00:00.000Z']]);
  });

  it('10.13 10.9 a date the server learns with fewer days left (or evenings it missed): told at the next daily review time, once', () => {
    const b = book();
    const ledger = started(b);
    // Down from Oct 1 until after the evening of Oct 17: one warning, at the newest evening.
    const l = look(world(b, '2026-10-18T01:00:00Z', { permissionEnds: ENDS }), ledger);
    expect(given(l).map((g) => [g.key, g.dueAt])).toEqual([['bank-permission ends 2026-10-20', '2026-10-18T00:00:00.000Z']]);
  });

  it('10.13 once it has run out, no warning: the bank wanting a new login says it then (10.5)', () => {
    const b = book();
    // Down over the evenings of Oct 13 to 19, back at 8:00 PM on Oct 20, after
    // it ran out at 11:00 AM: the warning is no longer true, so it is not given.
    expect(keys(look(world(b, '2026-10-21T00:00:00Z', { permissionEnds: ENDS }), started(b)))).toEqual([]);
    // Back at 9:00 AM on Oct 20, before it runs out: the newest evening's warning, still true.
    const morning = look(world(b, '2026-10-20T13:00:00Z', { permissionEnds: ENDS }), started(b));
    expect(given(morning).map((g) => [g.key, g.dueAt])).toEqual([['bank-permission ends 2026-10-20', '2026-10-20T00:00:00.000Z']]);
  });

  it('10.13 with no date from the bank, no warning', () => {
    const b = book();
    for (const extra of [{}, { permissionEnds: null }]) expect(keys(look(world(b, '2026-10-21T00:00:00Z', extra), started(b))), JSON.stringify(extra)).toEqual([]);
  });

  it('10.13 1.3 logging in again moves the date: a warning still waiting is no longer true, and the new date is told in its own time', () => {
    const b = book();
    const facts: AlertFacts = { kind: 'bank-permission', ends: '2026-10-20' };
    const ledger = started(b);
    expect(stillTrueNow(world(b, '2026-10-14T01:00:00Z', { permissionEnds: ENDS }), ledger, facts)).toBe(true);
    const nextYear = '2027-10-14T15:00:00Z';
    expect(stillTrueNow(world(b, '2026-10-14T01:00:00Z', { permissionEnds: nextYear }), ledger, facts)).toBe(false);
    expect(stillTrueNow(world(b, '2026-10-21T01:00:00Z', { permissionEnds: ENDS }), ledger, facts)).toBe(false);
    expect(stillTrueNow(world(b, '2026-10-14T01:00:00Z', { permissionEnds: null }), ledger, facts)).toBe(false);
  });

  it('10.13 the words: when it runs out, counted from the day it is sent, and what to do; no amounts; a tap opens the Bank screen', () => {
    const facts: AlertFacts = { kind: 'bank-permission', ends: '2026-10-20' };
    expect(alertWords(facts)).toEqual({ title: 'Log in to your bank again soon', body: 'The bank lets the app read your accounts until Tue, Oct 20. Logging in again keeps it reading, and nothing is lost.' });
    expect(alertWords(facts, { sentOn: '2026-10-13' }).title).toBe('Log in to your bank again within 7 days');
    expect(alertWords(facts, { sentOn: '2026-10-19' }).title).toBe('Log in to your bank again by tomorrow');
    expect(alertWords(facts, { sentOn: '2026-10-20' }).title).toBe('Log in to your bank again today');
    expect(alertWords(facts, { amounts: false })).toEqual(alertWords(facts));
    expect(alertScreen(facts)).toBe('/bank');
  });
});

describe('10.13 the date from the bank', () => {
  it('10.13 a sync reads when the bank\'s permission runs out and keeps it; the Bank screen shows it as his date', async () => {
    const life = await lifeInAFile();
    try {
      life.h.fake.consentExpiration = '2026-10-20T03:30:00Z';
      await life.sync();
      expect(readConnection(life.h.db)?.permissionEnds).toBe('2026-10-20T03:30:00Z');
      expect(life.keeper.bankDesk({ plaid: life.h.plaid, box: life.h.box, log: { info() {}, warn() {}, error() {} } as never }).view()).toMatchObject({ permissionEnds: '2026-10-19' });
      // He logged in again: a year on.
      life.h.fake.consentExpiration = '2027-10-12T15:00:00Z';
      await life.sync();
      expect(readConnection(life.h.db)?.permissionEnds).toBe('2027-10-12T15:00:00Z');
      // A bank that gives none: none kept.
      life.h.fake.consentExpiration = null;
      await life.sync();
      expect(readConnection(life.h.db)?.permissionEnds).toBeNull();
    } finally {
      life.done();
    }
  });

  it('10.13 when the bank cannot say the date just then, the sync reads everything else and keeps the date it had', async () => {
    const life = await lifeInAFile();
    try {
      life.h.fake.consentExpiration = ENDS;
      await life.sync();
      life.h.fake.consentExpiration = '2027-10-12T15:00:00Z';
      life.h.fake.beforeCall = (endpoint) => (endpoint === '/item/get' ? { status: 500, body: { error_type: 'API_ERROR', error_code: 'INTERNAL_SERVER_ERROR', error_message: 'made up' } } : undefined);
      life.h.fake.addPosted({ id: 'cafe-1', account: 'acct-everyday', amount: 1_150, date: '2026-10-01', description: 'MADE UP CAFE' });
      await life.sync();
      expect(readConnection(life.h.db)?.permissionEnds).toBe(ENDS);
      expect(life.h.db.prepare("SELECT COUNT(*) AS n FROM bank_items WHERE transaction_id = 'cafe-1'").get()).toEqual({ n: 1 });
    } finally {
      life.done();
    }
  });

  it('10.13 the running server tells it at its evening, through the outbox', async () => {
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life);
      life.h.fake.consentExpiration = ENDS;
      await life.sync();
      life.keeper.checkAlerts();
      // The evening of Oct 13, 7 days before.
      life.now = new Date('2026-10-14T00:00:00Z');
      life.keeper.checkAlerts();
      expect(readOutbox(life.h.db, 50).rows.map((r) => r.key)).toContain('bank-permission ends 2026-10-20');
      life.now = noonInNewYork('2026-10-15');
      life.keeper.checkAlerts();
      expect(readOutbox(life.h.db, 50).rows.filter((r) => r.key.startsWith('bank-permission'))).toHaveLength(1);
    } finally {
      life.done();
    }
  });
});
