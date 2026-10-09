import { DEFAULT_SETTINGS, openBook, type IsoDate } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { BankRulesDesk } from '../src/bank-rules-desk.js';
import { checkBankRules } from '../src/bank/reading.js';
import { settingsView } from '../src/views/settings.js';

// Settings shows the bank rules (rulebook section 2, 24c), and their changes
// are in the change log with every other change, in the order they were
// made, newest first (13.5). The bank rules are kept by the bank connection,
// not the book, so the two logs are put together here. Made-up names.

function lifeWithBothLogs() {
  let today: IsoDate = '2026-10-01';
  const book = openBook({ date: today, pots: { savings: 0, needs: 50_000, wants: 20_000, momReserve: 0, heldForOthers: 0 }, oldCardDebt: 0, lastPaycheckDate: '2026-09-25', settings: DEFAULT_SETTINGS, rules: [] });
  const desk = new BankRulesDesk({
    rules: checkBankRules([{ id: 'bank-rule-1', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' }]),
    lines: () => [],
    today: () => today,
    bookLines: () => book.changeLog().length,
  });
  book.addRule({ id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' }, '2026-10-02');
  today = '2026-10-03';
  desk.apply({ add: { account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' } });
  book.moveMoney({ from: 'needs', to: 'wants', amount: 1_000 }, '2026-10-04');
  today = '2026-10-05';
  desk.apply({ change: { id: 'bank-rule-1', account: 'savings', contains: 'Zelle payment to', means: 'payment-to-person' } });
  desk.apply({ remove: 'bank-rule-2' });
  const view = settingsView({ today, book, bank: null, madeUpData: true, bankRules: { rules: desk.rules(), log: desk.log(), recentDays: 90 } });
  if (view.state !== 'tracking') throw new Error('not tracking');
  return view;
}

describe('section 2 24c 13.5 bank rules on Settings', () => {
  it('24c the bank rules, in the order they are tried, and how far back a preview looks', () => {
    const view = lifeWithBothLogs();
    expect(view.bankRules).toEqual([{ id: 'bank-rule-1', account: 'savings', contains: 'Zelle payment to', means: 'payment-to-person' }]);
    expect(view.bankRulesRecentDays).toBe(90);
  });

  it('13.5 every change to a bank rule is in the change log, among the others, in the order they were made, newest first', () => {
    const view = lifeWithBothLogs();
    expect(view.log.map((l) => [l.kind, l.date])).toEqual([
      ['bank-rule-removed', '2026-10-05'],
      ['bank-rule-changed', '2026-10-05'],
      ['money-moved', '2026-10-04'],
      ['bank-rule-added', '2026-10-03'],
      ['rule-added', '2026-10-02'],
    ]);
    expect(view.log[1]).toMatchObject({ before: { account: 'checking' }, after: { account: 'savings' } });
    expect(view.log[3]).toMatchObject({ rule: { id: 'bank-rule-2', contains: 'LATE FEE' } });
    expect(new Set(view.log.map((l) => l.key)).size).toBe(view.log.length);
  });

  it('13.5 changes made on Setup day, before the book began, come first; with no bank rule changes the log is the book\'s', () => {
    const book = openBook({ date: '2026-10-07', pots: { savings: 0, needs: 0, wants: 0, momReserve: 0, heldForOthers: 0 }, oldCardDebt: 0, lastPaycheckDate: '2026-10-02', settings: DEFAULT_SETTINGS, rules: [] });
    const desk = new BankRulesDesk({ rules: [], lines: () => [], today: () => '2026-10-07', bookLines: () => 0 });
    desk.apply({ add: { account: 'checking', contains: 'Zelle', means: 'payment-to-person' } });
    book.addRule({ id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' }, '2026-10-07');
    const view = settingsView({ today: '2026-10-07', book, bank: null, madeUpData: true, bankRules: { rules: desk.rules(), log: desk.log(), recentDays: 90 } });
    expect(view.state === 'tracking' && view.log.map((l) => l.kind)).toEqual(['rule-added', 'bank-rule-added']);
    const without = settingsView({ today: '2026-10-07', book, bank: null, madeUpData: true });
    expect(without.state === 'tracking' && [without.log.map((l) => l.kind), without.bankRules]).toEqual([['rule-added'], []]);
  });
});
