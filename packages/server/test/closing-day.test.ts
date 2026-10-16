import { describe, expect, it } from 'vitest';
import type { PlaidCreditCard } from '../src/plaid/types.js';
import { bankStatus } from '../src/status.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import type { Settings } from '@budget-app/money';
import { decision, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// 9.8 (QUESTIONS.md A52, found by A50c on his real accounts, Oct 15, 2026):
// Bank of America sends each card's due date, statement balance and minimum,
// but no statement date. The statement date is then the due date less the
// days set for that card. Until they are set, that card has no reminders, no
// due line on Home, and no overdue alert, and Home and Settings say so; the
// same for a statement the app cannot read. Before, such a card was dropped
// without a word. Every name and number is made up.

type Card = Omit<PlaidCreditCard, 'account_id'>;

// Due Oct 24: the reminder days are Oct 17 and Oct 22 (7 and 2 before).
const OLD: Card = {
  is_overdue: false,
  last_payment_amount: 35,
  last_payment_date: '2026-09-06',
  last_statement_issue_date: null,
  last_statement_balance: 1_500,
  minimum_payment_amount: 40,
  next_payment_due_date: '2026-10-24',
};
const EVERYDAY: Card = { ...OLD, last_statement_issue_date: '2026-09-28', last_statement_balance: 450.25, minimum_payment_amount: 35, next_payment_due_date: '2026-10-23' };

async function onTheSeventeenth(cards: { old?: Card; everyday?: Card }): Promise<Life> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  if (cards.old !== undefined) life.h.fake.setStatement(ACCOUNT_IDS.old, cards.old);
  if (cards.everyday !== undefined) life.h.fake.setStatement(ACCOUNT_IDS.everyday, cards.everyday);
  life.now = noonInNewYork('2026-10-17');
  await life.sync();
  return life;
}

// A settings change from Settings, as the screen sends it.
function set(life: Life, settings: Partial<Settings>): boolean {
  return life.keeper.settingsChange({ id: decision(), settings }).ok;
}

function attention(life: Life) {
  const home = life.keeper.home();
  if (home.state !== 'tracking') throw new Error('not tracking');
  return home.attention.filter((a) => a.kind === 'card-due' || a.kind === 'card-overdue' || a.kind === 'card-reminders-off');
}

function cardsOff(life: Life) {
  const settings = life.keeper.settings();
  if (settings.state !== 'tracking') throw new Error('not tracking');
  return settings.cardsOff;
}

describe('9.8 a card the bank sends no statement date for', () => {
  it('9.8 no days set: no reminder, no due line, and Home and Settings say its reminders are off; the card the bank sent a date for is as before', async () => {
    const life = await onTheSeventeenth({ old: OLD, everyday: EVERYDAY });
    try {
      expect(attention(life)).toEqual([
        { kind: 'card-reminders-off', card: 'old-card', why: 'no-statement-date' },
        { kind: 'card-due', card: 'everyday-card', dueDate: '2026-10-23', daysLeft: 6, statementBalance: 45_025, minimumPayment: 3_500 },
      ]);
      expect(cardsOff(life)).toEqual([{ card: 'old-card', why: 'no-statement-date' }]);
    } finally {
      life.done();
    }
  });

  it('9.8 with the days set, the statement date is the due date less them, and the card is due from its first reminder day (9.6); kept after a restart', async () => {
    const life = await onTheSeventeenth({ old: OLD, everyday: { ...EVERYDAY, last_statement_issue_date: null } });
    try {
      expect(set(life, { oldCardStatementDays: 25, everydayCardStatementDays: 25 })).toBe(true);
      expect(attention(life)).toEqual([
        { kind: 'card-due', card: 'everyday-card', dueDate: '2026-10-23', daysLeft: 6, statementBalance: 45_025, minimumPayment: 3_500 },
        { kind: 'card-due', card: 'old-card', dueDate: '2026-10-24', daysLeft: 7, minimumPayment: 4_000 },
      ]);
      expect(cardsOff(life)).toEqual([]);
      life.restart();
      expect(attention(life).map((a) => [a.kind, 'card' in a ? a.card : null])).toEqual([
        ['card-due', 'everyday-card'],
        ['card-due', 'old-card'],
      ]);
      // Cleared again: off again, and said again.
      expect(set(life, { oldCardStatementDays: null })).toBe(true);
      expect(cardsOff(life)).toEqual([{ card: 'old-card', why: 'no-statement-date' }]);
    } finally {
      life.done();
    }
  });

  it('9.8 a statement the app cannot read is said too, whether or not the days are set; a card with no statement from the bank is as before', async () => {
    const life = await onTheSeventeenth({ old: { ...OLD, minimum_payment_amount: null } });
    try {
      expect(cardsOff(life)).toEqual([{ card: 'old-card', why: 'unreadable' }]);
      expect(set(life, { oldCardStatementDays: 25 })).toBe(true);
      expect(attention(life)).toEqual([{ kind: 'card-reminders-off', card: 'old-card', why: 'unreadable' }]);
      expect(cardsOff(life)).toEqual([{ card: 'old-card', why: 'unreadable' }]);
    } finally {
      life.done();
    }
  });

  it('9.8 9.4 past the due date with less than the minimum paid: overdue once the days are set, never while they are not', async () => {
    const life = await onTheSeventeenth({ old: OLD });
    try {
      life.now = noonInNewYork('2026-10-26');
      await life.sync();
      expect(attention(life)).toEqual([{ kind: 'card-reminders-off', card: 'old-card', why: 'no-statement-date' }]);
      expect(set(life, { oldCardStatementDays: 25 })).toBe(true);
      expect(attention(life)).toEqual([{ kind: 'card-overdue', card: 'old-card', dueDate: '2026-10-24', minimumPayment: 4_000 }]);
    } finally {
      life.done();
    }
  });

  it('9.8 the status report reads each card with the days set for it', async () => {
    const life = await onTheSeventeenth({ old: OLD, everyday: { ...EVERYDAY, last_statement_issue_date: null } });
    try {
      const read = () => bankStatus(life.h.db).statements.map((s) => [s.card, s.result.ok ? s.result.statement.closingDate : s.result.why]);
      expect(read()).toEqual([
        ['everyday-card', 'the bank did not give the statement date'],
        ['old-card', 'the bank did not give the statement date'],
      ]);
      expect(set(life, { oldCardStatementDays: 25, everydayCardStatementDays: 20 })).toBe(true);
      expect(read()).toEqual([
        ['everyday-card', '2026-10-03'],
        ['old-card', '2026-09-29'],
      ]);
    } finally {
      life.done();
    }
  });
});
