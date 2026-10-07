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

  it('13.1 other income sorted before the next paycheck still uses this pay period\'s split', () => {
    const b = book();
    b.changeSettings({ split: { savings: 0, needs: 0, wants: 100 }, momReservePerPaycheck: 0 }, '2026-10-05');
    b.receive(deposit('d1', '2026-10-06', 400_000, 'MADE UP BONUS'));
    b.sort('d1', { to: 'other-income' }, '2026-10-06');
    expect(b.pots()).toMatchObject({ momReserve: 0, savings: 300_000, needs: 170_000, wants: 110_000 });
  });

  it('13.1 other income sorted after the next paycheck uses the new split', () => {
    const b = book();
    b.changeSettings({ split: { savings: 0, needs: 0, wants: 100 }, momReservePerPaycheck: 0 }, '2026-10-05');
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(deposit('d1', '2026-10-10', 1_000, 'MADE UP BONUS'));
    b.sort('d1', { to: 'other-income' }, '2026-10-10');
    expect(b.pots()).toMatchObject({ wants: 30_000 + 400_000 + 1_000 });
  });

  it('13.1 a deposit you call your paycheck is the next paycheck, so it uses the new split and reserve', () => {
    const b = book();
    b.changeSettings({ split: { savings: 0, needs: 0, wants: 100 }, momReservePerPaycheck: 100_000 }, '2026-10-05');
    b.receive(deposit('d1', '2026-10-06', 400_000, 'MADE UP NEW JOB'));
    b.sort('d1', { to: 'paycheck' }, '2026-10-06');
    expect(b.pots()).toMatchObject({ momReserve: 100_000, savings: 100_000, needs: 50_000, wants: 30_000 + 300_000 });
    // And other income after it uses the new split too.
    b.receive(deposit('d2', '2026-10-07', 1_000, 'MADE UP BONUS'));
    b.sort('d2', { to: 'other-income' }, '2026-10-07');
    expect(b.pots()).toMatchObject({ momReserve: 100_000, wants: 30_000 + 300_000 + 1_000 });
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

  function waitingToSplitAgain() {
    // A grocery run split by hand, then partly refunded: back in review to be
    // split again (A1). An older rule matches it, but it is his to decide.
    const b = book({ rules: [{ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' }] });
    b.receive(purchase('e1', '2026-10-05', 12_000, 'MADE UP GROCER'));
    b.sort('e1', { split: [{ bucket: 'needs', amount: 10_000 }, { bucket: 'wants', amount: 2_000 }] }, '2026-10-05');
    b.receive(refund('r1', '2026-10-06', 2_000, 'e1'));
    b.receive(purchase('e2', '2026-10-06', 3_000, 'MADE UP HARDWARE'));
    return b;
  }

  it('13.2 a new rule sorts only what it is the first match for: an older rule does not sneak in (found in review)', () => {
    const b = waitingToSplitAgain();
    b.addRule({ id: 'hardware', for: 'purchase', contains: 'HARDWARE', bucket: 'needs' }, '2026-10-07');
    expect(b.reviewItems().map((i) => i.id)).toEqual(['e1']);
    expect(b.pots().unsortedOut).toBe(10_000);
  });

  it('13.2 a correction on another item leaves a purchase waiting to be split again alone (found in review)', () => {
    const b = waitingToSplitAgain();
    b.sortAlways('e2', { to: 'needs' }, { id: 'hardware', contains: 'HARDWARE' }, '2026-10-07');
    expect(b.reviewItems().map((i) => i.id)).toEqual(['e1']);
  });

  it('13.2 a changed rule sorts a waiting item it is now the first match for', () => {
    const b = waitingToSplitAgain();
    b.changeRule({ id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'wants' }, '2026-10-07');
    expect(b.reviewItems().map((i) => i.id)).toEqual(['e2']);
    expect(b.purchases()[0]?.sortedTo).toEqual({ to: 'wants' });
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

  it('13.6 "always do this" can make a deposit other income, but cannot say it is your paycheck', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-05', 3_000, 'MADE UP NEW JOB'));
    const before = { pots: b.pots(), review: b.reviewItems() };
    expect(codeOf(() => b.sortAlways('d1', { to: 'paycheck' }, { id: 'job', contains: 'NEW JOB' }, '2026-10-06'))).toBe('bad-choice');
    expect({ pots: b.pots(), review: b.reviewItems(), rules: b.rules(), log: b.changeLog() }).toEqual({ ...before, rules: [], log: [] });
    b.sortAlways('d1', { to: 'other-income' }, { id: 'job', contains: 'NEW JOB' }, '2026-10-06');
    b.receive(deposit('d2', '2026-10-07', 1_000, 'MADE UP NEW JOB'));
    expect(b.pots()).toMatchObject({ savings: 100_000 + 1_500 + 500, needs: 50_000 + 900 + 300, wants: 30_000 + 600 + 200, unsortedIn: 0 });
  });

  it('13.6 for a payment to a person, "always do this" picks needs, wants, or not mine, and nothing else', () => {
    const b = book();
    b.receive(payPerson('z1', '2026-10-05', 2_000, 'MADE UP FRIEND'));
    const before = { pots: b.pots(), review: b.reviewItems() };
    for (const choice of [{ to: 'savings' }, { to: 'other-income' }, { split: [{ bucket: 'needs', amount: 2_000 }] }]) {
      expect(codeOf(() => b.sortAlways('z1', choice as never, { id: 'friend', contains: 'FRIEND' }, '2026-10-06')), JSON.stringify(choice)).toBe('bad-choice');
    }
    expect({ pots: b.pots(), review: b.reviewItems(), rules: b.rules() }).toEqual({ ...before, rules: [] });
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
    expect(codeOf(() => b.sortAlways('p1', { to: 'other-income' }, { id: 'pay', contains: 'PAYROLL' }, '2026-10-06'))).toBe('no-rule-for-this');
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

describe('13.2 setting the paycheck rule or the mom rule checks what is waiting (QUESTIONS.md A9)', () => {
  const noRules = { ...ROLL, paycheckRule: null, momRule: null };

  it('13.2 a waiting deposit that matches the new paycheck rule becomes a paycheck, from its own date (3.1)', () => {
    const b = book({ settings: noRules });
    expect(b.receive(paycheck('p1', '2026-10-09', 400_000)).outcome).toBe('review');
    expect(b.pots().unsortedIn).toBe(400_000);
    const logged = b.changeLog().length;
    b.changeSettings({ paycheckRule: { contains: 'ACME PAYROLL' } }, '2026-10-12');
    expect(b.paychecks()).toMatchObject([{ id: 'p1', date: '2026-10-09', amount: 400_000 }]);
    expect(b.lastPaycheckDate()).toBe('2026-10-09');
    // Reserve 1,500.00 first, then the other 2,500.00 split 50/30/20.
    expect(b.pots()).toMatchObject({ unsortedIn: 0, momReserve: 150_000, savings: 225_000, needs: 125_000, wants: 80_000 });
    expect(b.reviewItems()).toEqual([]);
    expect(b.changeLog().length).toBe(logged + 1);
  });

  it('13.2 the 10-day check still applies: a second match less than 10 days later waits as an early paycheck (3.7)', () => {
    const b = book({ settings: noRules });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(deposit('p2', '2026-10-13', 50_000, 'ACME PAYROLL BONUS'));
    b.changeSettings({ paycheckRule: { contains: 'ACME PAYROLL' } }, '2026-10-14');
    expect(b.paychecks().map((p) => p.id)).toEqual(['p1']);
    expect(b.reviewItems()).toMatchObject([{ type: 'money-in', id: 'p2', reason: 'early-paycheck' }]);
  });

  it('13.2 a match older than the last paycheck stays waiting as an early paycheck (B54)', () => {
    const b = book({ settings: noRules });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.sort('p1', { to: 'paycheck' }, '2026-10-09');
    b.receive(deposit('x1', '2026-10-05', 12_000, 'ACME PAYROLL EXPENSES'));
    b.changeSettings({ paycheckRule: { contains: 'ACME PAYROLL' } }, '2026-10-10');
    expect(b.paychecks().map((p) => p.id)).toEqual(['p1']);
    expect(b.reviewItems()).toMatchObject([{ type: 'money-in', id: 'x1', reason: 'early-paycheck' }]);
  });

  it('13.2 a deposit already sorted stays as it is', () => {
    const b = book({ settings: noRules });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.sort('p1', { to: 'other-income' }, '2026-10-09');
    const before = b.pots();
    b.changeSettings({ paycheckRule: { contains: 'ACME PAYROLL' } }, '2026-10-12');
    expect(b.paychecks()).toEqual([]);
    expect(b.pots()).toEqual(before);
  });

  it('13.2 a waiting payment that matches the new mom rule comes out of the mom reserve (8.1)', () => {
    const b = book({ settings: noRules, pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 100_000, heldForOthers: 0 } });
    b.receive(payPerson('m1', '2026-10-05', 60_000, 'Made Up Mom'));
    expect(b.pots().unsortedOut).toBe(60_000);
    b.changeSettings({ momRule: { contains: 'Made Up Mom' } }, '2026-10-06');
    expect(b.pots()).toMatchObject({ momReserve: 40_000, unsortedOut: 0 });
    expect(b.reviewItems()).toEqual([]);
    expect(b.momSentInMonth('2026-10').sent).toBe(60_000);
  });

  it('13.2 when the reserve is short, the difference waits in review (8.3)', () => {
    const b = book({ settings: noRules, pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 20_000, heldForOthers: 0 } });
    b.receive(payPerson('m1', '2026-10-05', 60_000, 'Made Up Mom'));
    b.changeSettings({ momRule: { contains: 'Made Up Mom' } }, '2026-10-06');
    expect(b.pots()).toMatchObject({ momReserve: 0, unsortedOut: 40_000 });
    expect(b.reviewItems()).toMatchObject([{ type: 'spending', reason: 'mom-difference', amount: 40_000 }]);
  });

  it('13.2 a re-check that is refused changes nothing, the setting included (0.1)', () => {
    // A savings bucket so full that the paycheck's share would not stay
    // exact (needs and wants below zero keep the starting total exact).
    const huge = Number.MAX_SAFE_INTEGER - 1_000;
    const b = book({ settings: noRules, pots: { savings: huge, needs: -50_000, wants: -30_000, momReserve: 0, heldForOthers: 0 } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const before = { pots: b.pots(), log: b.changeLog().length, review: b.reviewItems() };
    expect(codeOf(() => b.changeSettings({ paycheckRule: { contains: 'ACME PAYROLL' } }, '2026-10-12'))).toBe('not-cents');
    expect(b.settings().paycheckRule).toBeNull();
    expect(b.pots()).toEqual(before.pots);
    expect(b.changeLog().length).toBe(before.log);
    expect(b.reviewItems()).toEqual(before.review);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('13.2 a payment already sorted stays as it is', () => {
    const b = book({ settings: noRules, pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 100_000, heldForOthers: 0 } });
    b.receive(payPerson('m1', '2026-10-05', 60_000, 'Made Up Mom'));
    b.sort('m1', { to: 'needs' }, '2026-10-05');
    const before = b.pots();
    b.changeSettings({ momRule: { contains: 'Made Up Mom' } }, '2026-10-06');
    expect(b.pots()).toEqual(before);
  });
});
