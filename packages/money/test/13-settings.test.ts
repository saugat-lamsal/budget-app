import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FROM_NEXT_PAYCHECK, MOVABLE_POTS, RULE_CHOICES, addDays, checkRules, type Book, type Settings, type SortingRule } from '../src/index.js';
import { MOM_NAME, PAYROLL, appSide, codeOf, deposit, openTestBook, payPerson, paycheck, purchase, takenBack, type TestBookOptions } from './helpers.js';

// What the Settings screen needs from the money math (Phase 4): what is in
// force this pay period next to the settings (13.1), the change log with what
// each setting was before (13.5), what setting the paycheck rule or the mom
// rule would do before it is done (13.2, QUESTIONS.md A9), and what each kind
// of sorting rule can pick (4.2, 6.2, 7.4).

const ROLL = { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } } as const;

function book(options: TestBookOptions = {}): Book {
  return openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 0, heldForOthers: 0 }, settings: ROLL, ...options });
}

// Everything the book can say about itself, to show that something changed nothing.
function everything(b: Book): unknown {
  return {
    pots: b.pots(),
    recount: b.recountPots(),
    debt: b.oldCardDebt(),
    review: b.reviewItems(),
    details: b.reviewDetails(),
    log: b.changeLog(),
    settings: b.settings(),
    inForce: b.splitInForce(),
    rules: b.rules(),
    period: b.period(),
    started: b.startedPeriodWith(),
    lastPaycheck: b.lastPaycheckDate(),
    paychecks: b.paychecks(),
    purchases: b.purchases(),
    activity: MOVABLE_POTS.map((pot) => b.activity(pot)),
    summary: b.periodSummary(),
    payday: b.paydayReport(),
    mom: b.momSentInMonth('2026-10'),
    inTransit: b.inTransit(),
  };
}

const START_SPLIT = { split: { savings: 50, needs: 30, wants: 20 }, momReservePerPaycheck: 150_000, momReserveCap: 300_000 };

