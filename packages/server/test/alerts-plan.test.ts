import { type BankBalances, type Book, type CardStatement } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { cardCharge, openTestBook, paycheck, purchase, takenBack, transfer } from '../../money/test/helpers.js';
import { ReplayFailed } from '../src/history/history.js';
import { alertWords, type AlertFacts } from '../src/alerts/alerts.js';
import { NO_ALERTS, applyAlerts, nextAlertsEvent, nextDueIn, type AlertLedger, type AlertWorld, type AlertsEvent } from '../src/alerts/plan.js';

// Phase 5, part one: which alerts are due, and when, worked out from the book
// and what is known of the bank at one moment (alerts/plan.ts). Every name
// and number is made up. The times are in New York: in October 8:00 PM there
// is 00:00 the next day in UTC (EDT); from Nov 1 it is 01:00 (EST).

const ZONE = 'America/New_York';
const BANK_OK = (book: Book): BankBalances => {
  // Balances that match the book exactly: checking holds everything.
  return { checking: book.appSide() - book.inTransit().total, savings: 0, everydayCard: 0 };
};

interface Looked {
  readonly events: AlertsEvent[];
  readonly ledger: AlertLedger;
}

function world(book: Book, now: string, extra: Partial<AlertWorld> = {}): AlertWorld {
  return { book, now: new Date(now), zone: ZONE, bank: BANK_OK(book), needsLogin: false, statements: [], lastRead: null, ...extra };
}

// Everything due at this moment, as the server makes it: one event at a time.
function look(w: AlertWorld, ledger: AlertLedger): Looked {
  const events: AlertsEvent[] = [];
  for (let next = nextAlertsEvent(w, ledger); next !== null; next = nextAlertsEvent(w, ledger)) {
    events.push(next);
    ledger = applyAlerts(ledger, next);
    if (events.length > 100) throw new Error('it never stops');
  }
  return { events, ledger };
}

const keys = (l: Looked): string[] => l.events.flatMap((e) => e.given.map((g) => g.key));
const given = (l: Looked) => l.events.flatMap((e) => e.given);

function started(book: Book, now = '2026-10-01T16:00:00Z'): AlertLedger {
  return look(world(book, now), NO_ALERTS).ledger;
}

function book(options: Parameters<typeof openTestBook>[0] = {}): Book {
  return openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 150_000 }, ...options });
}

describe('Phase 5 the alerts start with the first look', () => {
  it('Phase 5 the first look starts them: before the review time the evenings count from that day, after it from the next', () => {
    const before = look(world(book(), '2026-10-01T16:00:00Z'), NO_ALERTS);
    expect(before.events.map((e) => e.check)).toEqual([{ kind: 'start', eveningsFrom: '2026-10-01', known: [] }]);
    // 8:30 PM in New York is 00:30 the next day in UTC.
    const after = look(world(book(), '2026-10-02T00:30:00Z'), NO_ALERTS);
    expect(after.events[0]?.check).toEqual({ kind: 'start', eveningsFrom: '2026-10-02', known: [] });
  });

  it('10.6 take-backs already there when the alerts start get no alert; one after it does', () => {
    const b = book();
    b.receive(purchase('copy', '2026-10-01', 1_000, 'MADE UP SHOP'));
    b.receive(takenBack('tb1', 'copy', '2026-10-01'));
    const first = look(world(b, '2026-10-01T16:00:00Z'), NO_ALERTS);
    expect(first.events[0]?.check).toMatchObject({ kind: 'start', known: ['copy'] });
    expect(keys(first)).toEqual([]);
    b.receive(purchase('copy2', '2026-10-02', 2_000, 'MADE UP SHOP'));
    b.receive(takenBack('tb2', 'copy2', '2026-10-02'));
    expect(keys(look(world(b, '2026-10-02T16:00:00Z'), first.ledger))).toEqual(['bank-took-back copy2']);
  });

  it('Phase 5 nothing to tell makes no event at all', () => {
    const b = book();
    const ledger = started(b);
    expect(nextAlertsEvent(world(b, '2026-10-01T17:00:00Z'), ledger)).toBeNull();
  });
});

