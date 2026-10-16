import { type BankBalances, type Book } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { deposit, openTestBook, paycheck, takenBack } from '../../money/test/helpers.js';
import { alertScreen, alertWords, type AlertFacts } from '../src/alerts/alerts.js';
import { NO_ALERTS, applyAlerts, nextAlertsEvent, stillTrueNow, type AlertLedger, type AlertWorld, type AlertsEvent } from '../src/alerts/plan.js';
import { sendKindOf } from '../src/alerts/sending.js';
import { ReplayFailed } from '../src/history/history.js';

// 10.14 (QUESTIONS.md A49, his yes Oct 14): when a paycheck is counted, he is
// told how much to move to savings (3.8) and, with the payoff countdown on,
// the old card's share this payday (9.5). At once; quiet hours apply (10.8);
// a tap opens Payday; amounts only if the lock-screen setting allows (10.10).
// Every name and number is made up. The times are in New York (EDT in
// October: noon is 16:00 UTC). With the real books and the timer:
// payday-alert-timer.test.ts.

const ZONE = 'America/New_York';

// Balances that match the book, with the savings account holding `savings`
// and checking the rest.
function bankOf(book: Book, savings: number): BankBalances {
  return { checking: book.appSide() - book.inTransit().total - savings, savings, everydayCard: 0 };
}

function world(book: Book, now: string, extra: Partial<AlertWorld> & { readonly savings?: number } = {}): AlertWorld {
  const { savings = 500_000, ...rest } = extra;
  return { book, now: new Date(now), zone: ZONE, bank: bankOf(book, savings), needsLogin: false, statements: [], lastRead: null, mismatchSince: null, ...rest };
}

interface Looked {
  readonly events: AlertsEvent[];
  readonly ledger: AlertLedger;
}

function look(w: AlertWorld, ledger: AlertLedger): Looked {
  const events: AlertsEvent[] = [];
  for (let next = nextAlertsEvent(w, ledger); next !== null; next = nextAlertsEvent(w, ledger)) {
    events.push(next);
    ledger = applyAlerts(ledger, next);
    if (events.length > 100) throw new Error('it never stops');
  }
  return { events, ledger };
}

const given = (l: Looked) => l.events.flatMap((e) => e.given);
const paydays = (l: Looked) => given(l).filter((g) => g.facts.kind === 'payday');

// Savings $1,000.00, the mom reserve $1,500.00 (half its cap of $3,000.00),
// needs $500.00, wants $300.00; the last paycheck Sep 25, every 14 days.
function book(options: Parameters<typeof openTestBook>[0] = {}): Book {
  return openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 150_000 }, ...options });
}

// A paycheck of $4,000.00: the reserve takes $1,500.00 (to its cap), and the
// rest, $2,500.00, splits 50/30/20: savings $1,250.00, needs $750.00, wants
// $500.00. Savings then holds $2,250.00 and the reserve $3,000.00, so the
// savings account should hold $5,250.00.
const PAY = 400_000;
const SHOULD_HOLD = 525_000;

