import { type BankBalances, type Book, type CardStatement } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { cardCharge, openTestBook, paycheck, purchase, takenBack, transfer } from '../../money/test/helpers.js';
import { ReplayFailed } from '../src/history/history.js';
import { NO_ALERTS, applyAlerts, nextAlertsEvent, nextEveningIn, type AlertLedger, type AlertWorld, type AlertsEvent } from '../src/alerts/plan.js';

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
  return { book, now: new Date(now), zone: ZONE, bank: BANK_OK(book), needsLogin: false, statements: [], ...extra };
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
    expect(nextEveningIn(world(b, '2026-10-02T01:00:00Z'), ledger)).toBe(15 * 60_000);
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

describe('A36 evenings that came while the server was down', () => {
  it('A36 each is handled when the server is back, oldest first, saying when it was due; once each', () => {
    const b = book();
    const ledger = started(b);
    b.receive(purchase('p1', '2026-10-01', 1_000, 'MADE UP BOOKSHOP'));
    // Back at 9:30 AM on Oct 4: the evenings of Oct 1, 2 and 3 came meanwhile.
    const back = look(world(b, '2026-10-04T13:30:00Z'), ledger);
    expect(back.events.map((e) => e.check)).toEqual([
      { kind: 'evening', date: '2026-10-01', dueAt: '2026-10-02T00:00:00.000Z' },
      { kind: 'evening', date: '2026-10-02', dueAt: '2026-10-03T00:00:00.000Z' },
      { kind: 'evening', date: '2026-10-03', dueAt: '2026-10-04T00:00:00.000Z' },
    ]);
    expect(back.events.every((e) => e.at === '2026-10-04T13:30:00.000Z')).toBe(true);
    expect(keys(back)).toEqual(['daily-review 2026-10-01', 'daily-review 2026-10-02', 'daily-review 2026-10-03']);
    expect(back.ledger.nextEvening).toBe('2026-10-04');
    expect(look(world(b, '2026-10-04T13:31:00Z'), back.ledger).events).toEqual([]);
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

  it('A36 9.4 a reminder day that came while the server was down: worked out for that day, with the payments seen by then', () => {
    const b = book({ date: '2026-10-14' });
    const ledger = started(b, '2026-10-14T16:00:00Z');
    b.receive(transfer('pay1', '2026-10-20', 45_025, 'checking', 'everyday-card'));
    // Down from Oct 15 to Oct 22 at noon.
    const back = look(world(b, '2026-10-22T16:00:00Z', { statements: [everyday] }), ledger);
    expect(keys(back)).toEqual(['card-reminder everyday-card due 2026-10-23 7 days before']);
    expect(given(back)[0]?.dueAt).toBe('2026-10-17T00:00:00.000Z');
  });
});

describe('10.4 and 10.5: once when it starts, again only after it stopped (A37)', () => {
  it('10.4 the totals not matching the bank: told once with the difference; after they match again, told again the next time', () => {
    const b = book();
    let ledger = started(b);
    const off: BankBalances = { ...BANK_OK(b), checking: BANK_OK(b).checking - 1_234 };
    let l = look(world(b, '2026-10-02T15:00:00Z', { bank: off }), ledger);
    expect(given(l).map((g) => [g.key, g.title, g.body])).toEqual([
      ['totals-mismatch 1', 'Your totals do not match the bank', 'Off by $12.34: the bank shows less than your buckets add up to. Safe to spend is hidden until they match.'],
    ]);
    ledger = l.ledger;
    expect(look(world(b, '2026-10-02T16:00:00Z', { bank: off }), ledger).events).toEqual([]);
    l = look(world(b, '2026-10-02T17:00:00Z'), ledger);
    expect(l.events.map((e) => e.cleared)).toEqual([['totals-mismatch']]);
    expect(keys(look(world(b, '2026-10-02T18:00:00Z', { bank: off }), l.ledger))).toEqual(['totals-mismatch 2']);
  });

  it('10.4 when the balances cannot be worked out, a mismatch is neither told nor cleared', () => {
    const b = book();
    const off: BankBalances = { ...BANK_OK(b), savings: 1 };
    // Noon, 1 PM and 2 PM on Oct 1, before the evening.
    const told = look(world(b, '2026-10-01T17:00:00Z', { bank: off }), started(b));
    expect(keys(told)).toEqual(['totals-mismatch 1']);
    expect(look(world(b, '2026-10-01T18:00:00Z', { bank: null }), told.ledger).events).toEqual([]);
    expect(look(world(b, '2026-10-01T18:00:00Z', { bank: null }), started(b)).events).toEqual([]);
  });

  it('10.5 the bank wanting a new login: told once; again after it was fine in between', () => {
    const b = book();
    let l = look(world(b, '2026-10-02T15:00:00Z', { needsLogin: true }), started(b));
    expect(given(l).map((g) => [g.key, g.title, g.body])).toEqual([['bank-login 1', 'Log in to your bank again', 'The bank wants you to log in again before the app can read it.']]);
    expect(look(world(b, '2026-10-02T16:00:00Z', { needsLogin: true }), l.ledger).events).toEqual([]);
    l = look(world(b, '2026-10-02T17:00:00Z'), l.ledger);
    expect(l.events.map((e) => e.cleared)).toEqual([['bank-login']]);
    expect(keys(look(world(b, '2026-10-03T03:00:00Z', { needsLogin: true }), l.ledger))).toEqual(['bank-login 2']);
  });

  it('A35 an alert caused by a sync in the night goes at once: due at the moment it was found', () => {
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
    const login: AlertsEvent = { at: '2026-10-05T00:00:00.000Z', check: { kind: 'change' }, given: [{ key: 'bank-login 2', facts: { kind: 'bank-login', time: 2 }, dueAt: '2026-10-05T00:00:00.000Z', title: '', body: '' }], cleared: [] };
    expect(() => applyAlerts(after, login)).toThrow(/out of turn/);
    expect(() => applyAlerts(after, { ...login, given: [], cleared: ['bank-login'] })).toThrow(/without being on/);
    expect(() => applyAlerts(NO_ALERTS, { ...login, given: [] })).toThrow(/before they started/);
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