describe('10.3 the daily review', () => {
  it('10.3 at the review time in his home time zone, only when something waits, with how many', () => {
    const b = book();
    const ledger = started(b);
    b.receive(purchase('p1', '2026-10-01', 1_000, 'MADE UP BOOKSHOP'));
    b.receive(purchase('p2', '2026-10-01', 2_000, 'MADE UP CINEMA'));
    // 7:59 PM: not yet.
    expect(keys(look(world(b, '2026-10-01T23:59:00Z'), ledger))).toEqual([]);
    const evening = look(world(b, '2026-10-02T00:00:00Z'), ledger);
    expect(given(evening)).toEqual([
      { key: 'daily-review 2026-10-01', facts: { kind: 'daily-review', date: '2026-10-01', waiting: 2 }, dueAt: '2026-10-02T00:00:00.000Z', title: 'Time to review', body: '2 things are waiting for you to sort.' },
    ]);
    expect(evening.events.map((e) => e.check)).toEqual([{ kind: 'evening', date: '2026-10-01', dueAt: '2026-10-02T00:00:00.000Z' }]);
    // Once: looking again that evening gives nothing.
    expect(look(world(b, '2026-10-02T00:30:00Z'), evening.ledger).events).toEqual([]);
  });

  it('10.3 one thing waiting says so in the singular', () => {
    const b = book();
    const ledger = started(b);
    b.receive(purchase('p1', '2026-10-01', 1_000, 'MADE UP BOOKSHOP'));
    expect(given(look(world(b, '2026-10-02T00:00:00Z'), ledger))[0]?.body).toBe('1 thing is waiting for you to sort.');
  });

  it('10.3 an evening with nothing waiting is still handled, once, and gives nothing', () => {
    const b = book();
    const evening = look(world(b, '2026-10-02T00:00:00Z'), started(b));
    expect(evening.events).toEqual([{ at: '2026-10-02T00:00:00.000Z', check: { kind: 'evening', date: '2026-10-01', dueAt: '2026-10-02T00:00:00.000Z' }, given: [], cleared: [] }]);
    expect(evening.ledger.nextEvening).toBe('2026-10-02');
  });

  it('section 2 10.3 the review time is a setting: changed to 9:15 PM, the evening comes then', () => {
    const b = book();
    const ledger = started(b);
    b.receive(purchase('p1', '2026-10-01', 1_000, 'MADE UP BOOKSHOP'));
    b.changeSettings({ dailyReviewTime: '21:15' }, '2026-10-01');
    expect(keys(look(world(b, '2026-10-02T01:14:00Z'), ledger))).toEqual([]);
    expect(given(look(world(b, '2026-10-02T01:15:00Z'), ledger))[0]?.dueAt).toBe('2026-10-02T01:15:00.000Z');
    expect(nextDueIn(world(b, '2026-10-02T01:00:00Z'), ledger)).toBe(15 * 60_000);
  });

  it('section 2 the evening follows his home time zone\'s clock across Nov 1 2026 and Mar 14 2027', () => {
    const b = book({ date: '2026-10-31' });
    let ledger = started(b, '2026-10-31T16:00:00Z');
    const dueAts: string[] = [];
    for (const now of ['2026-11-01T00:00:00Z', '2026-11-02T01:00:00Z', '2026-11-03T01:00:00Z']) {
      const l = look(world(b, now), ledger);
      dueAts.push(...l.events.map((e) => (e.check.kind === 'evening' ? e.check.dueAt : '')));
      ledger = l.ledger;
    }
    // Oct 31 and Nov 1 at 8:00 PM: EDT, then EST.
    expect(dueAts).toEqual(['2026-11-01T00:00:00.000Z', '2026-11-02T01:00:00.000Z', '2026-11-03T01:00:00.000Z']);
    const spring = openTestBook({ date: '2027-03-13', lastPaycheckDate: '2027-03-05' });
    let l2 = started(spring, '2027-03-13T17:00:00Z');
    const springDue: string[] = [];
    for (const now of ['2027-03-14T01:00:00Z', '2027-03-15T00:00:00Z']) {
      const l = look(world(spring, now), l2);
      springDue.push(...l.events.map((e) => (e.check.kind === 'evening' ? e.check.dueAt : '')));
      l2 = l.ledger;
    }
    expect(springDue).toEqual(['2027-03-14T01:00:00.000Z', '2027-03-15T00:00:00.000Z']);
  });
});

describe('10.9 A36 alerts that came due while the server was down', () => {
  it('10.9 A36 three evenings down: when it is back, one daily review, the newest, with how many wait now, due at its own evening', () => {
    const b = book();
    const ledger = started(b);
    b.receive(purchase('p1', '2026-10-01', 1_000, 'MADE UP BOOKSHOP'));
    b.receive(purchase('p2', '2026-10-01', 2_000, 'MADE UP CINEMA'));
    // Back at 9:30 AM on Oct 4: the evenings of Oct 1, 2 and 3 came meanwhile.
    const back = look(world(b, '2026-10-04T13:30:00Z'), ledger);
    expect(back.events.map((e) => e.check)).toEqual([{ kind: 'evening', from: '2026-10-01', date: '2026-10-03', dueAt: '2026-10-04T00:00:00.000Z' }]);
    expect(back.events[0]?.at).toBe('2026-10-04T13:30:00.000Z');
    expect(given(back)).toEqual([
      { key: 'daily-review 2026-10-03', facts: { kind: 'daily-review', date: '2026-10-03', waiting: 2 }, dueAt: '2026-10-04T00:00:00.000Z', title: 'Time to review', body: '2 things are waiting for you to sort.' },
    ]);
    expect(back.ledger.nextEvening).toBe('2026-10-04');
    expect(look(world(b, '2026-10-04T13:31:00Z'), back.ledger).events).toEqual([]);
    // The next evening comes as usual.
    expect(keys(look(world(b, '2026-10-05T00:00:00Z'), back.ledger))).toEqual(['daily-review 2026-10-04']);
  });

  it("10.9 A36 down over one evening only: that evening's alerts when it is back, due 8:00 PM", () => {
    const b = book();
    const ledger = started(b);
    b.receive(purchase('p1', '2026-10-01', 1_000, 'MADE UP BOOKSHOP'));
    // Back at 9:30 PM.
    const back = look(world(b, '2026-10-02T01:30:00Z'), ledger);
    expect(back.events.map((e) => e.check)).toEqual([{ kind: 'evening', date: '2026-10-01', dueAt: '2026-10-02T00:00:00.000Z' }]);
    expect(given(back).map((g) => [g.key, g.dueAt])).toEqual([['daily-review 2026-10-01', '2026-10-02T00:00:00.000Z']]);
  });

  it('10.9 A36 nothing waiting: the evenings are handled, once, and give nothing', () => {
    const b = book();
    const back = look(world(b, '2026-10-04T13:30:00Z'), started(b));
    expect(back.events).toEqual([{ at: '2026-10-04T13:30:00.000Z', check: { kind: 'evening', from: '2026-10-01', date: '2026-10-03', dueAt: '2026-10-04T00:00:00.000Z' }, given: [], cleared: [] }]);
    expect(back.ledger.nextEvening).toBe('2026-10-04');
  });
});