describe('10.14 the payday alert, worked out from the book', () => {
  it('10.14 a paycheck counted is told at once: what is still to move to savings (3.8), keyed by its pay period', () => {
    const b = book();
    const ledger = look(world(b, '2026-10-01T16:00:00Z'), NO_ALERTS).ledger;
    b.receive(paycheck('pay', '2026-10-09', PAY));
    expect(b.period().number).toBe(1);
    // The savings account holds $5,000.00: $250.00 still to move.
    const l = look(world(b, '2026-10-09T13:15:00Z', { savings: 500_000 }), ledger);
    expect(paydays(l)).toEqual([
      {
        key: 'payday pay period 1',
        facts: { kind: 'payday', period: 1, date: '2026-10-09', toSavings: SHOULD_HOLD - 500_000, extraInSavings: 0, oldCard: null },
        dueAt: '2026-10-09T13:15:00.000Z',
        title: 'Payday',
        body: 'Move $250.00 to savings.',
      },
    ]);
    // Exactly what the Payday screen says is still to move.
    expect(b.savingsTransfer(500_000).stillToMove).toBe(25_000);
  });

  it('10.14 once per paycheck: the next look tells nothing, and the next paycheck is told again', () => {
    const b = book();
    let ledger = look(world(b, '2026-10-01T16:00:00Z'), NO_ALERTS).ledger;
    b.receive(paycheck('pay', '2026-10-09', PAY));
    ledger = look(world(b, '2026-10-09T16:00:00Z'), ledger).ledger;
    expect(paydays(look(world(b, '2026-10-09T17:00:00Z'), ledger))).toEqual([]);
    expect(nextAlertsEvent(world(b, '2026-10-09T17:00:00Z'), ledger)).toBeNull();
    b.receive(paycheck('pay2', '2026-10-23', PAY));
    expect(paydays(look(world(b, '2026-10-23T16:00:00Z'), ledger)).map((g) => [g.key, g.facts.kind === 'payday' && g.facts.date])).toEqual([['payday pay period 2', '2026-10-23']]);
  });

  it('10.14 setup day is not a paycheck: the alerts start knowing the pay period of that moment, whatever it is', () => {
    // Before the first paycheck (pay period 0).
    const before = book();
    const first = look(world(before, '2026-10-01T16:00:00Z'), NO_ALERTS);
    expect(paydays(first)).toEqual([]);
    expect(first.ledger.payPeriod).toBe(0);
    // A paycheck already counted when the alerts first look: known, not told.
    // (Its last paycheck was Sep 11, so Oct 1 is not too soon, 3.7.)
    const after = book({ lastPaycheckDate: '2026-09-11' });
    after.receive(paycheck('pay', '2026-10-01', PAY));
    const look1 = look(world(after, '2026-10-01T16:00:00Z'), NO_ALERTS);
    expect(paydays(look1)).toEqual([]);
    expect(look1.ledger.payPeriod).toBe(1);
  });

  it('10.14 a history kept before the payday alert: the first look notes the pay period and tells nothing; the next paycheck is told', () => {
    const b = book();
    b.receive(paycheck('pay', '2026-10-09', PAY));
    // The ledger of a history from before 10.14: started, with no pay period known.
    const old: AlertLedger = { ...NO_ALERTS, started: true, nextEvening: '2026-10-10' };
    expect(old.payPeriod).toBeNull();
    const first = look(world(b, '2026-10-09T16:00:00Z'), old);
    expect(given(first)).toEqual([]);
    expect(first.events.map((e) => [e.check.kind, e.payPeriod])).toEqual([['change', 1]]);
    expect(first.ledger.payPeriod).toBe(1);
    b.receive(paycheck('pay2', '2026-10-23', PAY));
    expect(paydays(look(world(b, '2026-10-23T16:00:00Z'), first.ledger)).map((g) => g.key)).toEqual(['payday pay period 2']);
  });

  it('10.14 9.5 with the payoff countdown on, the old card\'s share this payday; off, none', () => {
    // $3,000.00 owed, the promo ending Jan 1, 2027: the paydays after Oct 9
    // and before Jan 1 are Oct 23, Nov 6, Nov 20, Dec 4 and Dec 18, five of
    // them, so $600.00 each.
    const on = book({ oldCardDebt: 300_000, settings: { oldCardPromoEndDate: '2027-01-01' } });
    const ledger = look(world(on, '2026-10-01T16:00:00Z'), NO_ALERTS).ledger;
    on.receive(paycheck('pay', '2026-10-09', PAY));
    const told = paydays(look(world(on, '2026-10-09T16:00:00Z'), ledger));
    expect(told.map((g) => [g.facts, g.body])).toEqual([
      [{ kind: 'payday', period: 1, date: '2026-10-09', toSavings: 25_000, extraInSavings: 0, oldCard: 60_000 }, 'Move $250.00 to savings. Old card: $600.00 this payday.'],
    ]);
    // Nothing owed: the share is $0.00, said in words.
    const paidOff = book({ oldCardDebt: 0, settings: { oldCardPromoEndDate: '2027-01-01' } });
    const l2 = look(world(paidOff, '2026-10-01T16:00:00Z'), NO_ALERTS).ledger;
    paidOff.receive(paycheck('pay', '2026-10-09', PAY));
    expect(paydays(look(world(paidOff, '2026-10-09T16:00:00Z'), l2)).map((g) => [g.facts.kind === 'payday' && g.facts.oldCard, g.body])).toEqual([[0, 'Move $250.00 to savings. Nothing is owed on the old card.']]);
  });

  it('10.14 3.8 the savings account already holds enough, or more: nothing to move, and the extra said', () => {
    for (const [savings, extra, body] of [
      [SHOULD_HOLD, 0, 'Nothing to move to savings.'],
      [SHOULD_HOLD + 1, 1, 'Nothing to move to savings: it holds $0.01 more than it should.'],
      [SHOULD_HOLD - 1, 0, 'Move $0.01 to savings.'],
      [600_000, 75_000, 'Nothing to move to savings: it holds $750.00 more than it should.'],
    ] as const) {
      const b = book();
      const ledger = look(world(b, '2026-10-01T16:00:00Z'), NO_ALERTS).ledger;
      b.receive(paycheck('pay', '2026-10-09', PAY));
      const told = paydays(look(world(b, '2026-10-09T16:00:00Z', { savings }), ledger));
      expect(told.map((g) => [g.facts.kind === 'payday' && g.facts.extraInSavings, g.body]), `savings ${savings}`).toEqual([[extra, body]]);
    }
  });

  it('10.14 the bank cannot be read: told all the same, with no amount to move; Payday says it once the bank is read', () => {
    const b = book();
    const ledger = look(world(b, '2026-10-01T16:00:00Z'), NO_ALERTS).ledger;
    b.receive(paycheck('pay', '2026-10-09', PAY));
    const told = paydays(look(world(b, '2026-10-09T16:00:00Z', { bank: null, needsLogin: true }), ledger));
    expect(told.map((g) => [g.facts, g.body])).toEqual([
      [{ kind: 'payday', period: 1, date: '2026-10-09', toSavings: null, extraInSavings: 0, oldCard: null }, 'Open Payday to see what to move to savings once the bank can be read.'],
    ]);
  });

  it('10.14 6.1 B53 a deposit called "my paycheck" in review is told when it is counted, for the day it arrived', () => {
    const b = book();
    let ledger = look(world(b, '2026-10-01T16:00:00Z'), NO_ALERTS).ledger;
    b.receive(deposit('d1', '2026-10-09', PAY, 'MADE UP EMPLOYER'));
    ledger = look(world(b, '2026-10-09T16:00:00Z'), ledger).ledger;
    expect(ledger.payPeriod).toBe(0);
    b.sort('d1', { to: 'paycheck' }, '2026-10-11');
    const told = paydays(look(world(b, '2026-10-11T16:00:00Z'), ledger));
    expect(told.map((g) => [g.key, g.dueAt, g.facts.kind === 'payday' && g.facts.date])).toEqual([['payday pay period 1', '2026-10-11T16:00:00.000Z', '2026-10-09']]);
  });

  it('10.14 two paychecks counted before one look: one alert, for the newer', () => {
    const b = book();
    const ledger = look(world(b, '2026-10-01T16:00:00Z'), NO_ALERTS).ledger;
    b.receive(paycheck('pay', '2026-10-09', PAY));
    b.receive(paycheck('pay2', '2026-10-23', PAY));
    const l = look(world(b, '2026-10-23T16:00:00Z'), ledger);
    expect(paydays(l).map((g) => g.key)).toEqual(['payday pay period 2']);
    expect(l.ledger.payPeriod).toBe(2);
  });

  it('10.14 4.10 a paycheck taken back keeps its pay period: nothing more is told', () => {
    const b = book();
    let ledger = look(world(b, '2026-10-01T16:00:00Z'), NO_ALERTS).ledger;
    b.receive(paycheck('pay', '2026-10-09', PAY));
    ledger = look(world(b, '2026-10-09T16:00:00Z'), ledger).ledger;
    b.receive(takenBack('tb', 'pay', '2026-10-10'));
    expect(paydays(look(world(b, '2026-10-10T16:00:00Z'), ledger))).toEqual([]);
  });
});

