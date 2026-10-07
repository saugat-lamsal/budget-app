import { describe, expect, it } from 'vitest';
import { startTracking, startingMoney, type Book, type Purchase, type SetupInput } from '../src/index.js';
import { TEST_SETTINGS, arrived, codeOf, dropped, posted, purchase, refund, sent } from './helpers.js';

// The bank on setup day (made up): checking 2,500.00, savings 4,000.00,
// everyday card owes 300.00 posted plus a 45.00 pending charge.
const POSTED = { checking: 250_000, savings: 400_000, everydayCard: 30_000 };
const PENDING: Purchase[] = [purchase('pend1', '2026-10-05', 4_500, 'MADE UP CAFE', { pending: true })];
// 2,500.00 + 4,000.00 - (300.00 + 45.00) = 6,155.00
const STARTING = 615_500;

function setup(overrides: Partial<SetupInput> = {}): SetupInput {
  return {
    date: '2026-10-06',
    bankBalances: POSTED,
    pendingCharges: PENDING,
    oldCardBalance: 290_000,
    assignment: { savings: 400_000, needs: 100_000, wants: 50_000, momReserve: 60_000, heldForOthers: 5_500 },
    lastPaycheckDate: '2026-09-25',
    settings: TEST_SETTINGS,
    ...overrides,
  };
}

function started(overrides: Partial<SetupInput> = {}): Book {
  const result = startTracking(setup(overrides));
  if (!result.ok) throw new Error(`setup did not start: ${JSON.stringify(result)}`);
  return result.book;
}

describe('14.1 the app reads your current balances', () => {
  it('14.1 starting money is checking + savings - everyday card, with pending charges included', () => {
    expect(startingMoney(POSTED, PENDING)).toBe(STARTING);
  });

  it('14.1 the old card is not part of the starting money; it becomes the debt, with its pending charges', () => {
    const oldPending = purchase('old1', '2026-10-05', 1_000, 'MADE UP STORE', { account: 'old-card', pending: true });
    expect(startingMoney(POSTED, [...PENDING, oldPending])).toBe(STARTING);
    expect(started({ pendingCharges: [...PENDING, oldPending] }).oldCardDebt()).toBe(291_000);
  });

  it('14.1 only pending charges can be pending at setup', () => {
    expect(codeOf(() => startTracking(setup({ pendingCharges: [purchase('p', '2026-10-05', 100, 'X')] })))).toBe('bad-transaction');
  });
});

describe('14.2 you assign the starting money across the buckets and held for others', () => {
  it('14.2 the assignment becomes the starting buckets', () => {
    expect(started().pots()).toEqual({ savings: 400_000, needs: 100_000, wants: 50_000, momReserve: 60_000, heldForOthers: 5_500, unsortedIn: 0, unsortedOut: 0 });
  });

  it('14.2 starting money can be below zero when the card owes more than you have', () => {
    const bank = { checking: 10_000, savings: 0, everydayCard: 50_000 };
    expect(startingMoney(bank, [])).toBe(-40_000);
    const b = started({ bankBalances: bank, pendingCharges: [], assignment: { savings: 0, needs: -40_000, wants: 0, momReserve: 0, heldForOthers: 0 } });
    expect(b.pots().needs).toBe(-40_000);
  });

  it('14.2 every assigned amount must be whole cents', () => {
    expect(codeOf(() => startTracking(setup({ assignment: { savings: 399_999.5, needs: 100_000.5, wants: 50_000, momReserve: 60_000, heldForOthers: 5_500 } })))).toBe('not-cents');
  });
});

describe('14.3 the self-check must pass before tracking starts', () => {
  it('14.3 an assignment that adds up exactly starts tracking, and the self-check passes on day one', () => {
    const result = startTracking(setup());
    expect(result.ok).toBe(true);
    const bank = { ...POSTED, everydayCard: POSTED.everydayCard + 4_500 };
    expect(result.ok && result.book.selfCheck(bank)).toMatchObject({ ok: true, difference: 0 });
  });

  it('14.3 one cent left to assign: tracking does not start', () => {
    expect(startTracking(setup({ assignment: { savings: 400_000, needs: 100_000, wants: 50_000, momReserve: 60_000, heldForOthers: 5_499 } }))).toEqual({
      ok: false,
      startingMoney: STARTING,
      assigned: STARTING - 1,
      difference: 1,
    });
  });

  it('14.3 one cent too much assigned: tracking does not start', () => {
    expect(startTracking(setup({ assignment: { savings: 400_001, needs: 100_000, wants: 50_000, momReserve: 60_000, heldForOthers: 5_500 } }))).toMatchObject({
      ok: false,
      difference: -1,
    });
  });

  it('14.3 tracking starts on setup day, counting the pay schedule from the last paycheck', () => {
    const b = started();
    expect(b.period()).toEqual({ number: 0, startDate: '2026-10-06' });
    expect(b.safeToSpend('2026-10-06')).toMatchObject({ nextPayday: '2026-10-09', daysToPayday: 3 });
  });
});