describe('13.1 what is in force this pay period, next to the settings', () => {
  it('13.1 on setup day the split and mom reserve in force are the starting ones', () => {
    expect(book().splitInForce()).toEqual(START_SPLIT);
  });

  it('13.1 a change to the split is the setting now, but this pay period keeps what it started with', () => {
    const b = book();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.changeSettings({ split: { savings: 40, needs: 40, wants: 20 } }, '2026-10-12');
    expect(b.settings().split).toEqual({ savings: 40, needs: 40, wants: 20 });
    expect(b.splitInForce()).toEqual(START_SPLIT);
  });

  it('13.1 the next paycheck puts the change in force', () => {
    const b = book();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.changeSettings({ split: { savings: 40, needs: 40, wants: 20 }, momReservePerPaycheck: 100_000, momReserveCap: 250_000 }, '2026-10-12');
    b.receive(paycheck('p2', '2026-10-23', 400_000));
    expect(b.splitInForce()).toEqual({ split: { savings: 40, needs: 40, wants: 20 }, momReservePerPaycheck: 100_000, momReserveCap: 250_000 });
    expect(b.paychecks()[1]?.split).toMatchObject({ momReserve: 100_000, needs: 120_000, wants: 60_000, savings: 120_000 });
  });

  it('13.1 the mom reserve per paycheck and its cap wait for the next paycheck too, each on its own', () => {
    const b = book();
    b.changeSettings({ momReserveCap: 0 }, '2026-10-05');
    expect(b.splitInForce().momReserveCap).toBe(300_000);
    b.changeSettings({ momReservePerPaycheck: 1 }, '2026-10-06');
    expect(b.splitInForce()).toEqual(START_SPLIT);
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(b.splitInForce()).toMatchObject({ momReservePerPaycheck: 1, momReserveCap: 0 });
  });

  it('13.1 B38 every other setting is in force right away, and does not touch what is in force for the split', () => {
    const b = book();
    b.changeSettings({ payScheduleDays: 7, earlyPaycheckDays: 3, lowBucketAlertPercent: 0, momMonthlyTarget: { low: 0, high: 1 } }, '2026-10-05');
    expect(b.splitInForce()).toEqual(START_SPLIT);
    expect(b.safeToSpend('2026-10-05').nextPayday).toBe('2026-10-02');
  });

  it('13.1 the settings that wait for the next paycheck are exactly the ones in force for the pay period (B38)', () => {
    expect([...FROM_NEXT_PAYCHECK].sort()).toEqual(Object.keys(book().splitInForce()).sort());
    expect(FROM_NEXT_PAYCHECK).toEqual(['split', 'momReservePerPaycheck', 'momReserveCap']);
  });

  it('13.1 6.1 "this is my paycheck" starts a pay period, so it puts the change in force', () => {
    const b = book();
    b.changeSettings({ split: { savings: 0, needs: 100, wants: 0 } }, '2026-10-05');
    b.receive(deposit('d1', '2026-10-06', 400_000, 'MADE UP NEW JOB'));
    expect(b.splitInForce()).toEqual(START_SPLIT);
    b.sort('d1', { to: 'paycheck' }, '2026-10-07');
    expect(b.splitInForce().split).toEqual({ savings: 0, needs: 100, wants: 0 });
  });

  it('13.1 3.7 an early paycheck waiting in review puts nothing in force', () => {
    const b = book({ lastPaycheckDate: '2026-10-01' });
    b.changeSettings({ split: { savings: 0, needs: 100, wants: 0 } }, '2026-10-02');
    b.receive(paycheck('p1', '2026-10-10', 400_000));
    expect(b.reviewItems().map((i) => i.id)).toEqual(['p1']);
    expect(b.splitInForce()).toEqual(START_SPLIT);
  });

  it('13.1 6.1 other income uses what is in force, not the setting', () => {
    const b = book();
    b.changeSettings({ split: { savings: 0, needs: 0, wants: 100 } }, '2026-10-05');
    b.receive(deposit('d1', '2026-10-06', 1_000, 'MADE UP BONUS'));
    b.sort('d1', { to: 'other-income' }, '2026-10-06');
    expect(b.pots()).toMatchObject({ savings: 100_500, needs: 50_300, wants: 30_200 });
  });

  it('13.1 B71 a paycheck the bank takes back keeps what it put in force, like its pay period', () => {
    const b = book();
    b.changeSettings({ split: { savings: 0, needs: 100, wants: 0 } }, '2026-10-05');
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(takenBack('t1', 'p1', '2026-10-10'));
    expect(b.splitInForce().split).toEqual({ savings: 0, needs: 100, wants: 0 });
    expect(b.period().number).toBe(1);
  });

  it('13.1 changed and changed back before payday: what is in force and the setting agree again', () => {
    const b = book();
    b.changeSettings({ split: { savings: 40, needs: 40, wants: 20 } }, '2026-10-05');
    b.changeSettings({ split: { savings: 50, needs: 30, wants: 20 } }, '2026-10-06');
    expect(b.splitInForce().split).toEqual(b.settings().split);
  });

  it('13.1 0.1 a paycheck refused as too large to stay exact puts nothing in force', () => {
    const b = book({ pots: { savings: Number.MAX_SAFE_INTEGER - 10 } });
    b.changeSettings({ split: { savings: 100, needs: 0, wants: 0 } }, '2026-10-05');
    expect(codeOf(() => b.receive(paycheck('p1', '2026-10-09', 400_000)))).toBe('not-cents');
    expect(b.splitInForce()).toEqual(START_SPLIT);
    expect(b.period().number).toBe(0);
  });

  it('13.1 what is in force cannot be changed from outside', () => {
    const b = book();
    const inForce = b.splitInForce();
    expect(Object.isFrozen(inForce)).toBe(true);
    expect(Object.isFrozen(inForce.split)).toBe(true);
    expect(() => {
      (inForce.split as { savings: number }).savings = 1;
    }).toThrow();
    expect(b.splitInForce()).toEqual(START_SPLIT);
  });
});

