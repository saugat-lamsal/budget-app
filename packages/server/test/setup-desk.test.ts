import { DEFAULT_SETTINGS, withPendingCharges, type IsoDate, type StartingPots } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { checkBankRules } from '../src/bank/reading.js';
import { parseRequest } from '../src/choices.js';
import { madeUpHistory, type MadeUpBank } from '../src/demo/made-up-bank.js';
import { SetupDesk } from '../src/setup-desk.js';
import type { SetupRequest, SetupResponse, SetupStep } from '../src/views/choice.js';
import type { SetupReadyView } from '../src/views/setup.js';

// Taps on the Setup day screens reach the server through the same desk as
// every other choice (rulebook section 14; QUESTIONS.md B42, B43, B48). The
// screen works nothing out. Every name and number is made up.

const TODAY: IsoDate = '2026-10-07';
const RULES = checkBankRules([
  { id: 'card-paid', account: 'checking', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' },
  { id: 'from-chk', account: 'savings', contains: 'transfer from CHK 1111', means: 'transfer', other: 'checking' },
  { id: 'old-paid', account: 'checking', contains: 'payment to CRD 4444', means: 'transfer', other: 'old-card' },
]);

// Checking 3,000.00 less a 25.00 charge pending, savings 5,000.00, the
// everyday card owes 450.00: 7,525.00 before anything on its way.
const BANK: MadeUpBank = {
  balances: { checking: 300_000, savings: 500_000, 'everyday-card': 45_000, 'old-card': 298_000 },
  rules: RULES,
  items: [
    { id: 'p-chk', account: 'checking', amount: 2_500, date: '2026-10-06', description: 'GROCERY STORE', pending: true },
    { id: 'left', account: 'checking', amount: 20_000, date: '2026-10-05', description: 'Online payment to CRD 3333' },
    { id: 'landed', account: 'savings', amount: -10_000, date: '2026-10-06', description: 'Online Banking transfer from CHK 1111' },
    { id: 'to-old', account: 'checking', amount: 5_000, date: '2026-10-06', description: 'Online payment to CRD 4444' },
  ],
};
const BANK_SIDE = 752_500;

function desk(bank: MadeUpBank | null = BANK, settings = DEFAULT_SETTINGS): SetupDesk {
  return new SetupDesk({ bank: bank === null ? null : madeUpHistory(bank), today: () => TODAY, settings, rules: [], halvesWithinDays: 10, madeUpData: true });
}

let n = 0;
const id = (): string => `setup-decision-${(n += 1)}`;
const ask = (d: SetupDesk, setup: SetupStep, more: Partial<SetupRequest> = {}): SetupResponse => d.decide({ id: id(), setup, ...more });

function ready(d: SetupDesk): SetupReadyView {
  const view = d.view();
  if (view.state !== 'not-set-up' || !view.ready) throw new Error(`not ready: ${JSON.stringify(view)}`);
  return view;
}

function refused(answer: SetupResponse): { code: string; why: string } {
  if (answer.ok) throw new Error(`expected a refusal, got ${JSON.stringify(answer)}`);
  return answer;
}

const pots = (p: Partial<StartingPots>): StartingPots => ({ savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0, ...p });

// Every answer but the assignment.
function answered(d: SetupDesk): void {
  for (const half of ready(d).halves) expect(ask(d, { onItsWay: { half: half.id, answer: true } }).ok).toBe(true);
  expect(ask(d, { lastPaycheck: '2026-10-02' }).ok).toBe(true);
}

function assign(d: SetupDesk, p: Partial<StartingPots>): void {
  for (const [pot, amount] of Object.entries(pots(p))) {
    const answer = ask(d, { assign: { pot: pot as keyof StartingPots, amount } });
    if (!answer.ok && !answer.why.startsWith('That is already')) throw new Error(answer.why);
  }
}

function start(d: SetupDesk, key = ready(d).key, decision = id()): SetupResponse {
  return d.decide({ id: decision, setup: { start: true }, confirmed: true, seen: key });
}

describe('B48 transfers on their way: he says which', () => {
  it('B48 each half starts unanswered, and the starting money leaves it out', () => {
    const v = ready(desk());
    expect(v.halves.map((h) => [h.id, h.kind, h.effect, h.onItsWay, h.rule?.id])).toEqual([
      ['left', 'left', 20_000, null, 'card-paid'],
      ['landed', 'arrived', -10_000, null, 'from-chk'],
      ['to-old', 'left', 0, null, 'old-paid'],
    ]);
    expect(v.unanswered).toBe(3);
    expect(v.startingMoney).toBe(BANK_SIDE);
    expect(v.missing).toContain('halves');
  });

  it('B48 the starting money follows his answers, by what each half does', () => {
    const d = desk();
    const yes = ask(d, { onItsWay: { half: 'left', answer: true } });
    expect(yes).toEqual({ ok: true, replayed: false, done: { step: 'on-its-way', half: 'left', answer: true, startingMoney: BANK_SIDE + 20_000 } });
    expect(ask(d, { onItsWay: { half: 'landed', answer: true } })).toMatchObject({ ok: true, done: { startingMoney: BANK_SIDE + 20_000 - 10_000 } });
    // The old card is not part of the starting money (12.4).
    expect(ask(d, { onItsWay: { half: 'to-old', answer: true } })).toMatchObject({ ok: true, done: { startingMoney: BANK_SIDE + 10_000 } });
    expect(ready(d)).toMatchObject({ unanswered: 0, inTransit: 10_000, startingMoney: BANK_SIDE + 10_000 });
    // Changed his mind: not on its way after all.
    expect(ask(d, { onItsWay: { half: 'left', answer: false } })).toMatchObject({ ok: true, done: { startingMoney: BANK_SIDE - 10_000 } });
    expect(ready(d).halves.find((h) => h.id === 'left')?.onItsWay).toBe(false);
  });

  it('B48 a half setup day did not ask about is refused, and the same answer again changes nothing', () => {
    const d = desk();
    expect(refused(ask(d, { onItsWay: { half: 'p-chk', answer: true } })).why).toMatch(/not one setup day asks about/);
    ask(d, { onItsWay: { half: 'left', answer: true } });
    expect(refused(ask(d, { onItsWay: { half: 'left', answer: true } })).why).toMatch(/already your answer/);
  });
});

describe('A25 how far back setup day looks for transfers with one side showing is a setting', () => {
  it('A25 it starts at 10 days, and changing it changes which transfers are asked about', () => {
    const d = desk();
    expect(ready(d).halvesWithinDays).toBe(10);
    expect(ask(d, { lookBack: 1 })).toEqual({ ok: true, replayed: false, done: { step: 'look-back', days: 1, asked: 2 } });
    expect(ready(d)).toMatchObject({ halvesWithinDays: 1, unanswered: 2 });
    expect(ready(d).halves.map((h) => h.id)).toEqual(['landed', 'to-old']);
  });

  it('A25 exactly that many days back is asked about; one day more is not', () => {
    const d = desk();
    // 'left' is from Oct 5, two days before today.
    ask(d, { lookBack: 2 });
    expect(ready(d).halves.map((h) => h.id)).toContain('left');
    ask(d, { lookBack: 1 });
    expect(ready(d).halves.map((h) => h.id)).not.toContain('left');
  });

  it('A25 zero days: only today; nothing here is from today, so nothing is asked', () => {
    const d = desk();
    ask(d, { lookBack: 0 });
    expect(ready(d)).toMatchObject({ halves: [], unanswered: 0, startingMoney: BANK_SIDE });
    expect(ready(d).missing).not.toContain('halves');
  });

  it('A25 an answer to a transfer no longer asked about is dropped: it is history, and looking back further asks again', () => {
    const d = desk();
    ask(d, { onItsWay: { half: 'left', answer: true } });
    expect(ready(d).startingMoney).toBe(BANK_SIDE + 20_000);
    ask(d, { lookBack: 1 });
    expect(ready(d).startingMoney).toBe(BANK_SIDE);
    ask(d, { lookBack: 10 });
    expect(ready(d).halves.find((h) => h.id === 'left')?.onItsWay).toBeNull();
    expect(ready(d).startingMoney).toBe(BANK_SIDE);
  });

  it('A25 a very large number looks back over the whole history', () => {
    const d = desk();
    expect(ask(d, { lookBack: 100_000 })).toMatchObject({ ok: true, done: { asked: 3 } });
  });

  it('A25 the same number again changes nothing, and says so', () => {
    const d = desk();
    expect(refused(ask(d, { lookBack: 10 })).why).toBe('That is already the setting. Nothing was changed.');
    ask(d, { lookBack: 3 });
    expect(refused(ask(d, { lookBack: 3 })).why).toBe('That is already the setting. Nothing was changed.');
  });
});

describe('B42 the date of his last paycheck', () => {
  it('B42 any day up to today; the next payday comes from the pay schedule (11.2)', () => {
    const d = desk();
    expect(ready(d).lastPaycheck).toBeNull();
    expect(ask(d, { lastPaycheck: '2026-10-02' })).toEqual({ ok: true, replayed: false, done: { step: 'last-paycheck', date: '2026-10-02', nextPayday: '2026-10-16' } });
    expect(ready(d).lastPaycheck).toEqual({ date: '2026-10-02', nextPayday: '2026-10-16', daysToPayday: 9 });
    expect(ask(d, { lastPaycheck: TODAY }).ok).toBe(true);
    // A payday already passed with no paycheck is late, not skipped (B35).
    expect(ask(d, { lastPaycheck: '2026-09-18' }).ok).toBe(true);
    expect(ready(d).lastPaycheck).toEqual({ date: '2026-09-18', nextPayday: '2026-10-02', daysToPayday: -5 });
  });

  it('B42 a day after today is refused: that paycheck has not come', () => {
    const d = desk();
    expect(refused(ask(d, { lastPaycheck: '2026-10-08' })).why).toMatch(/after today/);
    expect(ready(d).lastPaycheck).toBeNull();
  });

  it('B42 a day that is not a real date is refused', () => {
    expect(refused(ask(desk(), { lastPaycheck: '2026-02-30' })).why).toMatch(/real date/);
  });
});

describe('14.2 handing out the starting money', () => {
  it('14.2 what is left to assign comes from the money math, after each amount', () => {
    const d = desk();
    expect(ready(d)).toMatchObject({ assigned: 0, leftToAssign: BANK_SIDE });
    expect(ask(d, { assign: { pot: 'savings', amount: 500_000 } })).toEqual({ ok: true, replayed: false, done: { step: 'assign', pot: 'savings', amount: 500_000, leftToAssign: BANK_SIDE - 500_000 } });
    expect(ask(d, { assign: { pot: 'needs', amount: 252_499 } })).toMatchObject({ ok: true, done: { leftToAssign: 1 } });
    expect(ask(d, { assign: { pot: 'needs', amount: 252_501 } })).toMatchObject({ ok: true, done: { leftToAssign: -1 } });
    expect(ready(d)).toMatchObject({ assignment: pots({ savings: 500_000, needs: 252_501 }), assigned: BANK_SIDE + 1, leftToAssign: -1 });
  });

  it('14.2 zero is an amount, and the same amount again changes nothing', () => {
    const d = desk();
    ask(d, { assign: { pot: 'wants', amount: 1 } });
    expect(ask(d, { assign: { pot: 'wants', amount: 0 } })).toMatchObject({ ok: true, done: { amount: 0, leftToAssign: BANK_SIDE } });
    expect(refused(ask(d, { assign: { pot: 'wants', amount: 0 } })).why).toMatch(/already the amount/);
  });

  it('14.2 the rest goes into one bucket, worked out by the money math', () => {
    const d = desk();
    ask(d, { assign: { pot: 'savings', amount: 500_000 } });
    expect(ask(d, { assign: { pot: 'needs', rest: true } })).toMatchObject({ ok: true, done: { pot: 'needs', amount: BANK_SIDE - 500_000, leftToAssign: 0 } });
    expect(refused(ask(d, { assign: { pot: 'wants', rest: true } })).why).toMatch(/Nothing is left to assign/);
    // Too much assigned: the rest takes it back out of the bucket picked.
    ask(d, { assign: { pot: 'wants', amount: 2_000 } });
    expect(ask(d, { assign: { pot: 'needs', rest: true } })).toMatchObject({ ok: true, done: { amount: BANK_SIDE - 502_000, leftToAssign: 0 } });
  });

  it('14.2 an amount too large to keep exact is refused, and nothing changes', () => {
    const d = desk();
    ask(d, { assign: { pot: 'savings', amount: Number.MAX_SAFE_INTEGER } });
    expect(refused(ask(d, { assign: { pot: 'needs', amount: 1 } })).why).toMatch(/too large/);
    expect(ready(d).assignment.needs).toBe(0);
  });
});

describe('14.3 starting to track', () => {
  it('14.3 refused until each half is answered, the date is in, and it adds up to the cent', () => {
    const d = desk();
    expect(refused(start(d)).why).toMatch(/each transfer/);
    for (const half of ready(d).halves) ask(d, { onItsWay: { half: half.id, answer: true } });
    expect(refused(start(d)).why).toMatch(/last paycheck/);
    ask(d, { lastPaycheck: '2026-10-02' });
    const money = ready(d).startingMoney;
    assign(d, { savings: 500_000, needs: money - 500_000 - 1 });
    expect(refused(start(d)).why).toBe('$0.01 is still to assign. Nothing was changed.');
    assign(d, { savings: 500_000, needs: money - 500_000 + 1 });
    expect(refused(start(d)).why).toBe('$0.01 more is assigned than there is. Nothing was changed.');
    expect(d.started()).toBeNull();
    assign(d, { savings: 500_000, needs: money - 500_000 });
    expect(start(d)).toMatchObject({ ok: true, done: { step: 'started', startingMoney: money } });
  });

  it('14.3 it asks first: without his yes, or with a yes to what he saw before a change, nothing starts', () => {
    const d = desk();
    answered(d);
    const money = ready(d).startingMoney;
    assign(d, { needs: money });
    const noYes = d.decide({ id: id(), setup: { start: true } });
    expect(refused(noYes)).toMatchObject({ code: 'needs-confirmation' });
    // Naming the last look is not a yes by itself.
    expect(refused(d.decide({ id: id(), setup: { start: true }, seen: ready(d).key }))).toMatchObject({ code: 'needs-confirmation' });
    expect(refused(d.decide({ id: id(), setup: { start: true }, confirmed: false, seen: ready(d).key }))).toMatchObject({ code: 'needs-confirmation' });
    const saw = ready(d).key;
    // Something changes after he looked: his yes is to what he saw.
    assign(d, { needs: money - 100, wants: 100 });
    expect(refused(start(d, saw))).toMatchObject({ code: 'needs-confirmation', why: expect.stringMatching(/changed since you looked/) });
    expect(d.started()).toBeNull();
    expect(start(d).ok).toBe(true);
  });

  it('14.3 after it starts: the buckets are what he assigned, and the self-check passes', () => {
    const d = desk();
    answered(d);
    const v = ready(d);
    const assignment = pots({ savings: 400_000, needs: 200_000, wants: 50_000, momReserve: 100_000, heldForOthers: v.startingMoney - 750_000 });
    assign(d, assignment);
    expect(ready(d).selfCheck).toMatchObject({ ok: true, difference: 0 });
    expect(start(d).ok).toBe(true);
    const started = d.started();
    if (started === null) throw new Error('not started');
    expect(started.book.pots()).toEqual({ ...assignment, unsortedIn: 0, unsortedOut: 0 });
    expect(started.book.selfCheck(started.bank)).toMatchObject({ ok: true, difference: 0, inTransit: v.inTransit });
    expect(started.book.lastPaycheckDate()).toBe('2026-10-02');
    expect(started.bank).toEqual(withPendingCharges({ checking: 300_000, savings: 500_000, everydayCard: 45_000 }, [{ account: 'checking', amount: 2_500 }]));
    expect(d.view()).toEqual({ state: 'tracking', madeUpData: true });
  });

  it('14.3 the answer says what is still to set: the paycheck rule and the mom rule', () => {
    const d = desk();
    answered(d);
    assign(d, { needs: ready(d).startingMoney });
    expect(start(d)).toMatchObject({ ok: true, done: { stillToSet: ['paycheckRule', 'momRule'] } });
    const set = desk(BANK, { ...DEFAULT_SETTINGS, paycheckRule: { contains: 'MADE UP PAYROLL' }, momRule: null });
    answered(set);
    assign(set, { needs: ready(set).startingMoney });
    expect(start(set)).toMatchObject({ ok: true, done: { stillToSet: ['momRule'] } });
  });

  it('14 setting up twice is refused, and so is every other step once it has started', () => {
    const d = desk();
    answered(d);
    assign(d, { needs: ready(d).startingMoney });
    const key = ready(d).key;
    expect(start(d, key).ok).toBe(true);
    const book = d.started()?.book;
    expect(refused(start(d, key)).why).toMatch(/done already/);
    expect(refused(ask(d, { assign: { pot: 'wants', amount: 1 } })).why).toMatch(/done already/);
    expect(refused(ask(d, { lastPaycheck: '2026-10-01' })).why).toMatch(/done already/);
    expect(refused(ask(d, { onItsWay: { half: 'left', answer: false } })).why).toMatch(/done already/);
    expect(d.started()?.book).toBe(book);
  });
});

describe('B92 decision numbers: a repeat changes nothing', () => {
  it('B92 the same decision sent again gets the first answer back, and changes nothing', () => {
    const d = desk();
    const request: SetupRequest = { id: 'repeat-decision-1', setup: { assign: { pot: 'savings', amount: 1_000 } } };
    const first = d.decide(request);
    ask(d, { assign: { pot: 'savings', amount: 2_000 } });
    expect(d.decide(request)).toEqual({ ...first, replayed: true });
    expect(ready(d).assignment.savings).toBe(2_000);
  });

  it('B92 a decision number used for something else is refused', () => {
    const d = desk();
    d.decide({ id: 'repeat-decision-2', setup: { assign: { pot: 'savings', amount: 1_000 } } });
    expect(refused(d.decide({ id: 'repeat-decision-2', setup: { assign: { pot: 'savings', amount: 3_000 } } })).code).toBe('id-reused');
    expect(ready(d).assignment.savings).toBe(1_000);
  });

  it('B92 starting, sent again after the answer was lost, gets the same answer and starts once', () => {
    const d = desk();
    answered(d);
    assign(d, { needs: ready(d).startingMoney });
    const key = ready(d).key;
    const first = start(d, key, 'repeat-decision-3');
    const book = d.started()?.book;
    expect(start(d, key, 'repeat-decision-3')).toEqual({ ...(first as object), replayed: true });
    expect(d.started()?.book).toBe(book);
  });

  it('B92 a refused step is not remembered: fixed, the same number goes through', () => {
    const d = desk();
    expect(d.decide({ id: 'repeat-decision-4', setup: { lastPaycheck: '2026-10-09' } }).ok).toBe(false);
    expect(d.decide({ id: 'repeat-decision-4', setup: { lastPaycheck: '2026-10-01' } }).ok).toBe(true);
  });
});

describe('B43 starting money below zero, zero, and very large', () => {
  it('B43 the everyday card owes more than the accounts hold: below zero, handed out below zero, and it starts', () => {
    const d = desk({ balances: { checking: 41_230, savings: 15_000, 'everyday-card': 231_877, 'old-card': 0 }, rules: RULES, items: [] });
    expect(ready(d)).toMatchObject({ startingMoney: -175_647, leftToAssign: -175_647, halves: [] });
    ask(d, { lastPaycheck: '2026-10-02' });
    ask(d, { assign: { pot: 'savings', amount: 15_000 } });
    ask(d, { assign: { pot: 'needs', amount: -150_000 } });
    expect(ask(d, { assign: { pot: 'wants', rest: true } })).toMatchObject({ ok: true, done: { amount: -40_647, leftToAssign: 0 } });
    expect(start(d).ok).toBe(true);
    expect(d.started()?.book.pots()).toMatchObject({ savings: 15_000, needs: -150_000, wants: -40_647 });
    expect(d.started()?.book.selfCheck(d.started()?.bank ?? { checking: 0, savings: 0, everydayCard: 0 }).ok).toBe(true);
  });

  it('14.2 a starting money of zero needs nothing assigned', () => {
    const d = desk({ balances: { checking: 10_000, savings: 0, 'everyday-card': 10_000, 'old-card': 0 }, rules: RULES, items: [] });
    ask(d, { lastPaycheck: '2026-10-02' });
    expect(ready(d)).toMatchObject({ startingMoney: 0, leftToAssign: 0, missing: [] });
    expect(start(d).ok).toBe(true);
  });

  it('14.2 one cent of starting money', () => {
    const d = desk({ balances: { checking: 1, savings: 0, 'everyday-card': 0, 'old-card': 0 }, rules: RULES, items: [] });
    ask(d, { lastPaycheck: '2026-10-02' });
    expect(refused(start(d)).why).toBe('$0.01 is still to assign. Nothing was changed.');
    ask(d, { assign: { pot: 'wants', amount: 1 } });
    expect(start(d).ok).toBe(true);
  });

  it('14.2 very large balances are exact', () => {
    const big = 99_999_999_999_99;
    const d = desk({ balances: { checking: big, savings: big, 'everyday-card': 1, 'old-card': big }, rules: RULES, items: [] });
    expect(ready(d)).toMatchObject({ startingMoney: big * 2 - 1, oldCard: { debt: big } });
    ask(d, { lastPaycheck: '2026-10-02' });
    ask(d, { assign: { pot: 'savings', amount: big } });
    ask(d, { assign: { pot: 'needs', rest: true } });
    expect(start(d).ok).toBe(true);
    expect(d.started()?.book.pots().needs).toBe(big - 1);
  });
});

describe('14 before the bank can be read', () => {
  it('14 no bank connection: the view says why, and every step is refused', () => {
    const d = desk(null);
    expect(d.view()).toEqual({ state: 'not-set-up', madeUpData: true, ready: false, why: 'there is no bank connection yet' });
    expect(refused(ask(d, { lastPaycheck: '2026-10-02' })).why).toMatch(/no bank connection/);
    expect(refused(start(d, 'abc')).why).toMatch(/no bank connection/);
  });

  it('14 the history still coming: setup day waits for it (B64)', () => {
    const d = desk({ ...BANK, historyComplete: false });
    expect(d.view()).toMatchObject({ ready: false, why: expect.stringMatching(/history/) });
    expect(refused(ask(d, { assign: { pot: 'needs', amount: 1 } })).why).toMatch(/history/);
  });
});

describe('14 what the phone may send for setup day: exactly the right shape, or nothing', () => {
  const good: unknown[] = [
    { id: 'abcdefgh', setup: { onItsWay: { half: 'left', answer: true } } },
    { id: 'abcdefgh', setup: { lastPaycheck: '2026-10-02' } },
    { id: 'abcdefgh', setup: { assign: { pot: 'needs', amount: -175_647 } } },
    { id: 'abcdefgh', setup: { assign: { pot: 'heldForOthers', amount: 0 } } },
    { id: 'abcdefgh', setup: { assign: { pot: 'momReserve', rest: true } } },
    { id: 'abcdefgh', setup: { start: true }, confirmed: true, seen: '0123abcd' },
    { id: 'abcdefgh', setup: { lookBack: 0 } },
    { id: 'abcdefgh', setup: { lookBack: 10 } },
  ];
  it.each(good.map((g) => [JSON.stringify(g), g]))('14 read: %s', (_name, value) => {
    expect(parseRequest(value)).toEqual(value);
  });

  const bad: unknown[] = [
    { id: 'short', setup: { start: true } },
    { id: 'abcdefgh', setup: { start: false } },
    { id: 'abcdefgh', setup: { start: true, extra: 1 } },
    { id: 'abcdefgh', setup: {} },
    { id: 'abcdefgh', setup: { lastPaycheck: '2026-10-02', start: true } },
    { id: 'abcdefgh', setup: { lastPaycheck: 'Oct 2' } },
    { id: 'abcdefgh', setup: { lastPaycheck: 20261002 } },
    { id: 'abcdefgh', setup: { onItsWay: { half: '', answer: true } } },
    { id: 'abcdefgh', setup: { onItsWay: { half: 'left', answer: 'yes' } } },
    { id: 'abcdefgh', setup: { assign: { pot: 'unsortedIn', amount: 1 } } },
    { id: 'abcdefgh', setup: { assign: { pot: 'needs', amount: 1.5 } } },
    { id: 'abcdefgh', setup: { assign: { pot: 'needs', amount: '100' } } },
    { id: 'abcdefgh', setup: { assign: { pot: 'needs', amount: 2 ** 53 } } },
    { id: 'abcdefgh', setup: { assign: { pot: 'needs', rest: false } } },
    { id: 'abcdefgh', setup: { assign: { pot: 'needs', amount: 1, rest: true } } },
    { id: 'abcdefgh', setup: { start: true }, confirmed: 'yes' },
    { id: 'abcdefgh', setup: { start: true }, seen: 'not hex!' },
    { id: 'abcdefgh', setup: { start: true }, more: 1 },
    { id: 'abcdefgh', setup: { lookBack: -1 } },
    { id: 'abcdefgh', setup: { lookBack: 1.5 } },
    { id: 'abcdefgh', setup: { lookBack: '10' } },
    { id: 'abcdefgh', setup: { lookBack: 2 ** 53 } },
  ];
  it.each(bad.map((b) => [JSON.stringify(b), b]))('14 not read: %s', (_name, value) => {
    expect(parseRequest(value)).toBeNull();
  });
});
