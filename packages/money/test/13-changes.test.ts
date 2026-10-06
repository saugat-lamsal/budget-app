import { describe, expect, it } from 'vitest';
import { cardCharge, codeOf, deposit, openTestBook, payPerson, paycheck, posted, purchase, refund, type TestBookOptions } from './helpers.js';

const ROLL = { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } } as const;

function book(options: TestBookOptions = {}) {
  return openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0 }, settings: ROLL, ...options });
}

describe('13.1 a change to the split or the mom reserve applies from the next paycheck', () => {
  it('13.1 changing the split moves no money now; the next paycheck uses the new split', () => {
    const b = book();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const before = b.pots();
    b.changeSettings({ split: { savings: 60, needs: 25, wants: 15 } }, '2026-10-12');
    expect(b.pots()).toEqual(before);
    b.receive(paycheck('p2', '2026-10-23', 400_000));
    expect(b.paychecks()[1]?.split).toMatchObject({ savings: 150_000, needs: 62_500, wants: 37_500 });
  });

  it('13.1 changing the mom reserve amount or cap waits for the next paycheck too', () => {
    const b = book();
    b.changeSettings({ momReservePerPaycheck: 100_000, momReserveCap: 120_000 }, '2026-10-05');
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(b.paychecks()[0]?.split).toMatchObject({ momReserve: 100_000, detail: { reserveTaken: 100_000 } });
    b.receive(paycheck('p2', '2026-10-23', 400_000));
    expect(b.paychecks()[1]?.split).toMatchObject({ momReserve: 20_000, detail: { overflowToSavings: 80_000 } });
  });

  it('13.1 income sorted before the next paycheck still uses this pay period\'s split', () => {
    const b = book();
    b.changeSettings({ split: { savings: 0, needs: 0, wants: 100 }, momReservePerPaycheck: 0 }, '2026-10-05');
    b.receive(deposit('d1', '2026-10-06', 400_000, 'MADE UP BONUS'));
    b.sort('d1', { to: 'income' }, '2026-10-06');
    expect(b.pots()).toMatchObject({ momReserve: 150_000, savings: 225_000, needs: 125_000, wants: 80_000 });
  });

  it('13.1 income sorted after the next paycheck uses the new split', () => {
    const b = book();
    b.changeSettings({ split: { savings: 0, needs: 0, wants: 100 }, momReservePerPaycheck: 0 }, '2026-10-05');
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(deposit('d1', '2026-10-10', 1_000, 'MADE UP BONUS'));
    b.sort('d1', { to: 'income' }, '2026-10-10');
    expect(b.pots()).toMatchObject({ wants: 30_000 + 400_000 + 1_000 });
  });

  it('13.1 a change made on payday, after the paycheck arrived, waits for the following one', () => {
    const b = book();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.changeSettings({ split: { savings: 100, needs: 0, wants: 0 } }, '2026-10-09');
    expect(b.paychecks()[0]?.split.needs).toBe(75_000);
    b.receive(paycheck('p2', '2026-10-23', 400_000));
    expect(b.paychecks()[1]?.split.needs).toBe(0);
  });

  it('13.1 other settings apply right away', () => {
    const b = book({ lastPaycheckDate: '2026-10-01' });
    b.changeSettings({ earlyPaycheckDays: 3 }, '2026-10-02');
    expect(b.receive(paycheck('p1', '2026-10-04', 400_000)).outcome).toBe('paycheck');
    b.changeSettings({ payScheduleDays: 7 }, '2026-10-05');
    expect(b.safeToSpend('2026-10-05').nextPayday).toBe('2026-10-11');
  });

  it('13.1 a setting that makes no sense is refused and changes nothing', () => {
    const b = book();
    expect(codeOf(() => b.changeSettings({ split: { savings: 50, needs: 50, wants: 50 } }, '2026-10-05'))).toBe('bad-setting');
    expect(codeOf(() => b.changeSettings({ payScheduleDays: 7 }, '2026-02-30'))).toBe('not-a-date');
    expect(b.settings().split).toEqual({ savings: 50, needs: 30, wants: 20 });
    expect(b.changeLog()).toEqual([]);
  });
});