describe('13.5 a settings change is logged with what it was before', () => {
  it('13.5 the log keeps the old and the new value of each setting changed, with the date', () => {
    const b = book();
    b.changeSettings({ split: { savings: 40, needs: 40, wants: 20 }, momReserveCap: 250_000 }, '2026-10-05');
    b.changeSettings({ oldCardPromoEndDate: '2027-03-31' }, '2026-10-06');
    b.changeSettings({ oldCardPromoEndDate: null, paycheckRule: null }, '2026-10-07');
    expect(b.changeLog()).toEqual([
      {
        date: '2026-10-05',
        kind: 'settings-changed',
        changes: { split: { savings: 40, needs: 40, wants: 20 }, momReserveCap: 250_000 },
        before: { split: { savings: 50, needs: 30, wants: 20 }, momReserveCap: 300_000 },
      },
      { date: '2026-10-06', kind: 'settings-changed', changes: { oldCardPromoEndDate: '2027-03-31' }, before: { oldCardPromoEndDate: null } },
      { date: '2026-10-07', kind: 'settings-changed', changes: { oldCardPromoEndDate: null, paycheckRule: null }, before: { oldCardPromoEndDate: '2027-03-31', paycheckRule: { contains: PAYROLL } } },
    ]);
  });

  it('13.5 a refused change logs nothing and changes nothing', () => {
    const b = book();
    const before = everything(b);
    expect(codeOf(() => b.changeSettings({ split: { savings: 50, needs: 50, wants: 1 } }, '2026-10-05'))).toBe('bad-setting');
    expect(codeOf(() => b.changeSettings({ momReserveCap: -1 }, '2026-10-05'))).toBe('bad-setting');
    expect(everything(b)).toEqual(before);
  });

  it('13.5 what the log keeps cannot be changed from outside', () => {
    const b = book();
    b.changeSettings({ split: { savings: 40, needs: 40, wants: 20 } }, '2026-10-05');
    const entry = b.changeLog()[0];
    if (entry?.kind !== 'settings-changed') throw new Error('expected a settings change');
    expect(Object.isFrozen(entry.before)).toBe(true);
    expect(Object.isFrozen(entry.before.split)).toBe(true);
  });
});

describe('0.2 a split that does not add up to 100 is refused, and says what it adds up to', () => {
  it.each([
    [{ savings: 50, needs: 50, wants: 10 }, 110],
    [{ savings: 0, needs: 0, wants: 99 }, 99],
    [{ savings: 0, needs: 0, wants: 0 }, 0],
  ])('0.2 %o adds up to %i', (split, sum) => {
    const b = book();
    expect(() => b.changeSettings({ split }, '2026-10-05')).toThrow(`split must add up to 100, not ${sum}`);
  });

  it('0.2 a setting that does not exist is refused, and nothing is logged', () => {
    const b = book();
    expect(() => b.changeSettings({ split: { savings: 40, needs: 40, wants: 20 }, safeToSpend: 5 } as Partial<Settings>, '2026-10-05')).toThrow('there is no setting called safeToSpend');
    expect(codeOf(() => b.previewSettingsChange({ colour: 'blue' } as Partial<Settings>, '2026-10-05'))).toBe('bad-setting');
    expect(b.settings().split).toEqual({ savings: 50, needs: 30, wants: 20 });
    expect(b.changeLog()).toEqual([]);
  });

  it('0.2 exactly 100 is fine, even all in one bucket', () => {
    const b = book();
    b.changeSettings({ split: { savings: 0, needs: 0, wants: 100 } }, '2026-10-05');
    expect(b.settings().split.wants).toBe(100);
  });
});