describe('10.1 and 10.2 low and empty buckets', () => {
  it('10.1 below the alert level: one low alert, with what is left and what it started with, and not again this pay period', () => {
    const b = book();
    const ledger = started(b);
    b.receive(purchase('p1', '2026-10-02', 40_001, 'MADE UP GROCER'));
    b.sort('p1', { to: 'needs' }, '2026-10-02');
    const low = look(world(b, '2026-10-02T15:00:00Z'), ledger);
    expect(given(low)).toEqual([
      { key: 'low-bucket needs pay period 0', facts: { kind: 'low-bucket', bucket: 'needs', period: 0, amount: 9_999, startedWith: 50_000 }, dueAt: '2026-10-02T15:00:00.000Z', title: 'Needs is low', body: '$99.99 left of $500.00 this pay period.' },
    ]);
    b.receive(purchase('p2', '2026-10-02', 1_000, 'MADE UP GROCER'));
    b.sort('p2', { to: 'needs' }, '2026-10-02');
    expect(keys(look(world(b, '2026-10-02T16:00:00Z'), low.ledger))).toEqual([]);
  });

  it('10.1 B57 exactly at the level is not low; a cent under it is', () => {
    const b = book();
    const ledger = started(b);
    b.moveMoney({ from: 'needs', to: 'savings', amount: 40_000, confirmed: true }, '2026-10-02');
    expect(keys(look(world(b, '2026-10-02T15:00:00Z'), ledger))).toEqual([]);
    b.moveMoney({ from: 'needs', to: 'savings', amount: 1, confirmed: true }, '2026-10-02');
    expect(keys(look(world(b, '2026-10-02T15:01:00Z'), ledger))).toEqual(['low-bucket needs pay period 0']);
  });

  it('10.2 at zero, the empty alert, once this pay period; still empty when a new pay period starts, again (B50)', () => {
    const b = book();
    let ledger = started(b);
    b.moveMoney({ from: 'wants', to: 'savings', amount: 30_000, confirmed: true }, '2026-10-02');
    let l = look(world(b, '2026-10-02T15:00:00Z'), ledger);
    expect(given(l).map((g) => [g.key, g.title, g.body])).toEqual([['empty-bucket wants pay period 0', 'Wants is empty', 'Nothing is left in it for this pay period.']]);
    ledger = l.ledger;
    b.receive(purchase('p1', '2026-10-03', 500, 'MADE UP CINEMA'));
    b.sort('p1', { to: 'wants' }, '2026-10-03');
    l = look(world(b, '2026-10-03T15:00:00Z'), ledger);
    expect(keys(l)).toEqual([]);
    ledger = l.ledger;
    // The paycheck: wants is -5.00 + its share, still... at a split with no wants it stays below zero.
    b.changeSettings({ split: { savings: 70, needs: 30, wants: 0 } }, '2026-10-03');
    b.receive(paycheck('pay', '2026-10-09', 100_000));
    l = look(world(b, '2026-10-09T15:00:00Z'), ledger);
    expect(given(l).map((g) => [g.key, g.body])).toContainEqual(['empty-bucket wants pay period 1', 'It is $5.00 over for this pay period.']);
  });

  it('10.1 B58 at zero or below only the empty alert; back above zero and under the level, the low one then', () => {
    const b = book();
    let ledger = started(b);
    b.moveMoney({ from: 'wants', to: 'savings', amount: 30_000, confirmed: true }, '2026-10-02');
    let l = look(world(b, '2026-10-02T15:00:00Z'), ledger);
    expect(keys(l)).toEqual(['empty-bucket wants pay period 0']);
    ledger = l.ledger;
    b.moveMoney({ from: 'savings', to: 'wants', amount: 100, confirmed: true }, '2026-10-02');
    l = look(world(b, '2026-10-02T15:05:00Z'), ledger);
    expect(given(l).map((g) => g.facts)).toEqual([{ kind: 'low-bucket', bucket: 'wants', period: 0, amount: 100, startedWith: 30_000 }]);
  });
});

describe('10.6 the bank taking something back', () => {
  it('10.6 once, when it happens, with what, how much and when', () => {
    const b = book();
    const ledger = started(b);
    b.receive(purchase('dup', '2026-10-02', 1_250, 'MADE UP CAFE'));
    b.sort('dup', { to: 'wants' }, '2026-10-02');
    b.receive(takenBack('tb', 'dup', '2026-10-03'));
    const l = look(world(b, '2026-10-03T14:00:00Z'), ledger);
    expect(given(l).map((g) => [g.key, g.title, g.body])).toEqual([['bank-took-back dup', 'The bank took something back', 'MADE UP CAFE, $12.50, taken back Sat, Oct 3. It is undone in your buckets too.']]);
    expect(keys(look(world(b, '2026-10-03T15:00:00Z'), l.ledger))).toEqual([]);
  });
});