describe('setup day: charges that were pending on setup day (QUESTIONS.md A10)', () => {
  it('posting at the same amount changes nothing: it was already counted in the starting money', () => {
    const b = started();
    expect(b.receive(posted('post1', 'pend1', '2026-10-07', 4_500, 'MADE UP CAFE')).outcome).toBe('posted');
    expect(b.pots()).toEqual(started().pots());
    expect(b.reviewItems()).toEqual([]);
  });

  it('posting higher: only the difference waits in review as spending', () => {
    const b = started();
    b.receive(posted('post1', 'pend1', '2026-10-07', 5_400, 'MADE UP CAFE'));
    expect(b.pots()).toMatchObject({ wants: 50_000, unsortedOut: 900 });
    expect(b.reviewItems()).toMatchObject([{ id: 'pend1', amount: 900, reason: 'setup-difference' }]);
    b.sort('pend1', { to: 'wants' }, '2026-10-07');
    expect(b.pots()).toMatchObject({ wants: 49_100, unsortedOut: 0 });
  });

  it('posting lower: the difference comes back to the bucket you pick', () => {
    const b = started();
    b.receive(posted('post1', 'pend1', '2026-10-07', 4_000, 'MADE UP CAFE'));
    expect(b.pots()).toMatchObject({ unsortedOut: -500 });
    b.sort('pend1', { to: 'wants' }, '2026-10-07');
    expect(b.pots()).toMatchObject({ wants: 50_500, unsortedOut: 0 });
  });

  it('the self-check holds through it', () => {
    const b = started();
    b.receive(posted('post1', 'pend1', '2026-10-07', 5_400, 'MADE UP CAFE'));
    expect(b.selfCheck({ ...POSTED, everydayCard: POSTED.everydayCard + 5_400 })).toMatchObject({ ok: true });
  });

  it('a refund of a charge pending at setup goes back to the bucket you pick', () => {
    const b = started();
    b.receive(posted('post1', 'pend1', '2026-10-07', 4_500, 'MADE UP CAFE'));
    b.receive(refund('r1', '2026-10-08', 4_500, 'post1'));
    expect(b.pots()).toMatchObject({ unsortedOut: -4_500 });
    b.sort('pend1', { to: 'wants' }, '2026-10-08');
    expect(b.pots()).toMatchObject({ wants: 54_500, unsortedOut: 0 });
  });

  it('14.2 a charge pending on setup day that the bank drops: its money comes back to the bucket you pick (A2, A10)', () => {
    const b = started();
    b.receive(dropped('d1', 'pend1', '2026-10-07'));
    // It was in the starting money; now the bank has it back, so it waits
    // in review, like any change to a charge pending on setup day.
    expect(b.pots()).toMatchObject({ unsortedOut: -4_500 });
    expect(b.selfCheck({ ...POSTED })).toMatchObject({ ok: true });
    b.sort('pend1', { to: 'wants' }, '2026-10-07');
    expect(b.pots()).toMatchObject({ wants: 54_500, unsortedOut: 0 });
  });

  it('the pending charge sent again after setup counts once', () => {
    const b = started();
    expect(b.receive(PENDING[0] as Purchase).outcome).toBe('duplicate');
    expect(b.pots()).toEqual(started().pots());
  });

  it('an old card charge pending at setup changes only the debt when it posts, and is not flagged', () => {
    const oldPending = purchase('old1', '2026-10-05', 1_000, 'MADE UP STORE', { account: 'old-card', pending: true });
    const b = started({ pendingCharges: [...PENDING, oldPending] });
    b.receive(posted('old2', 'old1', '2026-10-07', 1_200, 'MADE UP STORE', 'old-card'));
    expect(b.oldCardDebt()).toBe(291_200);
    expect(b.reviewItems()).toEqual([]);
  });

  it('two pending charges with the same id are refused', () => {
    expect(codeOf(() => startTracking(setup({ pendingCharges: [...PENDING, ...PENDING] })))).toBe('conflicting-id');
  });
});

