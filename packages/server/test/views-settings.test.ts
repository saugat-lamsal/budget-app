import { RULE_CHOICES, payoffCountdown, type BankBalances, type Book } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { START_DATE, appSide, openTestBook, paycheck, purchase, takenBack } from '../../money/test/helpers.js';
import { settingsView, type SettingsInput, type SettingsView } from '../src/views/settings.js';

// The Settings screen's numbers (Phase 4), worked out on the server from the
// book: every setting in rulebook section 2, what is in force this pay period
// next to what comes from the next paycheck (13.1), the sorting rules in the
// order they are tried, and the change log, newest first (13.5). The screen
// works nothing out. Made-up numbers only.

const TODAY = '2026-10-20';

function matchingBank(book: Book): BankBalances {
  return { checking: appSide(book.pots()) - book.inTransit().total, savings: 0, everydayCard: 0 };
}

function input(book: Book | null, over: Partial<SettingsInput> = {}): SettingsInput {
  return { today: TODAY, book, bank: book === null ? null : matchingBank(book), madeUpData: false, ...over };
}

function tracking(view: SettingsView): Extract<SettingsView, { state: 'tracking' }> {
  if (view.state !== 'tracking') throw new Error(`expected tracking, got ${view.state}`);
  return view;
}

const view = (book: Book, over: Partial<SettingsInput> = {}) => tracking(settingsView(input(book, over)));

function book(options: Parameters<typeof openTestBook>[0] = {}): Book {
  return openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0 }, ...options });
}

describe('14 before setup day', () => {
  it('14 there is nothing to show, and it says so', () => {
    expect(settingsView(input(null, { madeUpData: true }))).toEqual({ state: 'not-set-up', madeUpData: true });
    expect(settingsView(input(null))).toEqual({ state: 'not-set-up', madeUpData: false });
  });
});

describe('0.2 every setting in rulebook section 2 is shown as the money math has it', () => {
  it('0.2 the settings are the book\'s, every one of them', () => {
    const b = book();
    b.changeSettings({ lowBucketAlertPercent: 25, cardReminderDaysBefore: [10, 3], dailyReviewTime: '21:30', oldCardPromoEndDate: '2027-03-31' }, '2026-10-05');
    const v = view(b, { madeUpData: true });
    expect(v.settings).toEqual(b.settings());
    expect(v.madeUpData).toBe(true);
    expect(v.today).toBe(TODAY);
  });

  it('11.2 the pay schedule comes with the next payday it gives, from the money math', () => {
    const b = book();
    const v = view(b);
    expect(v.split.nextPayday).toEqual({ date: b.safeToSpend(TODAY).nextPayday, days: b.safeToSpend(TODAY).daysToPayday });
  });
});

describe('13.1 what is in force this pay period, next to what comes from the next paycheck', () => {
  it('13.1 with nothing changed, the two are the same and nothing is waiting', () => {
    const b = book();
    const v = view(b);
    expect(v.split.thisPayPeriod).toEqual(b.splitInForce());
    expect(v.split.fromNextPaycheck).toEqual(b.splitInForce());
    expect(v.split.waiting).toEqual([]);
    expect(v.split.payPeriodStarted).toBe(START_DATE);
  });

  it('13.1 a change shows as what comes next, and this pay period keeps what it started with', () => {
    const b = book();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.changeSettings({ split: { savings: 40, needs: 40, wants: 20 }, momReserveCap: 250_000 }, '2026-10-12');
    const v = view(b);
    expect(v.split.thisPayPeriod).toEqual({ split: { savings: 50, needs: 30, wants: 20 }, momReservePerPaycheck: 150_000, momReserveCap: 300_000 });
    expect(v.split.fromNextPaycheck).toEqual({ split: { savings: 40, needs: 40, wants: 20 }, momReservePerPaycheck: 150_000, momReserveCap: 250_000 });
    expect(v.split.waiting).toEqual(['split', 'momReserveCap']);
    expect(v.split.payPeriodStarted).toBe('2026-10-09');
  });

  it('13.1 the next paycheck puts it in force, and nothing is waiting again', () => {
    const b = book();
    b.changeSettings({ momReservePerPaycheck: 100_000 }, '2026-10-05');
    expect(view(b).split.waiting).toEqual(['momReservePerPaycheck']);
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const v = view(b);
    expect(v.split.waiting).toEqual([]);
    expect(v.split.thisPayPeriod.momReservePerPaycheck).toBe(100_000);
  });
});