describe('9.1 to 9.4 card reminders and the overdue alert, at the review time (A34)', () => {
  const everyday: CardStatement = { card: 'everyday-card', closingDate: '2026-09-28', dueDate: '2026-10-23', statementBalance: 45_025, minimumPayment: 3_500 };
  const old: CardStatement = { card: 'old-card', closingDate: '2026-09-28', dueDate: '2026-10-23', statementBalance: 280_000, minimumPayment: 6_000 };

  function cards(b: Book, ledger: AlertLedger, nows: readonly string[]): { readonly keys: string[]; readonly words: string[][] } {
    const all: string[] = [];
    const words: string[][] = [];
    for (const now of nows) {
      const l = look(world(b, now, { statements: [everyday, old] }), ledger);
      ledger = l.ledger;
      for (const g of given(l)) if (g.facts.kind.startsWith('card')) {
        all.push(g.key);
        words.push([g.title, g.body]);
      }
    }
    return { keys: all, words };
  }

  // 8:00 PM in New York on each day from Oct 15 to Oct 26.
  const evenings = Array.from({ length: 12 }, (_, i) => `2026-10-${String(16 + i).padStart(2, '0')}T00:00:00Z`);

  it('9.1 9.2 9.4 B30 a reminder 7 and 2 days before, the overdue alert every evening after the due date, none on it', () => {
    const b = book({ date: '2026-10-14' });
    const r = cards(b, started(b, '2026-10-14T16:00:00Z'), evenings);
    expect(r.keys).toEqual([
      'card-reminder everyday-card due 2026-10-23 7 days before',
      'card-reminder old-card due 2026-10-23 7 days before',
      'card-reminder everyday-card due 2026-10-23 2 days before',
      'card-reminder old-card due 2026-10-23 2 days before',
      'card-overdue everyday-card due 2026-10-23 on 2026-10-24',
      'card-overdue old-card due 2026-10-23 on 2026-10-24',
      'card-overdue everyday-card due 2026-10-23 on 2026-10-25',
      'card-overdue old-card due 2026-10-23 on 2026-10-25',
      'card-overdue everyday-card due 2026-10-23 on 2026-10-26',
      'card-overdue old-card due 2026-10-23 on 2026-10-26',
    ]);
    expect(r.words.slice(0, 2)).toEqual([
      ['Everyday card payment due in 7 days', 'Statement balance $450.25, minimum $35.00. Due Fri, Oct 23.'],
      ['Old card payment due in 7 days', 'Minimum $60.00. Due Fri, Oct 23.'],
    ]);
    expect(r.words[4]).toEqual(['Everyday card payment is overdue', 'The minimum, $35.00, was due Fri, Oct 23, and less than that has been paid since the statement.']);
  });

  it('9.3 the everyday card stops at the full statement balance, the old card at the minimum; the overdue alert stops at the minimum', () => {
    const b = book({ date: '2026-10-14' });
    const ledger = started(b, '2026-10-14T16:00:00Z');
    // Oct 17, after the 7-day reminders: the minimum to each card.
    b.receive(transfer('pay1', '2026-10-17', 3_500, 'checking', 'everyday-card'));
    b.receive(transfer('pay2', '2026-10-17', 6_000, 'checking', 'old-card'));
    const r = cards(b, ledger, evenings);
    expect(r.keys).toEqual([
      'card-reminder everyday-card due 2026-10-23 7 days before',
      'card-reminder old-card due 2026-10-23 7 days before',
      'card-reminder everyday-card due 2026-10-23 2 days before',
    ]);
  });

  it('9.7 A34 card reminders and the overdue alert come at the daily review time, with the daily review: one moment, and it moves with the setting', () => {
    const b = book({ date: '2026-10-14' });
    b.changeSettings({ dailyReviewTime: '18:30' }, '2026-10-14');
    b.receive(purchase('p1', '2026-10-14', 1_000, 'MADE UP BOOKSHOP'));
    let ledger = started(b, '2026-10-14T16:00:00Z');
    const statements = [everyday, old];
    // 6:30 PM on Oct 14 and Oct 15 (EDT: 22:30 UTC).
    for (const now of ['2026-10-14T22:30:00Z', '2026-10-15T22:30:00Z']) ledger = look(world(b, now, { statements }), ledger).ledger;
    // 6:29 PM on Oct 16: nothing yet.
    expect(look(world(b, '2026-10-16T22:29:00Z', { statements }), ledger).events).toEqual([]);
    const evening = look(world(b, '2026-10-16T22:30:00Z', { statements }), ledger);
    expect(given(evening).map((g) => [g.key, g.dueAt])).toEqual([
      ['daily-review 2026-10-16', '2026-10-16T22:30:00.000Z'],
      ['card-reminder everyday-card due 2026-10-23 7 days before', '2026-10-16T22:30:00.000Z'],
      ['card-reminder old-card due 2026-10-23 7 days before', '2026-10-16T22:30:00.000Z'],
    ]);
    expect(evening.events).toHaveLength(1);
  });

  it('10.9 A36 one reminder per card: the newest that came while the server was down, still true when it is back', () => {
    const b = book({ date: '2026-10-14' });
    const ledger = started(b, '2026-10-14T16:00:00Z');
    // Down from Oct 14 to noon on Oct 22: the 7-day and the 2-day reminders came meanwhile.
    const back = look(world(b, '2026-10-22T16:00:00Z', { statements: [everyday, old] }), ledger);
    expect(given(back).map((g) => [g.key, g.dueAt])).toEqual([
      ['card-reminder everyday-card due 2026-10-23 2 days before', '2026-10-22T00:00:00.000Z'],
      ['card-reminder old-card due 2026-10-23 2 days before', '2026-10-22T00:00:00.000Z'],
    ]);
  });

  it('10.9 A36 past the due date when it is back: the newest for each card is the overdue alert', () => {
    const b = book({ date: '2026-10-14' });
    const back = look(world(b, '2026-10-25T16:00:00Z', { statements: [everyday, old] }), started(b, '2026-10-14T16:00:00Z'));
    expect(given(back).map((g) => [g.key, g.dueAt])).toEqual([
      ['card-overdue everyday-card due 2026-10-23 on 2026-10-24', '2026-10-25T00:00:00.000Z'],
      ['card-overdue old-card due 2026-10-23 on 2026-10-24', '2026-10-25T00:00:00.000Z'],
    ]);
  });

  it('10.9 A36 back the morning after the due date, before that evening: the 2-day reminder is no longer true, so nothing about the cards yet; the overdue alert comes that evening', () => {
    const b = book({ date: '2026-10-14' });
    const statements = [everyday, old];
    // 9:00 AM on Oct 24.
    const back = look(world(b, '2026-10-24T13:00:00Z', { statements }), started(b, '2026-10-14T16:00:00Z'));
    expect(keys(back)).toEqual([]);
    expect(back.ledger.nextEvening).toBe('2026-10-24');
    expect(keys(look(world(b, '2026-10-25T00:00:00Z', { statements }), back.ledger))).toEqual(['card-overdue everyday-card due 2026-10-23 on 2026-10-24', 'card-overdue old-card due 2026-10-23 on 2026-10-24']);
  });

  it('10.9 A36 a card paid enough by the time it is back gets no reminder, though one came due while it was down', () => {
    const b = book({ date: '2026-10-14' });
    const ledger = started(b, '2026-10-14T16:00:00Z');
    b.receive(transfer('pay1', '2026-10-20', 45_025, 'checking', 'everyday-card'));
    b.receive(transfer('pay2', '2026-10-20', 6_000, 'checking', 'old-card'));
    // The 7-day reminders came on Oct 16, before these payments; back at noon on Oct 22.
    expect(keys(look(world(b, '2026-10-22T16:00:00Z', { statements: [everyday, old] }), ledger))).toEqual([]);
  });
});

