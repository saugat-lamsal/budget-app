import {
  daysBetween,
  startTracking,
  startingMoney,
  type AccountId,
  type BankBalances,
  type Cents,
  type IsoDate,
  type Purchase,
  type Settings,
  type SetupInput,
  type SortingRule,
  type StartingPots,
  type TransferArrived,
  type TransferSent,
} from '@budget-app/money';
import { bankView } from './bank/balances.js';
import { readPlaidItem } from './bank/plaid-item.js';
import { readBankItem } from './bank/reading.js';
import type { Db } from './db/database.js';
import { appendBookEvent, loadBook, logChange, nextSyncNumber, readAccounts, readBankRules, readConnection, readItems, rolesOf, saveItem } from './db/store.js';
import type { StoredItem } from './sync/plan.js';

// Rulebook section 14, setup day, from what the bank connection has synced:
// 14.1 the bank's balances today, 14.2 his assignment of the starting money,
// 14.3 tracking starts only if the assignment adds up and the self-check
// passes. Everything synced before setup day is history: it is in the
// starting balances. Charges still pending are in the starting money too
// (A10), and so is money on its way between his accounts (B48).

export type HalfInTransit = TransferSent | TransferArrived;

interface History {
  readonly items: Map<string, StoredItem>;
  readonly roles: Map<string, AccountId>;
  readonly posted: BankBalances;
  readonly oldCardBalance: Cents;
  readonly pendingCharges: Purchase[];
  // Each history item read again with today's bank rules.
  readonly reread: Map<string, StoredItem>;
}

function readHistory(db: Db): History {
  const connection = readConnection(db);
  if (connection === null) throw new Error('there is no bank connection yet');
  if (!connection.historyComplete) throw new Error('Plaid has not sent all of the history yet; sync again in a little while');
  if (loadBook(db) !== null) throw new Error('setup day is done already');
  const accounts = readAccounts(db);
  const roles = rolesOf(accounts);
  const missing = (['checking', 'savings', 'everyday-card', 'old-card'] as const).filter((role) => ![...roles.values()].includes(role));
  if (missing.length > 0) throw new Error(`these accounts are not set yet: ${missing.join(', ')}`);
  const items = readItems(db);
  const rules = readBankRules(db);
  const reread = new Map<string, StoredItem>();
  for (const item of items.values()) {
    const role = roles.get(item.accountId);
    const read = readPlaidItem(item.raw);
    if (role === undefined || !read.ok) continue;
    const kind = readBankItem(role, read.item.amount, read.item.description, rules).kind;
    reread.set(item.transactionId, { ...item, kind });
  }
  const view = bankView(accounts, reread);
  if (!view.ok) throw new Error(view.why);
  const pendingCharges: Purchase[] = [];
  for (const item of reread.values()) {
    const role = roles.get(item.accountId);
    const read = readPlaidItem(item.raw);
    if (!item.pending || item.removed || item.kind !== 'purchase' || role === undefined || role === 'savings' || !read.ok || read.item.amount <= 0) continue;
    pendingCharges.push({ kind: 'purchase', id: item.transactionId, account: role, date: read.item.day, amount: read.item.amount, description: read.item.description, pending: true });
  }
  return { items, roles, posted: view.view.posted, oldCardBalance: view.view.oldCardPosted, pendingCharges, reread };
}

function halfOf(item: StoredItem, roles: Map<string, AccountId>, rules: ReturnType<typeof readBankRules>): HalfInTransit | null {
  const role = roles.get(item.accountId);
  const read = readPlaidItem(item.raw);
  if (role === undefined || !read.ok || read.item.pending || item.removed) return null;
  const reading = readBankItem(role, read.item.amount, read.item.description, rules);
  const base = { id: item.transactionId, date: read.item.date, amount: Math.abs(read.item.amount), description: read.item.description };
  if (reading.kind === 'transfer-sent' && (role === 'checking' || role === 'savings')) return { ...base, kind: 'transfer-sent', from: role, to: reading.to };
  if (reading.kind === 'transfer-arrived') return { ...base, kind: 'transfer-arrived', from: reading.from, to: role };
  return null;
}

