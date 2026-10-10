import { DEFAULT_SETTINGS, openBook } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import type { BankRuleLogLine } from '../src/views/bank-rules.js';
import type { ServerLogLine } from '../src/views/server-log.js';
import { settingsView } from '../src/views/settings.js';

// The change log (13.5) on Settings is one list, newest first, from three
// places: the book's own lines, the bank rules' lines, and the server's lines
// (the history taking new totals, A28; logins, new passkeys, log outs). Each
// line kept outside the book says how many of the book's lines (and, for the
// server's, the bank rules' lines) there were when it was written, so they
// all go where they happened. Made-up names and numbers.

const RULE = { id: 'bank-rule-1', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' } as const;

describe('13.5 A28 the server\'s lines in the change log', () => {
  it('13.5 A28 the book\'s, the bank rules\' and the server\'s lines read as one list, in the order they happened, newest first', () => {
    const book = openBook({ date: '2026-10-01', pots: { savings: 0, needs: 50_000, wants: 20_000, momReserve: 0, heldForOthers: 0 }, oldCardDebt: 0, lastPaycheckDate: '2026-09-25', settings: DEFAULT_SETTINGS, rules: [] });
    // In this order: a book line; a login; a bank rule added; a passkey added
    // and a log out; a second bank rule line; a book line; the history taking
    // new totals.
    book.addRule({ id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' }, '2026-10-02');
    const bankLog: BankRuleLogLine[] = [
      { date: '2026-10-03', action: 'added', rule: RULE, before: null, afterBookLines: 1 },
      { date: '2026-10-04', action: 'removed', rule: RULE, before: null, afterBookLines: 1 },
    ];
    book.moveMoney({ from: 'needs', to: 'wants', amount: 1_000 }, '2026-10-05');
    const totals = { savings: 0, needs: 50_000, wants: 20_000, momReserve: 0, heldForOthers: 0, unsortedIn: 0, unsortedOut: 0, oldCardDebt: 0, inTransit: 0, waiting: 0 };
    const serverLog: ServerLogLine[] = [
      { date: '2026-10-02', action: 'logged-in', device: 'Chrome on Windows', afterBookLines: 1, afterBankLines: 0 },
      { date: '2026-10-03', action: 'passkey-added', device: 'Safari on iPhone', afterBookLines: 1, afterBankLines: 1 },
      { date: '2026-10-03', action: 'logged-out', device: 'Chrome on Windows', afterBookLines: 1, afterBankLines: 1 },
      {
        date: '2026-10-06',
        action: 'history-retotaled',
        from: { seq: 7, date: '2026-10-02', what: 'his answer: sort' },
        events: [
          { seq: 7, date: '2026-10-02', what: 'his answer: sort', before: { ...totals, wants: 17_655, needs: 50_000 }, after: { ...totals, wants: 20_000, needs: 47_655 } },
          { seq: 8, date: '2026-10-03', what: 'from the bank: purchase store-2', before: totals, after: { ...totals, needs: 1 } },
        ],
        afterBookLines: 2,
        afterBankLines: 2,
      },
    ];
    const view = settingsView({ today: '2026-10-06', book, bank: null, madeUpData: true, bankRules: { rules: [], log: bankLog, recentDays: 90 }, serverLog });
    if (view.state !== 'tracking') throw new Error('not tracking');
    expect(view.log.map((row) => row.kind)).toEqual(['history-retotaled', 'money-moved', 'bank-rule-removed', 'logged-out', 'passkey-added', 'bank-rule-added', 'logged-in', 'rule-added']);
    expect(view.log[0]).toEqual({
      key: 's3-0',
      date: '2026-10-06',
      kind: 'history-retotaled',
      from: { date: '2026-10-02', what: 'his answer: sort' },
      events: 2,
      changes: [
        { name: 'needs', before: 50_000, after: 47_655 },
        { name: 'wants', before: 17_655, after: 20_000 },
      ],
    });
    expect(view.log.find((row) => row.kind === 'logged-in')).toEqual({ key: 's0-0', date: '2026-10-02', kind: 'logged-in', device: 'Chrome on Windows' });
  });

  it('13.5 with no server lines (the demo), the log is as it always was', () => {
    const book = openBook({ date: '2026-10-01', pots: { savings: 0, needs: 50_000, wants: 20_000, momReserve: 0, heldForOthers: 0 }, oldCardDebt: 0, lastPaycheckDate: '2026-09-25', settings: DEFAULT_SETTINGS, rules: [] });
    book.addRule({ id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' }, '2026-10-02');
    const without = settingsView({ today: '2026-10-06', book, bank: null, madeUpData: true });
    const empty = settingsView({ today: '2026-10-06', book, bank: null, madeUpData: true, serverLog: [] });
    expect(empty).toEqual(without);
  });
});