describe('10.4 and 10.5 A37 told when it starts, then once a day at the review time while it lasts', () => {
  const MISMATCH_WORDS = (cents: string, still: boolean): [string, string] => [
    still ? 'Your totals still do not match the bank' : 'Your totals do not match the bank',
    `Off by ${cents}: the bank shows less than your buckets add up to. Safe to spend is hidden until they match.`,
  ];

  it('10.4 A37 told when it starts, then once each evening it lasts, with the difference then; never twice the same day', () => {
    const b = book();
    let ledger = started(b);
    const off = (cents: number): BankBalances => ({ ...BANK_OK(b), checking: BANK_OK(b).checking - cents });
    // 10:00 AM on Oct 2: it starts.
    let l = look(world(b, '2026-10-02T14:00:00Z', { bank: off(1_234) }), ledger);
    expect(given(l)).toEqual([
      { key: 'totals-mismatch 1', facts: { kind: 'totals-mismatch', time: 1, difference: -1_234, day: '2026-10-02', again: false }, dueAt: '2026-10-02T14:00:00.000Z', title: MISMATCH_WORDS('$12.34', false)[0], body: MISMATCH_WORDS('$12.34', false)[1] },
    ]);
    ledger = l.ledger;
    expect(look(world(b, '2026-10-02T16:00:00Z', { bank: off(1_234) }), ledger).events).toEqual([]);
    // 8:00 PM on Oct 2: told that day already.
    l = look(world(b, '2026-10-03T00:00:00Z', { bank: off(1_234) }), ledger);
    expect(keys(l)).toEqual([]);
    ledger = l.ledger;
    // 8:00 PM on Oct 3: once more, with the difference then.
    l = look(world(b, '2026-10-04T00:00:00Z', { bank: off(2_000) }), ledger);
    expect(given(l).map((g) => [g.key, g.dueAt, g.title, g.body])).toEqual([['totals-mismatch 1 again 2026-10-03', '2026-10-04T00:00:00.000Z', ...MISMATCH_WORDS('$20.00', true)]]);
    expect(given(l)[0]?.facts).toEqual({ kind: 'totals-mismatch', time: 1, difference: -2_000, day: '2026-10-03', again: true });
    ledger = l.ledger;
    expect(look(world(b, '2026-10-04T00:30:00Z', { bank: off(2_000) }), ledger).events).toEqual([]);
    // 8:00 PM on Oct 4: and again.
    l = look(world(b, '2026-10-05T00:00:00Z', { bank: off(2_000) }), ledger);
    expect(keys(l)).toEqual(['totals-mismatch 1 again 2026-10-04']);
    ledger = l.ledger;
    // They match again at 9:00 AM on Oct 5: cleared, and that evening says nothing.
    l = look(world(b, '2026-10-05T13:00:00Z'), ledger);
    expect(l.events.map((e) => e.cleared)).toEqual([['totals-mismatch']]);
    expect(keys(look(world(b, '2026-10-06T00:00:00Z'), l.ledger))).toEqual([]);
    // Off again: told when it starts, the 2nd time.
    expect(keys(look(world(b, '2026-10-06T13:00:00Z', { bank: off(1) }), l.ledger))).toEqual(['totals-mismatch 2']);
  });

  it('10.4 A37 started after the review time: once more the next evening; started in the night: not again that evening, the same day', () => {
    const b = book();
    const off: BankBalances = { ...BANK_OK(b), savings: 1 };
    // 9:00 PM on Oct 2 (the evening of Oct 1 and Oct 2 are handled first, with nothing to give).
    let l = look(world(b, '2026-10-03T01:00:00Z', { bank: off }), started(b));
    expect(given(l).map((g) => [g.key, g.facts.kind === 'totals-mismatch' ? g.facts.day : ''])).toEqual([['totals-mismatch 1', '2026-10-02']]);
    expect(keys(look(world(b, '2026-10-04T00:00:00Z', { bank: off }), l.ledger))).toEqual(['totals-mismatch 1 again 2026-10-03']);
    // 3:00 AM on Oct 3: that is Oct 3, so the evening of Oct 3 says nothing more.
    l = look(world(b, '2026-10-03T07:00:00Z', { bank: off }), started(b));
    expect(keys(l)).toEqual(['totals-mismatch 1']);
    l = look(world(b, '2026-10-04T00:00:00Z', { bank: off }), l.ledger);
    expect(keys(l)).toEqual([]);
    expect(keys(look(world(b, '2026-10-05T00:00:00Z', { bank: off }), l.ledger))).toEqual(['totals-mismatch 1 again 2026-10-04']);
  });

  it('10.4 when the balances cannot be worked out, a mismatch is neither told, cleared, nor told again', () => {
    const b = book();
    const off: BankBalances = { ...BANK_OK(b), savings: 1 };
    // Noon on Oct 1, before the evening.
    const told = look(world(b, '2026-10-01T17:00:00Z', { bank: off }), started(b));
    expect(keys(told)).toEqual(['totals-mismatch 1']);
    expect(look(world(b, '2026-10-01T18:00:00Z', { bank: null }), told.ledger).events).toEqual([]);
    expect(look(world(b, '2026-10-01T18:00:00Z', { bank: null }), started(b)).events).toEqual([]);
    // The evenings of Oct 1 and 2 with the balances unknown: no repeat.
    let ledger = look(world(b, '2026-10-02T00:00:00Z', { bank: null }), told.ledger).ledger;
    const oct2 = look(world(b, '2026-10-03T00:00:00Z', { bank: null }), ledger);
    expect(keys(oct2)).toEqual([]);
    expect(oct2.events.flatMap((e) => e.cleared)).toEqual([]);
    ledger = oct2.ledger;
    // Known again, still off: told again that evening, still the 1st time.
    expect(keys(look(world(b, '2026-10-04T00:00:00Z', { bank: off }), ledger))).toEqual(['totals-mismatch 1 again 2026-10-03']);
  });

  it('10.5 A37 the bank wanting a new login: told when it starts, then each evening it lasts; from the 1st again after it was fine in between', () => {
    const b = book();
    // 8:30 AM on Oct 2.
    let l = look(world(b, '2026-10-02T12:30:00Z', { needsLogin: true, bank: null }), started(b));
    expect(given(l).map((g) => [g.key, g.title, g.body])).toEqual([['bank-login 1', 'Log in to your bank again', 'The bank wants you to log in again before the app can read it.']]);
    expect(given(l)[0]?.facts).toEqual({ kind: 'bank-login', time: 1, day: '2026-10-02', again: false });
    expect(look(world(b, '2026-10-02T16:00:00Z', { needsLogin: true, bank: null }), l.ledger).events).toEqual([]);
    l = look(world(b, '2026-10-03T00:00:00Z', { needsLogin: true, bank: null }), l.ledger);
    expect(keys(l)).toEqual([]);
    l = look(world(b, '2026-10-04T00:00:00Z', { needsLogin: true, bank: null }), l.ledger);
    expect(given(l).map((g) => [g.key, g.title, g.body])).toEqual([['bank-login 1 again 2026-10-03', 'Log in to your bank again', 'The bank still wants you to log in again before the app can read it.']]);
    l = look(world(b, '2026-10-04T17:00:00Z'), l.ledger);
    expect(l.events.map((e) => e.cleared)).toEqual([['bank-login']]);
    expect(keys(look(world(b, '2026-10-05T00:00:00Z'), l.ledger))).toEqual([]);
    expect(keys(look(world(b, '2026-10-05T03:00:00Z', { needsLogin: true, bank: null }), l.ledger))).toEqual(['bank-login 2']);
  });

  it('10.5 A37 an evening worked out in the same look as the bank stopped wanting a login: no repeat, and it is cleared', () => {
    const b = book();
    // Told at 8:30 AM on Oct 2.
    const told = look(world(b, '2026-10-02T12:30:00Z', { needsLogin: true, bank: null }), started(b));
    expect(keys(told)).toEqual(['bank-login 1']);
    // The next look is at 8:05 PM on Oct 3: the evening of Oct 2 and Oct 3 are due, and the bank is fine again.
    const later = look(world(b, '2026-10-04T00:05:00Z'), told.ledger);
    expect(keys(later)).toEqual([]);
    expect(later.events.flatMap((e) => e.cleared)).toEqual(['bank-login']);
  });

  it('10.9 A37 a lasting alert over evenings the server was down: when it is back, once, for the newest evening, if still true', () => {
    const b = book();
    const off: BankBalances = { ...BANK_OK(b), savings: 1 };
    const told = look(world(b, '2026-10-01T14:00:00Z', { bank: off }), started(b));
    // Down from 7:00 PM on Oct 1 to 10:00 AM on Oct 5: the evenings of Oct 1 to 4 came meanwhile.
    const back = look(world(b, '2026-10-05T14:00:00Z', { bank: off }), told.ledger);
    expect(given(back).map((g) => [g.key, g.dueAt])).toEqual([['totals-mismatch 1 again 2026-10-04', '2026-10-05T00:00:00.000Z']]);
    // Matching when it is back: no repeat, and cleared.
    const fixed = look(world(b, '2026-10-05T14:00:00Z'), told.ledger);
    expect(keys(fixed)).toEqual([]);
    expect(fixed.events.flatMap((e) => e.cleared)).toEqual(['totals-mismatch']);
  });
});