describe('10.14 10.10 the payday alert\'s words, and the screen it opens', () => {
  const facts = (f: Partial<Extract<AlertFacts, { kind: 'payday' }>> = {}): AlertFacts => ({ kind: 'payday', period: 4, date: '2026-10-30', toSavings: 123_456, extraInSavings: 0, oldCard: 60_000, ...f });

  it('10.14 10.10 with amounts: what to move and the old card\'s share; without: words only, the same title', () => {
    expect(alertWords(facts())).toEqual({ title: 'Payday', body: 'Move $1,234.56 to savings. Old card: $600.00 this payday.' });
    expect(alertWords(facts({ oldCard: null }))).toEqual({ title: 'Payday', body: 'Move $1,234.56 to savings.' });
    expect(alertWords(facts(), { amounts: false })).toEqual({ title: 'Payday', body: 'Open Payday to see what to move to savings and pay on the old card.' });
    expect(alertWords(facts({ oldCard: null }), { amounts: false })).toEqual({ title: 'Payday', body: 'Open Payday to see what to move to savings.' });
    for (const f of [facts(), facts({ toSavings: 0, extraInSavings: 99_999_999 }), facts({ toSavings: null }), facts({ oldCard: 0 }), facts({ toSavings: 1, oldCard: 1 })]) {
      const w = alertWords(f, { amounts: false });
      expect(`${w.title} ${w.body}`, JSON.stringify(f)).not.toMatch(/\$|\d\.\d\d/);
    }
    // Very large amounts are written whole.
    expect(alertWords(facts({ toSavings: 99_999_999, oldCard: 99_999_999 })).body).toBe('Move $999,999.99 to savings. Old card: $999,999.99 this payday.');
  });

  it('10.14 a tap opens Payday', () => {
    expect(alertScreen(facts())).toBe('/payday');
  });

  it('10.14 10.9 A40 its own kind: only the newest waiting payday alert goes', () => {
    expect(sendKindOf('payday pay period 4', facts())).toBe('payday');
  });

  it('10.14 10.9 A40 still true while its pay period lasts; not once the next paycheck has come', () => {
    const b = book();
    b.receive(paycheck('pay', '2026-10-09', PAY));
    const now = world(b, '2026-10-12T16:00:00Z');
    expect(stillTrueNow(now, NO_ALERTS, facts({ period: 1 }))).toBe(true);
    expect(stillTrueNow(now, NO_ALERTS, facts({ period: 0 }))).toBe(false);
    b.receive(paycheck('pay2', '2026-10-23', PAY));
    expect(stillTrueNow(world(b, '2026-10-23T16:00:00Z'), NO_ALERTS, facts({ period: 1 }))).toBe(false);
  });

  it('0.6 10.14 a payday alert out of turn cannot be replayed: not newer than the pay period known, or without it', () => {
    const b = book();
    const ledger = applyAlerts(NO_ALERTS, nextAlertsEvent(world(b, '2026-10-01T16:00:00Z'), NO_ALERTS)!);
    const alert = (period: number, payPeriod: number | undefined): AlertsEvent => ({
      at: '2026-10-09T16:00:00.000Z',
      check: { kind: 'change' },
      given: [{ key: `payday pay period ${period}`, facts: facts({ period }), dueAt: '2026-10-09T16:00:00.000Z', title: '', body: '' }],
      cleared: [],
      ...(payPeriod === undefined ? {} : { payPeriod }),
    });
    expect(applyAlerts(ledger, alert(1, 1)).payPeriod).toBe(1);
    expect(() => applyAlerts(ledger, alert(0, 0))).toThrow(ReplayFailed);
    expect(() => applyAlerts(ledger, alert(1, undefined))).toThrow(/out of turn/);
    expect(() => applyAlerts(ledger, alert(2, 1))).toThrow(/out of turn/);
    const known = applyAlerts(ledger, alert(1, 1));
    expect(() => applyAlerts(known, { ...alert(1, 1), given: [] })).toThrow(/pay period/);
    expect(() => applyAlerts({ ...ledger, payPeriod: null }, alert(1, 1))).toThrow(/out of turn/);
  });
});