describe('0.3 changing a setting never rewrites a past pay period', () => {
  it('0.3 past paychecks, past leftovers, and today\'s buckets stay exactly as they were', () => {
    const b = book({ settings: { leftoverAtPayday: { needs: 'move-to-savings', wants: 'roll-over' } } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(purchase('e1', '2026-10-12', 10_000, 'MADE UP STORE'));
    b.sort('e1', { to: 'needs' }, '2026-10-12');
    const paychecks = b.paychecks();
    const pots = b.pots();
    const period = b.period();
    b.changeSettings(
      { split: { savings: 10, needs: 10, wants: 80 }, momReservePerPaycheck: 1, momReserveCap: 1, leftoverAtPayday: { needs: 'ask', wants: 'ask' } },
      '2026-10-13',
    );
    expect(b.paychecks()).toEqual(paychecks);
    expect(b.pots()).toEqual(pots);
    expect(b.period()).toEqual(period);
    expect(b.recountPots()).toEqual(pots);
  });
});

describe('13.2 a new or changed rule applies to new and unsorted transactions only', () => {
  it('13.2 a new rule sorts what is waiting in review right away', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-05', 4_000, 'MADE UP GROCER #1'));
    b.receive(purchase('e2', '2026-10-06', 1_000, 'MADE UP CAFE'));
    b.addRule({ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }, '2026-10-07');
    expect(b.pots()).toMatchObject({ needs: 46_000, unsortedOut: 1_000 });
    expect(b.reviewItems().map((i) => i.id)).toEqual(['e2']);
  });

  it('13.2 and it sorts new ones from then on', () => {
    const b = book();
    b.addRule({ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }, '2026-10-07');
    expect(b.receive(purchase('e1', '2026-10-08', 4_000, 'MADE UP GROCER')).outcome).toBe('sorted');
  });

  it('13.2 purchases you already sorted stay put', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-05', 4_000, 'MADE UP GROCER'));
    b.sort('e1', { to: 'wants' }, '2026-10-05');
    b.addRule({ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }, '2026-10-07');
    expect(b.purchases()[0]?.sortedTo).toEqual({ to: 'wants' });
  });

  it('13.2 changing a rule leaves what the old version sorted where it is', () => {
    const b = book({ rules: [{ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }] });
    b.receive(purchase('e1', '2026-10-05', 4_000, 'MADE UP GROCER'));
    b.changeRule({ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'wants' }, '2026-10-07');
    b.receive(purchase('e2', '2026-10-08', 1_000, 'MADE UP GROCER'));
    expect(b.purchases().map((p) => p.sortedTo)).toEqual([{ to: 'needs' }, { to: 'wants' }]);
    expect(b.rules()).toEqual([{ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'wants' }]);
  });

  it('13.2 removing a rule leaves what it sorted where it is', () => {
    const b = book({ rules: [{ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }] });
    b.receive(purchase('e1', '2026-10-05', 4_000, 'MADE UP GROCER'));
    b.removeRule('grocer', '2026-10-07');
    expect(b.receive(purchase('e2', '2026-10-08', 1_000, 'MADE UP GROCER')).outcome).toBe('review');
    expect(b.purchases().map((p) => p.sortedTo)).toEqual([{ to: 'needs' }, { to: 'unsorted' }]);
  });

  it('13.2 a new rule also sorts waiting deposits and payments to people', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 2_500, 'MADE UP FRIEND'));
    b.receive(payPerson('z1', '2026-10-05', 9_000, 'MADE UP LANDLORD'));
    b.addRule({ id: 'friend', for: 'deposit', contains: 'FRIEND', choice: { to: 'wants' } }, '2026-10-06');
    b.addRule({ id: 'landlord', for: 'person', contains: 'LANDLORD', choice: { to: 'needs' } }, '2026-10-06');
    expect(b.pots()).toMatchObject({ wants: 32_500, needs: 41_000, unsortedIn: 0, unsortedOut: 0 });
  });

  it('13.2 rules still never touch fees (4.8), store refunds, or early paychecks', () => {
    const b = book({ lastPaycheckDate: '2026-10-01' });
    b.receive(cardCharge('f1', '2026-10-05', 2_900, 'fee'));
    b.receive(paycheck('p1', '2026-10-05', 400_000));
    b.addRule({ id: 'fee', for: 'purchase', contains: 'FEE', bucket: 'wants' }, '2026-10-06');
    b.addRule({ id: 'pay', for: 'deposit', contains: 'PAYROLL', choice: { to: 'wants' } }, '2026-10-06');
    expect(b.reviewItems().map((i) => i.id)).toEqual(['f1', 'p1']);
  });

  it('13.2 a new rule goes to the end of the list, so an earlier matching rule still wins', () => {
    const b = book({ rules: [{ id: 'store', for: 'purchase', contains: 'STORE', bucket: 'needs' }] });
    b.addRule({ id: 'big-store', for: 'purchase', contains: 'BIG STORE', bucket: 'wants' }, '2026-10-06');
    b.receive(purchase('e1', '2026-10-07', 1_000, 'MADE UP BIG STORE'));
    expect(b.purchases()[0]?.sortedTo).toEqual({ to: 'needs' });
  });

  it('13.2 a rule with an id already in use, or an unknown rule to change or remove, is refused', () => {
    const b = book({ rules: [{ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }] });
    expect(codeOf(() => b.addRule({ id: 'grocer', for: 'purchase', contains: 'X', bucket: 'needs' }, '2026-10-06'))).toBe('bad-rule');
    expect(codeOf(() => b.changeRule({ id: 'nope', for: 'purchase', contains: 'X', bucket: 'needs' }, '2026-10-06'))).toBe('unknown-rule');
    expect(codeOf(() => b.removeRule('nope', '2026-10-06'))).toBe('unknown-rule');
    expect(codeOf(() => b.addRule({ id: 'x', for: 'purchase', contains: '', bucket: 'needs' }, '2026-10-06'))).toBe('bad-rule');
    expect(b.changeLog()).toEqual([]);
  });
});