describe('10.8 A35 an alert found in the night', () => {
  it('10.8 A35 is kept at the moment it was found (the sending waits for the end of quiet hours: alert-timer.test.ts)', () => {
    const b = book();
    const ledger = started(b);
    b.receive(cardCharge('fee', '2026-10-03', 2_900, 'fee'));
    b.sort('fee', { to: 'wants' }, '2026-10-03');
    b.receive(purchase('p1', '2026-10-03', 24_000, 'MADE UP CINEMA'));
    b.sort('p1', { to: 'wants' }, '2026-10-03');
    // 3:10 AM in New York.
    expect(given(look(world(b, '2026-10-03T07:10:00Z'), ledger)).map((g) => [g.key, g.dueAt])).toEqual([['low-bucket wants pay period 0', '2026-10-03T07:10:00.000Z']]);
  });
});

describe('10.7 A38 the bank not read for 24 hours', () => {
  // The last good read: 9:00 AM on Oct 2 in New York.
  const READ = '2026-10-02T13:00:00.000Z';
  const notRead = (l: Looked): string[] => keys(l).filter((k) => k.startsWith('bank-not-read'));

  it('10.7 A38 told once, due the moment the last good read became 24 hours old, saying when that was; again only after a good read', () => {
    const b = book();
    let ledger = started(b);
    expect(notRead(look(world(b, '2026-10-03T12:59:59.999Z', { lastRead: READ }), ledger))).toEqual([]);
    let l = look(world(b, '2026-10-03T13:00:00Z', { lastRead: READ }), ledger);
    expect(given(l).filter((g) => g.facts.kind === 'bank-not-read')).toEqual([
      {
        key: 'bank-not-read 1',
        facts: { kind: 'bank-not-read', time: 1, hours: 24, lastRead: READ, lastReadLocal: '2026-10-02T09:00:00-04:00' },
        dueAt: '2026-10-03T13:00:00.000Z',
        title: 'The bank has not been read for 24 hours',
        body: 'Last read Fri, Oct 2 at 9:00 AM. Your numbers may be out of date until it is read again.',
      },
    ]);
    ledger = l.ledger;
    // A day later, still not read: nothing more.
    l = look(world(b, '2026-10-04T13:00:00Z', { lastRead: READ }), ledger);
    expect(notRead(l)).toEqual([]);
    ledger = l.ledger;
    // A good read: cleared.
    const read2 = '2026-10-04T14:00:00.000Z';
    l = look(world(b, '2026-10-04T14:00:00Z', { lastRead: read2 }), ledger);
    expect(l.events.flatMap((e) => e.cleared)).toEqual(['bank-not-read']);
    // 24 hours after that one: told again, the 2nd time.
    expect(notRead(look(world(b, '2026-10-05T14:00:00Z', { lastRead: read2 }), l.ledger))).toEqual(['bank-not-read 2']);
  });

  it('section 2 10.7 the hours are a setting: at 12 hours, told at 12 hours, and it says so', () => {
    const b = book();
    b.changeSettings({ bankNotReadAlertHours: 12 }, '2026-10-01');
    const ledger = started(b);
    expect(notRead(look(world(b, '2026-10-03T00:59:00Z', { lastRead: READ }), ledger))).toEqual([]);
    const l = look(world(b, '2026-10-03T01:00:00Z', { lastRead: READ }), ledger);
    expect(given(l).filter((g) => g.facts.kind === 'bank-not-read').map((g) => [g.dueAt, g.title])).toEqual([['2026-10-03T01:00:00.000Z', 'The bank has not been read for 12 hours']]);
    expect(alertWords({ kind: 'bank-not-read', time: 1, hours: 1, lastRead: READ, lastReadLocal: '2026-10-02T09:00:00-04:00' }).title).toBe('The bank has not been read for 1 hour');
  });

  it('10.7 10.9 the server down when it came due: told when it is back, due at the moment it came due', () => {
    const b = book();
    const back = look(world(b, '2026-10-05T15:00:00Z', { lastRead: READ }), started(b));
    expect(given(back).filter((g) => g.facts.kind === 'bank-not-read').map((g) => [g.key, g.dueAt])).toEqual([['bank-not-read 1', '2026-10-03T13:00:00.000Z']]);
  });

  it('10.7 a longer setting while it is told does not tell it again before a good read', () => {
    const b = book();
    const told = look(world(b, '2026-10-03T13:00:00Z', { lastRead: READ }), started(b));
    expect(notRead(told)).toEqual(['bank-not-read 1']);
    b.changeSettings({ bankNotReadAlertHours: 48 }, '2026-10-03');
    // 8:00 PM on Oct 3, 31 hours after the read: under the new 48, and still told, not cleared.
    const evening = look(world(b, '2026-10-04T00:00:00Z', { lastRead: READ }), told.ledger);
    expect(evening.events.flatMap((e) => e.cleared)).toEqual([]);
    const later = look(world(b, '2026-10-04T13:30:00Z', { lastRead: READ }), evening.ledger);
    expect(notRead(later)).toEqual([]);
    expect(later.events.flatMap((e) => e.cleared)).toEqual([]);
  });

  it('10.7 never read yet: no alert', () => {
    const b = book();
    expect(notRead(look(world(b, '2026-10-09T15:00:00Z'), started(b)))).toEqual([]);
  });

  it('10.7 the timer wakes at the moment it comes due, or at the evening if that is sooner', () => {
    const b = book();
    let ledger = started(b);
    // 11:00 AM on Oct 2 (the evening of Oct 1 handled): the evening in 9 hours, the bank's 24 hours in 22.
    ledger = look(world(b, '2026-10-02T15:00:00Z'), ledger).ledger;
    expect(nextDueIn(world(b, '2026-10-02T15:00:00Z', { lastRead: READ }), ledger)).toBe(9 * 3_600_000);
    ledger = look(world(b, '2026-10-03T00:00:00Z', { lastRead: READ }), ledger).ledger;
    // 9:00 PM on Oct 2: the bank's 24 hours in 12, the next evening in 23.
    expect(nextDueIn(world(b, '2026-10-03T01:00:00Z', { lastRead: READ }), ledger)).toBe(12 * 3_600_000);
  });
});

