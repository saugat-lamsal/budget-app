import type { IsoDate } from '@budget-app/money';
import type { Db } from './db/database.js';
import { appendBookEvent, loadBook, logChange, nextSyncNumber, readAccounts, readBankRules, readConnection, readItems, saveItem } from './db/store.js';
import { halvesInTransitIn, planSetup, setupPreviewOf, type BankHistory, type HalfInTransit, type SetupChoices, type SetupOutcome, type SetupPreview } from './setup-history.js';

export type { BankHistory, HalfInTransit, SetupChoices, SetupOutcome, SetupPreview } from './setup-history.js';

// Rulebook section 14, setup day, from what the bank connection has synced
// into the database. A thin wrapper: it reads the history, hands it to the
// setup logic (setup-history.ts), and saves what setting up does.

// The history in the database. Whether setup day is done is only looked at
// once the history is all there, the order the checks have always had.
export function bankHistoryOf(db: Db): BankHistory {
  const connection = readConnection(db);
  return {
    connection,
    setUp: connection !== null && connection.historyComplete && loadBook(db) !== null,
    accounts: readAccounts(db),
    items: readItems(db),
    rules: readBankRules(db),
  };
}

// B48: halves of transfers in the history with no other half seen, from the
// last withinDays days. He says which are still on their way.
export function halvesInTransit(db: Db, today: IsoDate, withinDays: number): HalfInTransit[] {
  return halvesInTransitIn(bankHistoryOf(db), today, withinDays);
}

export function setupPreview(db: Db, inTransitIds: readonly string[]): SetupPreview {
  return setupPreviewOf(bankHistoryOf(db), inTransitIds);
}

export function setUpTracking(db: Db, choices: SetupChoices): SetupOutcome {
  const plan = planSetup(bankHistoryOf(db), choices);
  if (!plan.ok) return { ok: false, startingMoney: plan.startingMoney, assigned: plan.assigned, difference: plan.difference };
  db.transaction(() => {
    appendBookEvent(db, Math.max(1, nextSyncNumber(db) - 1), { kind: 'setup', input: plan.input });
    for (const item of plan.items) saveItem(db, item);
    logChange(db, choices.today, 'setup day', { startingMoney: plan.startingMoney, assignment: choices.assignment, inTransit: choices.inTransit });
  })();
  return { ok: true, startingMoney: plan.startingMoney };
}
