import { DEFAULT_SETTINGS } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { checkBankRules } from '../src/bank/reading.js';
import { madeUpHistory, type MadeUpBank } from '../src/demo/made-up-bank.js';
import { NO_ANSWERS, setupView, type SetupAnswers, type SetupViewInput } from '../src/setup-view.js';
import type { SetupReadyView } from '../src/views/setup.js';

// What the Setup day screens are sent (rulebook section 14). The screens only
// format it. Every name and number is made up.

const RULES = checkBankRules([
  { id: 'card-paid', account: 'checking', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' },
  { id: 'card-got', account: 'everyday-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
]);
const BANK: MadeUpBank = {
  balances: { checking: 100_000, savings: 50_000, 'everyday-card': 20_000, 'old-card': 300_000 },
  rules: RULES,
  items: [
    { id: 'recent', account: 'checking', amount: 5_000, date: '2026-10-05', description: 'Online payment to CRD 3333' },
    { id: 'eleven-days', account: 'checking', amount: 7_000, date: '2026-09-26', description: 'Online payment to CRD 3333' },
    { id: 'ten-days', account: 'everyday-card', amount: -3_000, date: '2026-09-27', description: 'PAYMENT - THANK YOU' },
  ],
};

function view(answers: Partial<SetupAnswers> = {}, over: Partial<SetupViewInput> = {}): SetupReadyView {
  const v = setupView({ today: '2026-10-07', madeUpData: false, bank: madeUpHistory(BANK), answers: { ...NO_ANSWERS, ...answers }, settings: DEFAULT_SETTINGS, rules: [], halvesWithinDays: 10, ...over });
  if (v.state !== 'not-set-up' || !v.ready) throw new Error('not ready');
  return v;
}

describe('14 the Setup day view', () => {
  it('B48 A25 only halves from the last days asked about are listed, the day itself and the last of them included', () => {
    expect(view().halves.map((h) => h.id)).toEqual(['ten-days', 'recent']);
    expect(view({}, { halvesWithinDays: 11 }).halves.map((h) => h.id)).toEqual(['eleven-days', 'ten-days', 'recent']);
    expect(view({}, { halvesWithinDays: 0 }).halves).toEqual([]);
  });

  it('B48 a half arriving on a card from checking is taken off; its rule is named', () => {
    const half = view().halves.find((h) => h.id === 'ten-days');
    expect(half).toMatchObject({ kind: 'arrived', from: 'checking', to: 'everyday-card', amount: 3_000, effect: -3_000, onItsWay: null, rule: { id: 'card-got' } });
  });

  it('14.3 what is missing, in the order of the steps, and the self-check only once nothing is', () => {
    expect(view().missing).toEqual(['halves', 'last-paycheck', 'assignment']);
    const all = new Map([
      ['recent', true],
      ['ten-days', false],
    ]);
    expect(view({ onItsWay: all }).missing).toEqual(['last-paycheck', 'assignment']);
    expect(view({ onItsWay: all, lastPaycheckDate: '2026-10-02' }).missing).toEqual(['assignment']);
    expect(view({ onItsWay: all, lastPaycheckDate: '2026-10-02' }).selfCheck).toBeNull();
    // 1,000.00 + 500.00 - 200.00 + 50.00 on its way = 1,350.00
    const done = view({ onItsWay: all, lastPaycheckDate: '2026-10-02', assignment: { ...NO_ANSWERS.assignment, needs: 135_000 } });
    expect(done.missing).toEqual([]);
    expect(done.selfCheck).toEqual({ ok: true, bankSide: 130_000, inTransit: 5_000, appSide: 135_000, difference: 0 });
  });

  it('14.3 the key names exactly what is shown: the same answers give the same key, any change a new one', () => {
    const a = view({ lastPaycheckDate: '2026-10-02' });
    expect(view({ lastPaycheckDate: '2026-10-02' }).key).toBe(a.key);
    expect(view({ lastPaycheckDate: '2026-10-01' }).key).not.toBe(a.key);
    expect(view({ lastPaycheckDate: '2026-10-02', assignment: { ...NO_ANSWERS.assignment, wants: 1 } }).key).not.toBe(a.key);
    expect(view({ lastPaycheckDate: '2026-10-02', onItsWay: new Map([['recent', false]]) }).key).not.toBe(a.key);
    expect(a.key).toMatch(/^[0-9a-f]{32}$/);
  });

  it('B48 an answer for a half no longer asked about is left out', () => {
    expect(view({ onItsWay: new Map([['eleven-days', true]]) })).toMatchObject({ inTransit: 0, startingMoney: 130_000 });
  });

  it('section 2 the bank rules in use are shown as they are', () => {
    expect(view().bankRules).toEqual(RULES);
  });

  it('14 set up already: the view says so, and nothing else', () => {
    expect(setupView({ today: '2026-10-07', madeUpData: true, bank: { ...madeUpHistory(BANK), setUp: true }, answers: NO_ANSWERS, settings: DEFAULT_SETTINGS, rules: [], halvesWithinDays: 10 })).toEqual({
      state: 'tracking',
      madeUpData: true,
    });
  });
});