describe('9.5 the old card payoff countdown', () => {
  it('9.5 off until the promo end date is entered', () => {
    expect(view(book()).payoff).toEqual({ on: false, reason: 'no-promo-end-date' });
  });

  it('9.5 on once it is entered, as the money math works it out', () => {
    const b = book({ oldCardDebt: 298_000 });
    b.changeSettings({ oldCardPromoEndDate: '2027-03-31' }, '2026-10-05');
    const v = view(b);
    expect(v.payoff).toEqual(payoffCountdown(b, TODAY));
    expect(v.payoff).toMatchObject({ on: true, owed: 298_000, promoEndDate: '2027-03-31' });
  });

  it('9.5 off again once it is cleared', () => {
    const b = book();
    b.changeSettings({ oldCardPromoEndDate: '2027-03-31' }, '2026-10-05');
    b.changeSettings({ oldCardPromoEndDate: null }, '2026-10-06');
    expect(view(b).payoff.on).toBe(false);
  });
});

describe('4.2 6.2 7.4 the sorting rules, in the order they are tried', () => {
  it('4.2 B9 each kind in list order, numbered from 1: the first that matches wins', () => {
    const b = book({
      rules: [
        { id: 'a', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
        { id: 'b', for: 'deposit', contains: 'FRIEND', choice: { to: 'wants' } },
        { id: 'c', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
        { id: 'd', for: 'person', contains: 'LANDLORD', choice: { to: 'needs' } },
        { id: 'e', for: 'person', contains: 'ROOMMATE', choice: { to: 'not-mine' } },
      ],
    });
    const v = view(b);
    expect(v.rules).toEqual({
      purchase: [
        { id: 'a', for: 'purchase', contains: 'GROCER', to: 'needs', position: 1 },
        { id: 'c', for: 'purchase', contains: 'CAFE', to: 'wants', position: 2 },
      ],
      deposit: [{ id: 'b', for: 'deposit', contains: 'FRIEND', to: 'wants', position: 1 }],
      person: [
        { id: 'd', for: 'person', contains: 'LANDLORD', to: 'needs', position: 1 },
        { id: 'e', for: 'person', contains: 'ROOMMATE', to: 'not-mine', position: 2 },
      ],
    });
  });

  it('4.2 6.2 7.4 the choices each kind of rule can make are the money math\'s', () => {
    expect(view(book()).ruleChoices).toEqual(RULE_CHOICES);
  });

  it('4.2 with no rules, the lists are empty', () => {
    expect(view(book()).rules).toEqual({ purchase: [], deposit: [], person: [] });
  });
});

describe('13.5 the change log, newest first', () => {
  it('13.5 a settings change is one row for each setting, with what it was, what it is, and the date', () => {
    const b = book();
    b.changeSettings({ split: { savings: 40, needs: 40, wants: 20 }, payScheduleDays: 7 }, '2026-10-05');
    const v = view(b);
    expect(v.log).toEqual([
      { key: '0-0', date: '2026-10-05', kind: 'setting', change: { key: 'split', before: { savings: 50, needs: 30, wants: 20 }, after: { savings: 40, needs: 40, wants: 20 } }, fromNextPaycheck: true },
      { key: '0-1', date: '2026-10-05', kind: 'setting', change: { key: 'payScheduleDays', before: 14, after: 7 }, fromNextPaycheck: false },
    ]);
  });

  it('13.5 rule changes, hand moves, and take-backs too, the newest first', () => {
    const b = book({ rules: [{ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }] });
    b.receive(purchase('e1', '2026-10-02', 2_000, 'MADE UP GROCER'));
    b.addRule({ id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' }, '2026-10-03');
    b.changeRule({ id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'needs' }, '2026-10-04');
    b.moveMoney({ from: 'wants', to: 'needs', amount: 2_500 }, '2026-10-05');
    b.removeRule('cafe', '2026-10-06');
    b.receive(takenBack('t1', 'e1', '2026-10-07'));
    const v = view(b);
    expect(v.log).toEqual([
      { key: '4-0', date: '2026-10-07', kind: 'bank-took-back', description: 'MADE UP GROCER', amount: 2_000 },
      { key: '3-0', date: '2026-10-06', kind: 'rule-removed', rule: { id: 'cafe', for: 'purchase', contains: 'CAFE', to: 'needs' } },
      { key: '2-0', date: '2026-10-05', kind: 'money-moved', from: 'wants', to: 'needs', amount: 2_500 },
      { key: '1-0', date: '2026-10-04', kind: 'rule-changed', before: { id: 'cafe', for: 'purchase', contains: 'CAFE', to: 'wants' }, after: { id: 'cafe', for: 'purchase', contains: 'CAFE', to: 'needs' } },
      { key: '0-0', date: '2026-10-03', kind: 'rule-added', rule: { id: 'cafe', for: 'purchase', contains: 'CAFE', to: 'wants' }, aheadOf: null, fromCorrection: false },
    ]);
  });

  it('13.5 13.6 a rule made from a correction says which rule it went ahead of, as that rule was then', () => {
    const b = book({ rules: [{ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }] });
    b.receive(purchase('e1', '2026-10-02', 2_000, 'MADE UP GROCER CAFE'));
    b.sortAlways('e1', { to: 'wants' }, { id: 'fix', contains: 'GROCER CAFE' }, '2026-10-03');
    // Changed and then removed later: the log still says what it was when the fix went ahead of it.
    b.changeRule({ id: 'grocer', for: 'purchase', contains: 'GROCERY', bucket: 'needs' }, '2026-10-04');
    b.removeRule('grocer', '2026-10-05');
    const row = view(b).log.at(-1);
    expect(row).toEqual({
      key: '0-0',
      date: '2026-10-03',
      kind: 'rule-added',
      rule: { id: 'fix', for: 'purchase', contains: 'GROCER CAFE', to: 'wants' },
      aheadOf: { id: 'grocer', for: 'purchase', contains: 'GROCER', to: 'needs' },
      fromCorrection: true,
    });
  });

  it('13.5 A22 a moved rule: which way, past which rule, and its place now', () => {
    const b = book({ rules: [{ id: 'store', for: 'purchase', contains: 'STORE', bucket: 'needs' }, { id: 'big', for: 'purchase', contains: 'BIG STORE', bucket: 'wants' }] });
    b.moveRule('big', 'up', '2026-10-05');
    expect(view(b).log).toEqual([
      {
        key: '0-0',
        date: '2026-10-05',
        kind: 'rule-moved',
        rule: { id: 'big', for: 'purchase', contains: 'BIG STORE', to: 'wants' },
        past: { id: 'store', for: 'purchase', contains: 'STORE', to: 'needs' },
        direction: 'up',
        position: 1,
      },
    ]);
    expect(view(b).rules.purchase.map((r) => [r.id, r.position])).toEqual([
      ['big', 1],
      ['store', 2],
    ]);
  });

  it('13.5 13.6 A22 a correction ahead of a rule that was moved later still shows that rule as it was then', () => {
    const b = book({ rules: [{ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }, { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' }] });
    b.receive(purchase('e1', '2026-10-02', 2_000, 'MADE UP GROCER CAFE'));
    b.sortAlways('e1', { to: 'wants' }, { id: 'fix', contains: 'GROCER CAFE' }, '2026-10-03');
    b.moveRule('cafe', 'up', '2026-10-04');
    b.removeRule('grocer', '2026-10-05');
    const row = view(b).log.at(-1);
    expect(row).toMatchObject({ kind: 'rule-added', fromCorrection: true, aheadOf: { id: 'grocer', contains: 'GROCER', to: 'needs' } });
  });

  it('13.5 the same day: the one made last comes first', () => {
    const b = book();
    b.moveMoney({ from: 'wants', to: 'needs', amount: 1 }, '2026-10-05');
    b.moveMoney({ from: 'needs', to: 'wants', amount: 2 }, '2026-10-05');
    expect(view(b).log.map((r) => (r.kind === 'money-moved' ? r.amount : null))).toEqual([2, 1]);
  });

  it('13.5 with nothing changed yet, the log is empty', () => {
    expect(view(book()).log).toEqual([]);
  });
});

describe('0.5 Settings says so too when the totals do not match the bank', () => {
  it('0.5 matches, does not match with the difference, or the bank cannot be read', () => {
    const b = book();
    expect(view(b).check).toEqual({ state: 'matches' });
    expect(view(b, { bank: { ...matchingBank(b), checking: matchingBank(b).checking + 1_234 } }).check).toEqual({ state: 'does-not-match', difference: 1_234 });
    expect(view(b, { bank: null }).check).toEqual({ state: 'bank-not-read' });
  });
});