describe('setup day with a payment still in transit (12.5)', () => {
  // A 200.00 card payment left checking the day before setup day and has not
  // reached the card yet, so checking is already 200.00 lower.
  const inTransit = [sent('pay1', '2026-10-05', 20_000, 'checking', 'everyday-card')];

  it('12.5 money in transit on setup day is part of the starting money', () => {
    expect(startingMoney(POSTED, PENDING, inTransit)).toBe(STARTING + 20_000);
  });

  it('12.5 it starts tracking with the payment in transit, and the check holds when it lands', () => {
    const result = startTracking(setup({ transfersInTransit: inTransit, assignment: { savings: 420_000, needs: 100_000, wants: 50_000, momReserve: 60_000, heldForOthers: 5_500 } }));
    if (!result.ok) throw new Error(JSON.stringify(result));
    const b = result.book;
    const bank = { ...POSTED, everydayCard: POSTED.everydayCard + 4_500 };
    expect(b.selfCheck(bank)).toMatchObject({ inTransit: 20_000, ok: true });
    b.receive(arrived('land1', '2026-10-07', 20_000, 'checking', 'everyday-card'));
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
    expect(b.selfCheck({ ...bank, everydayCard: bank.everydayCard - 20_000 })).toMatchObject({ inTransit: 0, ok: true });
  });

  it('12.5 a payment to the old card in transit on setup day is not starting money; the debt goes down when it lands', () => {
    const toOld = [sent('pay2', '2026-10-05', 10_000, 'checking', 'old-card')];
    expect(startingMoney(POSTED, PENDING, toOld)).toBe(STARTING);
    const b = started({ transfersInTransit: toOld });
    expect(b.pots().needs).toBe(100_000);
    b.receive(arrived('land2', '2026-10-07', 10_000, 'checking', 'old-card'));
    expect(b.oldCardDebt()).toBe(280_000);
    expect(b.pots().needs).toBe(100_000);
  });

  it('12.5 only halves of transfers can be in transit on setup day', () => {
    expect(codeOf(() => startTracking(setup({ transfersInTransit: [purchase('x', '2026-10-05', 1, 'MADE UP STORE') as never] })))).toBe('bad-transaction');
  });

  // A 200.00 card payment has already landed on the card, but checking does
  // not show it leaving yet, so checking still holds it (found in review).
  const landedFirst = [arrived('land9', '2026-10-05', 20_000, 'checking', 'everyday-card')];

  it('12.5 a payment that landed before it is seen leaving is taken out of the starting money', () => {
    expect(startingMoney(POSTED, PENDING, landedFirst)).toBe(STARTING - 20_000);
  });

  it('12.5 it starts in transit the other way, and clears without a mismatch when the payment is seen leaving', () => {
    const result = startTracking(setup({ transfersInTransit: landedFirst, assignment: { savings: 400_000, needs: 80_000, wants: 50_000, momReserve: 60_000, heldForOthers: 5_500 } }));
    if (!result.ok) throw new Error(JSON.stringify(result));
    const b = result.book;
    const before = b.pots();
    const bank = { ...POSTED, everydayCard: POSTED.everydayCard + 4_500 };
    expect(b.selfCheck(bank)).toMatchObject({ inTransit: -20_000, ok: true });
    b.receive(sent('pay9', '2026-10-07', 20_000, 'checking', 'everyday-card'));
    expect(b.pots()).toEqual(before);
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
    expect(b.selfCheck({ ...bank, checking: bank.checking - 20_000 })).toMatchObject({ inTransit: 0, ok: true });
  });

  it('12.5 an old card payment that landed first on setup day: the debt is already lower; needs pays when it leaves, and the debt does not drop again', () => {
    const oldLanded = [arrived('land8', '2026-10-05', 10_000, 'checking', 'old-card')];
    expect(startingMoney(POSTED, PENDING, oldLanded)).toBe(STARTING);
    const b = started({ transfersInTransit: oldLanded, oldCardBalance: 280_000 });
    b.receive(sent('pay8', '2026-10-07', 10_000, 'checking', 'old-card'));
    expect(b.pots().needs).toBe(90_000);
    expect(b.oldCardDebt()).toBe(280_000);
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
  });

  it('12.5 both halves of the same transfer on setup day pair up and cancel out', () => {
    const both = [sent('pay7', '2026-10-04', 5_000, 'checking', 'savings'), arrived('land7', '2026-10-05', 5_000, 'checking', 'savings')];
    expect(startingMoney(POSTED, PENDING, both)).toBe(STARTING);
    const b = started({ transfersInTransit: both });
    expect(b.inTransit()).toEqual({ total: 0, items: [] });
  });
});