describe('13.3 you can move money between buckets by hand at any time', () => {
  it('13.3 moving from wants to needs', () => {
    const b = book();
    expect(b.moveMoney({ from: 'wants', to: 'needs', amount: 5_000 }, '2026-10-05')).toEqual({ moved: true });
    expect(b.pots()).toMatchObject({ wants: 25_000, needs: 55_000 });
  });

  it('13.3 held for others can be moved too, for example when a friend says keep it', () => {
    const b = book({ pots: { heldForOthers: 2_000, wants: 0 } });
    b.moveMoney({ from: 'heldForOthers', to: 'wants', amount: 2_000 }, '2026-10-05');
    expect(b.pots()).toMatchObject({ heldForOthers: 0, wants: 2_000 });
  });

  it('13.3 a move can take a bucket below zero once you confirm it (13.4)', () => {
    const b = book();
    expect(b.moveMoney({ from: 'wants', to: 'needs', amount: 30_001 }, '2026-10-05').moved).toBe(false);
    expect(b.moveMoney({ from: 'wants', to: 'needs', amount: 30_001, confirmed: true }, '2026-10-05')).toEqual({ moved: true });
    expect(b.pots().wants).toBe(-1);
  });

  it('13.3 a leftover you rolled over can still be moved later (3.4)', () => {
    const b = book({ settings: { leftoverAtPayday: { needs: 'ask', wants: 'ask' } } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.answerLeftover('leftover:p1:wants', 'roll-over', '2026-10-09');
    b.moveMoney({ from: 'wants', to: 'savings', amount: 30_000 }, '2026-10-15');
    expect(b.pots()).toMatchObject({ wants: 50_000, savings: 100_000 + 125_000 + 30_000 });
  });

  it('13.3 every move is kept, even after old leftover questions are replaced (found in code review)', () => {
    const b = book({ pots: { needs: 10_000, wants: 10_000 }, settings: { leftoverAtPayday: { needs: 'ask', wants: 'ask' } } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.moveMoney({ from: 'wants', to: 'needs', amount: 100 }, '2026-10-10');
    b.changeSettings(ROLL, '2026-10-11');
    b.receive(paycheck('p2', '2026-10-23', 400_000));
    b.moveMoney({ from: 'wants', to: 'needs', amount: 200 }, '2026-10-24');
    expect(b.recountPots()).toEqual(b.pots());
    expect(b.pots()).toMatchObject({ needs: 10_000 + 75_000 * 2 + 300, wants: 10_000 + 50_000 * 2 - 300 });
  });

  it('13.3 the amount must be more than zero in whole cents, between two different buckets', () => {
    const b = book();
    expect(codeOf(() => b.moveMoney({ from: 'wants', to: 'needs', amount: 0 }, '2026-10-05'))).toBe('not-positive');
    expect(codeOf(() => b.moveMoney({ from: 'wants', to: 'needs', amount: 1.5 }, '2026-10-05'))).toBe('not-cents');
    expect(codeOf(() => b.moveMoney({ from: 'wants', to: 'wants', amount: 1 }, '2026-10-05'))).toBe('bad-move');
    expect(codeOf(() => b.moveMoney({ from: 'unsortedIn' as never, to: 'wants', amount: 1 }, '2026-10-05'))).toBe('bad-move');
    expect(codeOf(() => b.moveMoney({ from: 'wants', to: 'checking' as never, amount: 1 }, '2026-10-05'))).toBe('bad-move');
    expect(b.pots()).toMatchObject({ wants: 30_000, needs: 50_000 });
  });
});

describe('13.4 moving money out of savings or the mom reserve asks you to confirm first', () => {
  it('13.4 out of savings without confirming: it asks, and nothing moves', () => {
    const b = book();
    expect(b.moveMoney({ from: 'savings', to: 'needs', amount: 1 }, '2026-10-05')).toEqual({ moved: false, needsConfirmation: true, reasons: ['out-of-savings'] });
    expect(b.pots()).toMatchObject({ savings: 100_000, needs: 50_000 });
    expect(b.changeLog()).toEqual([]);
  });

  it('13.4 out of savings once confirmed: it moves', () => {
    const b = book();
    expect(b.moveMoney({ from: 'savings', to: 'needs', amount: 1, confirmed: true }, '2026-10-05')).toEqual({ moved: true });
    expect(b.pots()).toMatchObject({ savings: 99_999, needs: 50_001 });
  });

  it('13.4 out of the mom reserve asks too', () => {
    const b = book({ pots: { momReserve: 10_000 } });
    expect(b.moveMoney({ from: 'momReserve', to: 'wants', amount: 10_000 }, '2026-10-05')).toEqual({ moved: false, needsConfirmation: true, reasons: ['out-of-mom-reserve'] });
    expect(b.moveMoney({ from: 'momReserve', to: 'wants', amount: 10_000, confirmed: true }, '2026-10-05')).toEqual({ moved: true });
    expect(b.pots()).toMatchObject({ momReserve: 0, wants: 10_000 });
  });

  it('13.4 a move that would take a bucket below zero asks first, and nothing moves', () => {
    const b = book();
    expect(b.moveMoney({ from: 'wants', to: 'needs', amount: 30_001 }, '2026-10-05')).toEqual({ moved: false, needsConfirmation: true, reasons: ['below-zero'] });
    expect(b.pots()).toMatchObject({ wants: 30_000, needs: 50_000 });
    expect(b.changeLog()).toEqual([]);
  });

  it('13.4 a move that leaves exactly zero asks nothing', () => {
    const b = book();
    expect(b.moveMoney({ from: 'wants', to: 'needs', amount: 30_000 }, '2026-10-05')).toEqual({ moved: true });
    expect(b.pots().wants).toBe(0);
  });

  it('13.4 a bucket already below zero asks again before more comes out', () => {
    const b = book({ pots: { needs: 50_000, wants: -100 } });
    expect(b.moveMoney({ from: 'wants', to: 'needs', amount: 1 }, '2026-10-05')).toMatchObject({ moved: false, reasons: ['below-zero'] });
  });

  it('13.4 moving into a bucket that is below zero asks nothing', () => {
    const b = book({ pots: { needs: 50_000, wants: -100 } });
    expect(b.moveMoney({ from: 'needs', to: 'wants', amount: 1 }, '2026-10-05')).toEqual({ moved: true });
  });

  it('13.4 taking savings below zero gives both reasons; held for others counts as a bucket too', () => {
    const b = book();
    expect(b.moveMoney({ from: 'savings', to: 'needs', amount: 100_001 }, '2026-10-05')).toMatchObject({ reasons: ['out-of-savings', 'below-zero'] });
    expect(b.moveMoney({ from: 'heldForOthers', to: 'needs', amount: 1 }, '2026-10-05')).toMatchObject({ reasons: ['below-zero'] });
    expect(b.moveMoney({ from: 'savings', to: 'needs', amount: 100_001, confirmed: true }, '2026-10-05')).toEqual({ moved: true });
    expect(b.pots().savings).toBe(-1);
  });

  it('13.4 moving into savings, or between needs and wants, asks nothing', () => {
    const b = book();
    expect(b.moveMoney({ from: 'needs', to: 'savings', amount: 1 }, '2026-10-05')).toEqual({ moved: true });
    expect(b.moveMoney({ from: 'needs', to: 'momReserve', amount: 1 }, '2026-10-05')).toEqual({ moved: true });
  });
});

describe('13.5 every change and every manual move is logged with the date', () => {
  it('13.5 settings changes, rule changes, and moves, in order, with their dates', () => {
    const b = book();
    b.changeSettings({ payScheduleDays: 7 }, '2026-10-05');
    b.addRule({ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }, '2026-10-06');
    b.changeRule({ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'wants' }, '2026-10-07');
    b.removeRule('grocer', '2026-10-08');
    b.moveMoney({ from: 'wants', to: 'needs', amount: 500 }, '2026-10-09');
    b.moveMoney({ from: 'savings', to: 'needs', amount: 700 }, '2026-10-10');
    b.moveMoney({ from: 'savings', to: 'needs', amount: 700, confirmed: true }, '2026-10-10');
    expect(b.changeLog()).toEqual([
      { date: '2026-10-05', kind: 'settings-changed', changes: { payScheduleDays: 7 } },
      { date: '2026-10-06', kind: 'rule-added', rule: { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' } },
      {
        date: '2026-10-07',
        kind: 'rule-changed',
        before: { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
        after: { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'wants' },
      },
      { date: '2026-10-08', kind: 'rule-removed', rule: { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'wants' } },
      { date: '2026-10-09', kind: 'money-moved', from: 'wants', to: 'needs', amount: 500 },
      { date: '2026-10-10', kind: 'money-moved', from: 'savings', to: 'needs', amount: 700 },
    ]);
  });

  it('13.5 the log cannot be changed from outside', () => {
    const b = book();
    b.moveMoney({ from: 'wants', to: 'needs', amount: 500 }, '2026-10-09');
    const log = b.changeLog() as unknown[];
    log.pop();
    expect(b.changeLog()).toHaveLength(1);
  });
});

describe('13.6 a rule made from a correction beats the rule it corrects', () => {
  const GROCER = { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' } as const;

  it('13.6 correct a purchase a rule sorted, with "always do this": the fix sticks for the next one', () => {
    const b = book({ rules: [GROCER] });
    b.receive(purchase('e1', '2026-10-05', 4_000, 'MADE UP GROCER CAFE'));
    expect(b.purchases()[0]?.sortedTo).toEqual({ to: 'needs' });
    expect(b.sortAlways('e1', { to: 'wants' }, { id: 'grocer-cafe', contains: 'GROCER CAFE' }, '2026-10-06')).toEqual({ sticks: true });
    expect(b.purchases()[0]?.sortedTo).toEqual({ to: 'wants' });
    expect(b.rules().map((r) => r.id)).toEqual(['grocer-cafe', 'grocer']);
    b.receive(purchase('e2', '2026-10-07', 1_000, 'MADE UP GROCER CAFE'));
    b.receive(purchase('e3', '2026-10-07', 1_000, 'MADE UP GROCER'));
    expect(b.purchases().map((p) => p.sortedTo)).toEqual([{ to: 'wants' }, { to: 'wants' }, { to: 'needs' }]);
    expect(b.pots()).toMatchObject({ needs: 49_000, wants: 25_000 });
  });

  it('13.6 it goes just ahead of the rule it corrects, not to the top', () => {
    const b = book({
      rules: [{ id: 'hardware', for: 'purchase', contains: 'HARDWARE', bucket: 'needs' }, GROCER, { id: 'store', for: 'purchase', contains: 'STORE', bucket: 'wants' }],
    });
    b.receive(purchase('e1', '2026-10-05', 4_000, 'MADE UP GROCER STORE'));
    b.sortAlways('e1', { to: 'wants' }, { id: 'fix', contains: 'GROCER STORE' }, '2026-10-06');
    expect(b.rules().map((r) => r.id)).toEqual(['hardware', 'fix', 'grocer', 'store']);
  });

  it('13.6 it still beats the rule after you had already re-sorted the purchase by hand', () => {
    const b = book({ rules: [GROCER] });
    b.receive(purchase('e1', '2026-10-05', 4_000, 'MADE UP GROCER CAFE'));
    b.sort('e1', { to: 'wants' }, '2026-10-05');
    b.sortAlways('e1', { to: 'wants' }, { id: 'fix', contains: 'GROCER CAFE' }, '2026-10-06');
    expect(b.rules().map((r) => r.id)).toEqual(['fix', 'grocer']);
  });

  it('13.6 when no rule had sorted it, the new rule goes to the end of the list', () => {
    const b = book({ rules: [GROCER] });
    b.receive(purchase('e1', '2026-10-05', 4_000, 'MADE UP HARDWARE'));
    b.sortAlways('e1', { to: 'needs' }, { id: 'hardware', contains: 'HARDWARE' }, '2026-10-06');
    expect(b.rules().map((r) => r.id)).toEqual(['grocer', 'hardware']);
    expect(b.pots()).toMatchObject({ needs: 46_000, unsortedOut: 0 });
  });

  it('13.6 it works for payments to people and for deposits', () => {
    const b = book({
      rules: [
        { id: 'friend', for: 'person', contains: 'FRIEND', choice: { to: 'wants' } },
        { id: 'made-up', for: 'deposit', contains: 'MADE UP', choice: { to: 'savings' } },
      ],
    });
    b.receive(payPerson('z1', '2026-10-05', 2_000, 'MADE UP FRIEND'));
    b.sortAlways('z1', { to: 'not-mine' }, { id: 'friend-fix', contains: 'MADE UP FRIEND' }, '2026-10-06');
    b.receive(payPerson('z2', '2026-10-07', 1_000, 'MADE UP FRIEND'));
    b.receive(deposit('d1', '2026-10-05', 3_000, 'MADE UP REIMBURSEMENT'));
    b.sortAlways('d1', { to: 'wants' }, { id: 'reimburse', contains: 'REIMBURSEMENT' }, '2026-10-06');
    b.receive(deposit('d2', '2026-10-07', 500, 'MADE UP REIMBURSEMENT'));
    expect(b.rules().map((r) => r.id)).toEqual(['friend-fix', 'friend', 'reimburse', 'made-up']);
    expect(b.pots()).toMatchObject({ heldForOthers: -3_000, wants: 33_500, savings: 100_000 });
  });

  // Banks often change a purchase's description when it posts (found in review).
  const CAFE = { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' } as const;
  function cafeVisit() {
    const b = book({ rules: [CAFE] });
    b.receive(purchase('e1', '2026-10-05', 1_250, 'SQ *JOES CAFE', { pending: true }));
    b.receive(posted('e1p', 'e1', '2026-10-07', 1_250, 'JOES COFFEE LLC'));
    return b;
  }

  it('13.6 the bank changed the description when it posted: the new rule still goes ahead of the rule that sorted it', () => {
    const b = cafeVisit();
    expect(b.sortAlways('e1', { to: 'needs' }, { id: 'joes', contains: 'JOES' }, '2026-10-08')).toEqual({ sticks: true });
    expect(b.rules().map((r) => r.id)).toEqual(['joes', 'cafe']);
    b.receive(purchase('e2', '2026-10-12', 1_400, 'SQ *JOES CAFE', { pending: true }));
    expect(b.purchases().find((p) => p.id === 'e2')?.sortedTo).toEqual({ to: 'needs' });
    expect(b.changeLog().at(-1)).toMatchObject({ aheadOf: 'cafe' });
  });

  it('13.6 text that matches only how it showed up while pending is accepted', () => {
    const b = cafeVisit();
    expect(b.sortAlways('e1', { to: 'needs' }, { id: 'joes', contains: 'SQ *JOES' }, '2026-10-08')).toEqual({ sticks: true });
    expect(b.purchases()[0]?.sortedTo).toEqual({ to: 'needs' });
  });

  it('13.6 text that matches only the posted description is accepted, but it says it will not catch the next pending one', () => {
    const b = cafeVisit();
    expect(b.sortAlways('e1', { to: 'needs' }, { id: 'joes', contains: 'COFFEE LLC' }, '2026-10-08')).toEqual({ sticks: false });
    expect(b.rules().map((r) => r.id)).toEqual(['joes', 'cafe']);
    b.receive(purchase('e3', '2026-10-12', 1_400, 'JOES COFFEE LLC'));
    expect(b.purchases().find((p) => p.id === 'e3')?.sortedTo).toEqual({ to: 'needs' });
  });

  it('13.6 the new rule must cover the item it corrects; otherwise nothing changes', () => {
    const b = book({ rules: [GROCER] });
    b.receive(purchase('e1', '2026-10-05', 4_000, 'MADE UP GROCER CAFE'));
    expect(codeOf(() => b.sortAlways('e1', { to: 'wants' }, { id: 'fix', contains: 'PHARMACY' }, '2026-10-06'))).toBe('bad-rule');
    expect(b.purchases()[0]?.sortedTo).toEqual({ to: 'needs' });
    expect(b.rules().map((r) => r.id)).toEqual(['grocer']);
    expect(b.changeLog()).toEqual([]);
  });

  it('13.6 a rule id already in use is refused and nothing changes', () => {
    const b = book({ rules: [GROCER] });
    b.receive(purchase('e1', '2026-10-05', 4_000, 'MADE UP GROCER CAFE'));
    expect(codeOf(() => b.sortAlways('e1', { to: 'wants' }, { id: 'grocer', contains: 'GROCER CAFE' }, '2026-10-06'))).toBe('bad-rule');
    expect(b.purchases()[0]?.sortedTo).toEqual({ to: 'needs' });
  });

  it('13.6 a rule cannot split, and some things cannot get a rule at all', () => {
    const b = book({ rules: [GROCER], lastPaycheckDate: '2026-10-01' });
    b.receive(purchase('e1', '2026-10-05', 4_000, 'MADE UP GROCER CAFE'));
    const split = { split: [{ bucket: 'needs' as const, amount: 2_000 }, { bucket: 'wants' as const, amount: 2_000 }] };
    expect(codeOf(() => b.sortAlways('e1', split, { id: 'fix', contains: 'GROCER' }, '2026-10-06'))).toBe('bad-choice');
    b.receive(cardCharge('f1', '2026-10-05', 2_900, 'fee'));
    expect(codeOf(() => b.sortAlways('f1', { to: 'needs' }, { id: 'fee', contains: 'FEE' }, '2026-10-06'))).toBe('no-rule-for-this');
    b.receive(paycheck('p1', '2026-10-05', 400_000));
    expect(codeOf(() => b.sortAlways('p1', { to: 'income' }, { id: 'pay', contains: 'PAYROLL' }, '2026-10-06'))).toBe('no-rule-for-this');
    b.receive(refund('r1', '2026-10-05', 500));
    expect(codeOf(() => b.sortAlways('r1', { to: 'wants' }, { id: 'refund', contains: 'REFUND' }, '2026-10-06'))).toBe('no-rule-for-this');
    expect(codeOf(() => b.sortAlways('nope', { to: 'wants' }, { id: 'x', contains: 'X' }, '2026-10-06'))).toBe('unknown-item');
    expect(b.rules().map((r) => r.id)).toEqual(['grocer']);
  });

  it('13.6 it also sorts matching items waiting in review, and leaves sorted ones put (13.2)', () => {
    const b = book({ rules: [GROCER] });
    b.receive(purchase('e0', '2026-10-04', 1_000, 'MADE UP HARDWARE OLD'));
    b.sort('e0', { to: 'needs' }, '2026-10-04');
    b.receive(purchase('e1', '2026-10-05', 4_000, 'MADE UP HARDWARE'));
    b.receive(purchase('e2', '2026-10-05', 2_000, 'MADE UP HARDWARE #2'));
    b.sortAlways('e1', { to: 'wants' }, { id: 'hardware', contains: 'HARDWARE' }, '2026-10-06');
    expect(b.purchases().map((p) => p.sortedTo)).toEqual([{ to: 'needs' }, { to: 'wants' }, { to: 'wants' }]);
  });

  it('13.6 it is logged with the item it corrects and the rule it beats', () => {
    const b = book({ rules: [GROCER] });
    b.receive(purchase('e1', '2026-10-05', 4_000, 'MADE UP GROCER CAFE'));
    b.receive(purchase('e2', '2026-10-05', 4_000, 'MADE UP HARDWARE'));
    b.sortAlways('e1', { to: 'wants' }, { id: 'fix', contains: 'GROCER CAFE' }, '2026-10-06');
    b.sortAlways('e2', { to: 'needs' }, { id: 'hardware', contains: 'HARDWARE' }, '2026-10-07');
    expect(b.changeLog()).toEqual([
      { date: '2026-10-06', kind: 'rule-added-from-correction', rule: { id: 'fix', for: 'purchase', contains: 'GROCER CAFE', bucket: 'wants' }, correcting: 'e1', aheadOf: 'grocer' },
      { date: '2026-10-07', kind: 'rule-added-from-correction', rule: { id: 'hardware', for: 'purchase', contains: 'HARDWARE', bucket: 'needs' }, correcting: 'e2', aheadOf: null },
    ]);
  });
});