// B48: halves of transfers in the history with no other half seen, from the
// last withinDays days. He says which are still on their way.
export function halvesInTransit(db: Db, today: IsoDate, withinDays: number): HalfInTransit[] {
  const history = readHistory(db);
  const rules = readBankRules(db);
  const halves = [...history.reread.values()].flatMap((item) => {
    const half = halfOf(item, history.roles, rules);
    return half === null ? [] : [half];
  });
  halves.sort((a, b) => a.date.localeCompare(b.date));
  const paired = new Set<string>();
  for (const arrived of halves.filter((h) => h.kind === 'transfer-arrived')) {
    const candidates = halves.filter((h) => h.kind === 'transfer-sent' && !paired.has(h.id) && h.to === arrived.to && h.amount === arrived.amount);
    const sent = candidates.find((h) => h.from === arrived.from) ?? candidates[0];
    if (sent !== undefined) {
      paired.add(sent.id);
      paired.add(arrived.id);
    }
  }
  return halves.filter((h) => !paired.has(h.id) && daysBetween(h.date, today) >= 0 && daysBetween(h.date, today) <= withinDays);
}

export interface SetupPreview {
  // 14.2: checking + savings - everyday card, with pending charges and money in transit.
  readonly startingMoney: Cents;
  readonly posted: BankBalances;
  readonly pendingCharges: readonly Purchase[];
  readonly inTransit: readonly HalfInTransit[];
  readonly oldCardBalance: Cents;
}

export function setupPreview(db: Db, inTransitIds: readonly string[]): SetupPreview {
  const history = readHistory(db);
  const inTransit = chosenHalves(db, history, inTransitIds);
  return {
    startingMoney: startingMoney(history.posted, history.pendingCharges, inTransit),
    posted: history.posted,
    pendingCharges: history.pendingCharges,
    inTransit,
    oldCardBalance: history.oldCardBalance,
  };
}

function chosenHalves(db: Db, history: History, ids: readonly string[]): HalfInTransit[] {
  const rules = readBankRules(db);
  return ids.map((id) => {
    const item = history.reread.get(id);
    const half = item === undefined ? null : halfOf(item, history.roles, rules);
    if (half === null) throw new Error(`${id} is not half of a transfer from the history`);
    return half;
  });
}

export interface SetupChoices {
  readonly today: IsoDate;
  readonly assignment: StartingPots;
  readonly lastPaycheckDate: IsoDate;
  readonly settings: Settings;
  readonly rules?: readonly SortingRule[];
  // Ids of halves still on their way (from halvesInTransit).
  readonly inTransit: readonly string[];
}

export type SetupOutcome =
  | { readonly ok: true; readonly startingMoney: Cents }
  // 14.3: not started. difference is starting money minus what was assigned.
  | { readonly ok: false; readonly startingMoney: Cents; readonly assigned: Cents; readonly difference: Cents };

export function setUpTracking(db: Db, choices: SetupChoices): SetupOutcome {
  const history = readHistory(db);
  const inTransit = chosenHalves(db, history, choices.inTransit);
  const input: SetupInput = {
    date: choices.today,
    bankBalances: history.posted,
    pendingCharges: history.pendingCharges,
    transfersInTransit: inTransit,
    oldCardBalance: history.oldCardBalance,
    assignment: choices.assignment,
    lastPaycheckDate: choices.lastPaycheckDate,
    settings: choices.settings,
    rules: choices.rules ?? [],
  };
  const result = startTracking(input);
  if (!result.ok) return { ok: false, startingMoney: result.startingMoney, assigned: result.assigned, difference: result.difference };
  const inBook = new Set([...history.pendingCharges.map((c) => c.id), ...inTransit.map((h) => h.id)]);
  db.transaction(() => {
    appendBookEvent(db, Math.max(1, nextSyncNumber(db) - 1), { kind: 'setup', input });
    for (const item of history.reread.values()) {
      const updated: StoredItem = { ...item };
      if (inBook.has(item.transactionId)) {
        updated.status = 'sent';
        updated.bookId = item.transactionId;
      } else if (item.pending && !item.removed && item.status === 'history') {
        // Pending, but not a purchase: it goes to the book once it posts.
        updated.status = 'waiting';
      }
      if (updated.status !== item.status || updated.kind !== history.items.get(item.transactionId)?.kind || updated.bookId !== item.bookId) saveItem(db, updated);
    }
    logChange(db, choices.today, 'setup day', { startingMoney: result.startingMoney, assignment: choices.assignment, inTransit: choices.inTransit });
  })();
  return { ok: true, startingMoney: result.startingMoney };
}