describe('13.2 A9 what setting the paycheck rule or the mom rule would do, worked out before it is done', () => {
  // The first sync: no paycheck rule or mom rule yet, and things waiting in review.
  function firstSync(options: TestBookOptions = {}): Book {
    return book({ ...options, settings: { ...ROLL, paycheckRule: null, momRule: null, ...options.settings } });
  }

  it('13.2 A9 3.1 a waiting deposit the new paycheck rule matches would become a paycheck, with its split', () => {
    const b = firstSync();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const preview = b.previewSettingsChange({ paycheckRule: { contains: PAYROLL } }, '2026-10-10');
    expect(preview.items).toEqual([
      {
        kind: 'paycheck',
        id: 'p1',
        date: '2026-10-09',
        amount: 400_000,
        description: `${PAYROLL} DIRECT DEP`,
        split: {
          momReserve: 150_000,
          savings: 125_000,
          needs: 75_000,
          wants: 50_000,
          detail: { reserveTaken: 150_000, overflowToSavings: 0, rest: 250_000, savingsShare: 125_000, roundingToSavings: 0 },
        },
      },
    ]);
    expect(preview.potsBefore).toEqual(b.pots());
    expect(preview.potsAfter).toEqual({ ...b.pots(), unsortedIn: 0, momReserve: 150_000, savings: 225_000, needs: 125_000, wants: 80_000 });
    expect(preview.waitingBefore).toBe(1);
    expect(preview.waitingAfter).toBe(0);
  });

  it('13.2 A9 the preview changes nothing at all', () => {
    const b = firstSync();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(payPerson('z1', '2026-10-10', 20_000, MOM_NAME));
    const before = everything(b);
    b.previewSettingsChange({ paycheckRule: { contains: PAYROLL }, momRule: { contains: MOM_NAME } }, '2026-10-10');
    expect(everything(b)).toEqual(before);
    // And the change afterward still does all of it, once.
    b.changeSettings({ paycheckRule: { contains: PAYROLL }, momRule: { contains: MOM_NAME } }, '2026-10-10');
    expect(b.paychecks()).toHaveLength(1);
    expect(b.reviewItems()).toEqual([]);
  });

  it('13.2 A9 3.7 one 9 days after the last paycheck would still wait, now as an early paycheck', () => {
    const b = firstSync({ lastPaycheckDate: '2026-10-01' });
    b.receive(paycheck('p1', '2026-10-10', 400_000));
    const preview = b.previewSettingsChange({ paycheckRule: { contains: PAYROLL } }, '2026-10-10');
    expect(preview.items).toEqual([{ kind: 'early-paycheck', id: 'p1', date: '2026-10-10', amount: 400_000, description: `${PAYROLL} DIRECT DEP` }]);
    expect(preview.potsAfter).toEqual(preview.potsBefore);
    expect(preview.waitingAfter).toBe(1);
  });

  it('13.2 A9 3.7 exactly 10 days after the last paycheck is a paycheck', () => {
    const b = firstSync({ lastPaycheckDate: '2026-10-01' });
    b.receive(paycheck('p1', '2026-10-11', 400_000));
    expect(b.previewSettingsChange({ paycheckRule: { contains: PAYROLL } }, '2026-10-11').items.map((i) => i.kind)).toEqual(['paycheck']);
  });

  it('13.2 A9 B54 one older than the last paycheck would wait as an early paycheck', () => {
    const b = firstSync({ lastPaycheckDate: '2026-10-01' });
    b.receive(paycheck('p0', '2026-09-30', 400_000));
    expect(b.previewSettingsChange({ paycheckRule: { contains: PAYROLL } }, '2026-10-05').items.map((i) => i.kind)).toEqual(['early-paycheck']);
  });

  it('13.2 A9 two waiting, oldest first: the first becomes a paycheck, and the second, 9 days after it, waits', () => {
    const b = firstSync();
    b.receive(paycheck('p2', '2026-10-18', 400_000));
    b.receive(paycheck('p1', '2026-10-09', 300_000));
    const preview = b.previewSettingsChange({ paycheckRule: { contains: PAYROLL } }, '2026-10-19');
    expect(preview.items.map((i) => [i.id, i.kind])).toEqual([
      ['p1', 'paycheck'],
      ['p2', 'early-paycheck'],
    ]);
  });

  it('13.2 A9 a paycheck the rule finds asks the leftover questions (3.4), and the buckets after say what it does', () => {
    const b = firstSync({ settings: { leftoverAtPayday: { needs: 'ask', wants: 'move-to-savings' } } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const preview = b.previewSettingsChange({ paycheckRule: { contains: PAYROLL } }, '2026-10-10');
    // Wants' 300.00 moves to savings by the setting; needs' 500.00 waits to be asked about.
    expect(preview.potsAfter).toMatchObject({ savings: 100_000 + 125_000 + 30_000, needs: 50_000 + 75_000, wants: 50_000, unsortedIn: 0 });
    expect(preview.waitingAfter).toBe(1);
  });

  it('13.2 A9 8.1 a waiting payment the new mom rule matches would come out of the mom reserve', () => {
    const b = firstSync({ pots: { momReserve: 50_000 } });
    b.receive(payPerson('z1', '2026-10-06', 20_000, MOM_NAME));
    const preview = b.previewSettingsChange({ momRule: { contains: MOM_NAME } }, '2026-10-07');
    expect(preview.items).toEqual([{ kind: 'mom', id: 'z1', date: '2026-10-06', amount: 20_000, description: `ZELLE TO ${MOM_NAME}`, fromReserve: 20_000, difference: 0 }]);
    expect(preview.potsAfter).toMatchObject({ momReserve: 30_000, unsortedOut: 0 });
    expect(preview.waitingAfter).toBe(0);
  });

  it('13.2 A9 8.3 what the reserve cannot cover would wait in review, to the cent', () => {
    const b = firstSync({ pots: { momReserve: 19_999 } });
    b.receive(payPerson('z1', '2026-10-06', 20_000, MOM_NAME));
    const preview = b.previewSettingsChange({ momRule: { contains: MOM_NAME } }, '2026-10-07');
    expect(preview.items).toMatchObject([{ kind: 'mom', fromReserve: 19_999, difference: 1 }]);
    expect(preview.potsAfter).toMatchObject({ momReserve: 0, unsortedOut: 1 });
    expect(preview.waitingAfter).toBe(1);
  });

  it('13.2 A9 8.3 B27 a reserve at zero or below covers nothing: all of it would wait', () => {
    const b = firstSync({ pots: { momReserve: -500 } });
    b.receive(payPerson('z1', '2026-10-06', 20_000, MOM_NAME));
    expect(b.previewSettingsChange({ momRule: { contains: MOM_NAME } }, '2026-10-07').items).toMatchObject([{ fromReserve: 0, difference: 20_000 }]);
  });

  it('13.2 A9 8.1 two payments, oldest first: the first takes what the reserve has', () => {
    const b = firstSync({ pots: { momReserve: 30_000 } });
    b.receive(payPerson('z2', '2026-10-08', 20_000, MOM_NAME));
    b.receive(payPerson('z1', '2026-10-06', 20_000, MOM_NAME));
    const preview = b.previewSettingsChange({ momRule: { contains: MOM_NAME } }, '2026-10-09');
    expect(preview.items.map((i) => (i.kind === 'mom' ? [i.id, i.fromReserve, i.difference] : []))).toEqual([
      ['z1', 20_000, 0],
      ['z2', 10_000, 10_000],
    ]);
  });

  it('13.2 A9 what nothing waiting matches, and a change to anything else, would sort nothing', () => {
    const b = firstSync();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(payPerson('z1', '2026-10-06', 20_000, 'MADE UP FRIEND'));
    for (const patch of [{ paycheckRule: { contains: 'SOMEONE ELSE' } }, { momRule: { contains: MOM_NAME } }, { split: { savings: 0, needs: 0, wants: 100 } }, { earlyPaycheckDays: 0 }] satisfies Partial<Settings>[]) {
      const preview = b.previewSettingsChange(patch, '2026-10-10');
      expect(preview.items, JSON.stringify(patch)).toEqual([]);
      expect(preview.potsAfter).toEqual(preview.potsBefore);
      expect(preview.waitingAfter).toBe(2);
    }
  });

  it('13.2 A9 clearing the paycheck rule or the mom rule would sort nothing', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-06', 1_000, 'MADE UP GIFT'));
    expect(b.previewSettingsChange({ paycheckRule: null, momRule: null }, '2026-10-07').items).toEqual([]);
  });

  it('13.2 A9 a setting that makes no sense is refused by the preview too, and changes nothing', () => {
    const b = firstSync();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const before = everything(b);
    expect(codeOf(() => b.previewSettingsChange({ paycheckRule: { contains: '  ' } }, '2026-10-10'))).toBe('bad-setting');
    expect(codeOf(() => b.previewSettingsChange({ paycheckRule: { contains: PAYROLL } }, '2026-13-01'))).toBe('not-a-date');
    expect(everything(b)).toEqual(before);
  });

  it('13.2 A9 0.1 a paycheck too large to stay exact is refused by the preview as by the change, and changes nothing', () => {
    const b = firstSync({ pots: { savings: Number.MAX_SAFE_INTEGER - 10 } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const before = everything(b);
    expect(codeOf(() => b.previewSettingsChange({ paycheckRule: { contains: PAYROLL } }, '2026-10-10'))).toBe('not-cents');
    expect(everything(b)).toEqual(before);
    expect(codeOf(() => b.changeSettings({ paycheckRule: { contains: PAYROLL } }, '2026-10-10'))).toBe('not-cents');
    expect(everything(b)).toEqual(before);
  });

  it('13.2 A9 the preview is exactly what the change then does', () => {
    const b = firstSync({ pots: { momReserve: 25_000 }, lastPaycheckDate: '2026-09-28' });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(paycheck('p2', '2026-10-15', 100_000));
    b.receive(paycheck('p3', '2026-10-20', 200_000));
    b.receive(payPerson('z1', '2026-10-06', 20_000, MOM_NAME));
    b.receive(payPerson('z2', '2026-10-16', 20_000, MOM_NAME));
    const patch = { paycheckRule: { contains: PAYROLL }, momRule: { contains: MOM_NAME } };
    const preview = b.previewSettingsChange(patch, '2026-10-21');
    b.changeSettings(patch, '2026-10-21');
    expect(b.pots()).toEqual(preview.potsAfter);
    expect(b.reviewItems()).toHaveLength(preview.waitingAfter);
    expect(b.paychecks().map((p) => p.id)).toEqual(preview.items.filter((i) => i.kind === 'paycheck').map((i) => i.id));
    expect(preview.items.map((i) => [i.id, i.kind])).toEqual([
      ['p1', 'paycheck'],
      ['p2', 'early-paycheck'],
      ['p3', 'paycheck'],
      ['z1', 'mom'],
      ['z2', 'mom'],
    ]);
  });

  it('13.2 A9 what the preview gives cannot be changed from outside', () => {
    const b = firstSync();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    const preview = b.previewSettingsChange({ paycheckRule: { contains: PAYROLL } }, '2026-10-10');
    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview.items)).toBe(true);
    expect(Object.isFrozen(preview.items[0])).toBe(true);
  });
});

describe('random scenarios: the preview of a settings change (13.2, A9)', () => {
  // Things waiting in review on the first sync: deposits (some paychecks),
  // payments to people (some to mom), and purchases, on random days.
  const waitingArb = fc.array(
    fc.oneof(
      fc.record({ type: fc.constant('deposit' as const), day: fc.integer({ min: 0, max: 40 }), amount: fc.integer({ min: 1, max: 900_000 }), paycheck: fc.boolean() }),
      fc.record({ type: fc.constant('person' as const), day: fc.integer({ min: 0, max: 40 }), amount: fc.integer({ min: 1, max: 400_000 }), mom: fc.boolean() }),
      fc.record({ type: fc.constant('purchase' as const), day: fc.integer({ min: 0, max: 40 }), amount: fc.integer({ min: 1, max: 50_000 }) }),
    ),
    { maxLength: 8 },
  );
  const patchArb = fc.oneof(
    fc.record({ paycheckRule: fc.constantFrom({ contains: PAYROLL }, { contains: 'ACME' }, { contains: 'NOBODY' }, null) }),
    fc.record({ momRule: fc.constantFrom({ contains: MOM_NAME }, { contains: 'made up' }, { contains: 'NOBODY' }, null) }),
    fc.record({ paycheckRule: fc.constant({ contains: PAYROLL }), momRule: fc.constant({ contains: MOM_NAME }), earlyPaycheckDays: fc.integer({ min: 0, max: 20 }) }),
    fc.record({ earlyPaycheckDays: fc.integer({ min: 0, max: 20 }), momReserveCap: fc.integer({ min: 0, max: 400_000 }) }),
  );

  it('13.2 A9 0.1 the preview changes nothing, is exactly what the change then does, and no cent is made or lost', () => {
    fc.assert(
      fc.property(
        waitingArb,
        patchArb,
        fc.integer({ min: -10_000, max: 400_000 }),
        fc.integer({ min: 0, max: 20 }),
        fc.constantFrom<'ask' | 'roll-over' | 'move-to-savings'>('ask', 'roll-over', 'move-to-savings'),
        (waiting, patch, reserve, lastGap, leftover) => {
          const b = openTestBook({
            pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: reserve },
            lastPaycheckDate: addDays('2026-10-01', -lastGap),
            settings: { paycheckRule: null, momRule: null, leftoverAtPayday: { needs: leftover, wants: 'roll-over' } },
          });
          waiting.forEach((w, i) => {
            const date = addDays('2026-10-01', w.day);
            if (w.type === 'deposit') b.receive(w.paycheck ? paycheck(`d${i}`, date, w.amount) : deposit(`d${i}`, date, w.amount, 'MADE UP GIFT'));
            else if (w.type === 'person') b.receive(payPerson(`z${i}`, date, w.amount, w.mom ? MOM_NAME : 'MADE UP FRIEND'));
            else b.receive(purchase(`e${i}`, date, w.amount, 'MADE UP STORE'));
          });
          const before = everything(b);
          const preview = b.previewSettingsChange(patch, '2026-11-15');
          expect(everything(b)).toEqual(before);
          expect(preview.potsBefore).toEqual(b.pots());
          expect(preview.waitingBefore).toBe(b.reviewItems().length);

          const { rechecked } = b.changeSettings(patch, '2026-11-15');
          expect(rechecked).toEqual(preview.items);
          expect(b.pots()).toEqual(preview.potsAfter);
          expect(b.reviewItems()).toHaveLength(preview.waitingAfter);
          expect(b.recountPots()).toEqual(b.pots());
          // Sorting what was waiting moves money between buckets, never makes or loses any (12.2).
          expect(appSide(b.pots())).toBe(appSide(preview.potsBefore));
          for (const item of preview.items) {
            if (item.kind === 'paycheck') expect(item.split.momReserve + item.split.savings + item.split.needs + item.split.wants).toBe(item.amount);
            if (item.kind === 'mom') {
              expect(item.fromReserve + item.difference).toBe(item.amount);
              expect(item.fromReserve).toBeGreaterThanOrEqual(0);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('4.2 6.2 7.4 what each kind of sorting rule can pick', () => {
  it('4.2 6.2 7.4 purchases: needs or wants. Money in: other income, a bucket, or not mine. Payments to people: needs, wants, not mine, or for mom', () => {
    expect(RULE_CHOICES).toEqual({
      purchase: ['needs', 'wants'],
      deposit: ['other-income', 'savings', 'needs', 'wants', 'momReserve', 'not-mine'],
      person: ['needs', 'wants', 'not-mine', 'mom'],
    });
  });

  it('4.2 6.2 7.4 B55 every choice listed is one a rule may make, and nothing else is', () => {
    const anything = ['paycheck', 'other-income', 'savings', 'needs', 'wants', 'momReserve', 'not-mine', 'mom', 'unsorted', 'heldForOthers', ''];
    const make = (kind: SortingRule['for'], to: string): SortingRule =>
      (kind === 'purchase' ? { id: 'r', for: kind, contains: 'X', bucket: to } : { id: 'r', for: kind, contains: 'X', choice: { to } }) as SortingRule;
    for (const kind of ['purchase', 'deposit', 'person'] as const) {
      for (const to of anything) {
        const allowed = (RULE_CHOICES[kind] as readonly string[]).includes(to);
        const accepted = codeOf(() => checkRules([make(kind, to)])) === "no error";
        expect(accepted, `${kind} ${to}`).toBe(allowed);
      }
    }
  });

  it('4.2 6.2 7.4 the lists cannot be changed from outside', () => {
    expect(Object.isFrozen(RULE_CHOICES)).toBe(true);
    expect(Object.isFrozen(RULE_CHOICES.purchase)).toBe(true);
    expect(Object.isFrozen(RULE_CHOICES.deposit)).toBe(true);
    expect(Object.isFrozen(RULE_CHOICES.person)).toBe(true);
  });
});