describe('10.10 A39 the lock screen shows no amounts unless the setting says so', () => {
  const READ_LOCAL = '2026-10-02T09:00:00-04:00';
  const ALL: readonly AlertFacts[] = [
    { kind: 'low-bucket', bucket: 'needs', period: 3, amount: 9_999, startedWith: 50_000 },
    { kind: 'empty-bucket', bucket: 'wants', period: 3, amount: 0 },
    { kind: 'empty-bucket', bucket: 'wants', period: 3, amount: -500 },
    { kind: 'daily-review', date: '2026-10-02', waiting: 3 },
    { kind: 'card-reminder', card: 'everyday-card', dueDate: '2026-10-23', daysBefore: 7, minimumPayment: 3_500, statementBalance: 45_025 },
    { kind: 'card-reminder', card: 'old-card', dueDate: '2026-10-23', daysBefore: 2, minimumPayment: 6_000, statementBalance: null },
    { kind: 'card-overdue', card: 'old-card', dueDate: '2026-10-23', minimumPayment: 6_000, date: '2026-10-24' },
    { kind: 'totals-mismatch', time: 1, difference: -1_234, day: '2026-10-02', again: false },
    { kind: 'totals-mismatch', time: 1, difference: 99_999_999, day: '2026-10-03', again: true },
    { kind: 'bank-login', time: 1, day: '2026-10-02', again: false },
    { kind: 'bank-took-back', id: 'dup', date: '2026-10-03', description: 'MADE UP CAFE', amount: 1_250 },
    { kind: 'bank-not-read', time: 1, hours: 24, lastRead: '2026-10-02T13:00:00.000Z', lastReadLocal: READ_LOCAL },
  ];

  it('10.10 A39 without amounts every alert is words only: no dollar amount in its title or its line', () => {
    for (const f of ALL) {
      const w = alertWords(f, { amounts: false });
      expect(`${w.title} ${w.body}`, f.kind).not.toMatch(/\$|\d\.\d\d/);
    }
    expect(alertWords(ALL[0]!, { amounts: false })).toEqual({ title: 'Needs is low', body: 'Open the app to see what is left this pay period.' });
    expect(alertWords(ALL[1]!, { amounts: false })).toEqual({ title: 'Wants is empty', body: 'Nothing is left in it for this pay period.' });
    expect(alertWords(ALL[2]!, { amounts: false })).toEqual({ title: 'Wants is empty', body: 'It is over for this pay period.' });
    expect(alertWords(ALL[4]!, { amounts: false })).toEqual({ title: 'Everyday card payment due in 7 days', body: 'Due Fri, Oct 23.' });
    expect(alertWords(ALL[6]!, { amounts: false })).toEqual({ title: 'Old card payment is overdue', body: 'The minimum was due Fri, Oct 23, and less than that has been paid since the statement.' });
    expect(alertWords(ALL[7]!, { amounts: false })).toEqual({ title: 'Your totals do not match the bank', body: 'Safe to spend is hidden until they match.' });
    expect(alertWords(ALL[8]!, { amounts: false })).toEqual({ title: 'Your totals still do not match the bank', body: 'Safe to spend is hidden until they match.' });
    expect(alertWords(ALL[10]!, { amounts: false })).toEqual({ title: 'The bank took something back', body: 'MADE UP CAFE, taken back Sat, Oct 3. It is undone in your buckets too.' });
  });

  it('10.10 9.1 9.2 10.4 with amounts, the words say them, as the rules do; an alert with no amount is the same either way', () => {
    expect(alertWords(ALL[4]!)).toEqual({ title: 'Everyday card payment due in 7 days', body: 'Statement balance $450.25, minimum $35.00. Due Fri, Oct 23.' });
    expect(alertWords(ALL[5]!)).toEqual({ title: 'Old card payment due in 2 days', body: 'Minimum $60.00. Due Fri, Oct 23.' });
    expect(alertWords(ALL[8]!).body).toBe('Off by $999,999.99: the bank shows more than your buckets add up to. Safe to spend is hidden until they match.');
    expect(alertWords(ALL[1]!, { amounts: false })).toEqual(alertWords(ALL[1]!));
    expect(alertWords(ALL[3]!, { amounts: false })).toEqual(alertWords(ALL[3]!));
    expect(alertWords(ALL[9]!, { amounts: false })).toEqual(alertWords(ALL[9]!));
    expect(alertWords(ALL[11]!, { amounts: false })).toEqual(alertWords(ALL[11]!));
  });
});

describe('Phase 5 0.6 the history of alerts replays only as it was', () => {
  it('0.6 an alert given twice, an evening out of turn, a second start, or a lasting alert out of turn cannot be replayed', () => {
    const b = book();
    const start = nextAlertsEvent(world(b, '2026-10-01T16:00:00Z'), NO_ALERTS)!;
    const ledger = applyAlerts(NO_ALERTS, start);
    expect(() => applyAlerts(ledger, start)).toThrow(ReplayFailed);
    b.receive(purchase('dup', '2026-10-01', 1_250, 'MADE UP CAFE'));
    b.receive(takenBack('tb2', 'dup', '2026-10-01'));
    // 2 PM on Oct 1, before the evening.
    const change = nextAlertsEvent(world(b, '2026-10-01T18:00:00Z'), ledger)!;
    expect(change.check).toEqual({ kind: 'change' });
    const after = applyAlerts(ledger, change);
    expect(() => applyAlerts(after, change)).toThrow(/already given/);
    const evening: AlertsEvent = { at: '2026-10-05T00:00:00.000Z', check: { kind: 'evening', date: '2026-10-03', dueAt: '2026-10-04T00:00:00.000Z' }, given: [], cleared: [] };
    expect(() => applyAlerts(after, evening)).toThrow(/out of turn/);
    const login: AlertsEvent = { at: '2026-10-05T00:00:00.000Z', check: { kind: 'change' }, given: [{ key: 'bank-login 2', facts: { kind: 'bank-login', time: 2, day: '2026-10-04', again: false }, dueAt: '2026-10-05T00:00:00.000Z', title: '', body: '' }], cleared: [] };
    expect(() => applyAlerts(after, login)).toThrow(/out of turn/);
    expect(() => applyAlerts(after, { ...login, given: [], cleared: ['bank-login'] })).toThrow(/without being on/);
    expect(() => applyAlerts(NO_ALERTS, { ...login, given: [] })).toThrow(/before they started/);
  });

  it('0.6 10.4 10.7 10.9 a repeat of an alert that is not on, a second repeat the same day, a not-read alert out of turn, or evenings that do not start at the next one cannot be replayed', () => {
    const b = book();
    const ledger = applyAlerts(NO_ALERTS, nextAlertsEvent(world(b, '2026-10-01T16:00:00Z'), NO_ALERTS)!);
    const alert = (facts: AlertFacts, key: string): AlertsEvent => ({ at: '2026-10-02T00:00:00.000Z', check: { kind: 'change' }, given: [{ key, facts, dueAt: '2026-10-02T00:00:00.000Z', title: '', body: '' }], cleared: [] });
    const again = alert({ kind: 'bank-login', time: 1, day: '2026-10-01', again: true }, 'bank-login 1 again 2026-10-01');
    expect(() => applyAlerts(ledger, again)).toThrow(/out of turn/);
    const on = applyAlerts(ledger, alert({ kind: 'bank-login', time: 1, day: '2026-10-01', again: false }, 'bank-login 1'));
    expect(() => applyAlerts(on, again)).toThrow(/out of turn/);
    const next = applyAlerts(on, alert({ kind: 'bank-login', time: 1, day: '2026-10-02', again: true }, 'bank-login 1 again 2026-10-02'));
    expect(() => applyAlerts(next, alert({ kind: 'bank-login', time: 1, day: '2026-10-02', again: true }, 'bank-login 1 again 2026-10-02 (a copy)'))).toThrow(/out of turn/);
    expect(() => applyAlerts(ledger, alert({ kind: 'bank-not-read', time: 2, hours: 24, lastRead: '2026-10-01T13:00:00.000Z', lastReadLocal: '2026-10-01T09:00:00-04:00' }, 'bank-not-read 2'))).toThrow(/out of turn/);
    const evenings: AlertsEvent = { at: '2026-10-05T00:00:00.000Z', check: { kind: 'evening', from: '2026-10-02', date: '2026-10-03', dueAt: '2026-10-04T00:00:00.000Z' }, given: [], cleared: [] };
    expect(() => applyAlerts(ledger, evenings)).toThrow(/out of turn/);
    expect(() => applyAlerts(ledger, { ...evenings, check: { kind: 'evening', from: '2026-10-01', date: '2026-09-30', dueAt: '2026-10-01T00:00:00.000Z' } })).toThrow(/out of turn/);
    expect(applyAlerts(ledger, { ...evenings, check: { kind: 'evening', from: '2026-10-01', date: '2026-10-03', dueAt: '2026-10-04T00:00:00.000Z' } }).nextEvening).toBe('2026-10-04');
  });

  it('Phase 5 working out the alerts changes nothing in the book', () => {
    const b = book();
    b.receive(purchase('p1', '2026-10-01', 49_000, 'MADE UP GROCER'));
    b.sort('p1', { to: 'needs' }, '2026-10-01');
    const before = JSON.stringify({ pots: b.pots(), review: b.reviewItems(), log: b.changeLog() });
    look(world(b, '2026-10-02T00:00:00Z'), NO_ALERTS);
    expect(JSON.stringify({ pots: b.pots(), review: b.reviewItems(), log: b.changeLog() })).toBe(before);
  });
});
