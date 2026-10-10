import type { IsoDate } from '@budget-app/money';
import type { TokenBox } from '../crypto/token-box.js';
import type { Db } from '../db/database.js';
import {
  addAttention,
  loadBook,
  nextSyncNumber,
  readAccounts,
  readBankRules,
  readConnection,
  readItems,
  readStatements,
  rolesOf,
  saveAccount,
  saveConnectionState,
  saveItem,
  saveStatement,
  saveSync,
} from '../db/store.js';
import type { Log } from '../log.js';
import { BankKey, PlaidError, type PlaidClient } from '../plaid/client.js';
import type { AccountsGetResponse, LiabilitiesGetResponse, PlaidCreditCard, TransactionsSyncResponse } from '../plaid/types.js';
import { appendEvent } from '../history/history-db.js';
import { planSync, type Attention } from './plan.js';

// One sync: everything Plaid has that is new since the last one, then the
// balances and card statements, saved in one transaction together with the
// cursor for the next sync. So a sync is all or nothing:
// - Interrupted before the save (Plaid unreachable, the app stopped), it
//   saved nothing, and the next sync starts from the same cursor.
// - Run again with nothing new, it changes nothing at all.
// - Two at once: the second to save sees that the cursor moved, and starts
//   over from the new one, so nothing is counted twice.

export interface SyncInput {
  readonly db: Db;
  readonly plaid: PlaidClient;
  readonly box: TokenBox;
  readonly log: Log;
  // His calendar date, for anything the bank does not date (a dropped charge).
  readonly today: IsoDate;
  // Changes asked for per page (Plaid allows 1 to 500).
  readonly pageSize?: number;
  // For tests: runs inside the save, after the changes are written and
  // before they are committed.
  readonly beforeCommit?: () => void;
}

export interface SyncResult {
  // False when there was nothing new, and nothing was written.
  readonly changed: boolean;
  // 10.5: the bank wants him to log in again. Nothing else was done.
  readonly needsLogin: boolean;
  readonly added: number;
  readonly modified: number;
  readonly removed: number;
  // Given to the book.
  readonly sent: number;
  // New things waiting for his decision.
  readonly attention: readonly Attention[];
  readonly historyComplete: boolean;
}

interface Fetched {
  readonly pages: readonly TransactionsSyncResponse[];
  readonly cursor: string;
  readonly accounts: AccountsGetResponse;
  readonly cards: readonly PlaidCreditCard[] | null;
}

const TRIES = 3;

export async function syncBank(input: SyncInput): Promise<SyncResult> {
  const { db, log } = input;
  for (let attempt = 1; ; attempt += 1) {
    const connection = readConnection(db);
    if (connection === null) throw new Error('there is no bank connection yet');
    const key = new BankKey(input.box.open(connection.sealedKey, connection.itemId));
    let fetched: Fetched;
    try {
      fetched = await fetchUpdate(input.plaid, key, connection.cursor, input.pageSize ?? 250);
    } catch (error) {
      if (error instanceof PlaidError && error.errorCode === 'ITEM_LOGIN_REQUIRED') {
        if (!connection.needsLogin) saveConnectionState(db, { cursor: connection.cursor, historyComplete: connection.historyComplete, needsLogin: true });
        log.warn('the bank wants a new login');
        return { changed: !connection.needsLogin, needsLogin: true, added: 0, modified: 0, removed: 0, sent: 0, attention: [], historyComplete: connection.historyComplete };
      }
      throw error;
    }
    const result = db.transaction(() => save(input, connection.cursor, fetched))();
    if (result !== 'cursor-moved') {
      log.info('sync done', { changed: result.changed, added: result.added, modified: result.modified, removed: result.removed, sent: result.sent, attention: result.attention.length });
      return result;
    }
    log.warn('another sync saved first; starting over', { attempt });
    if (attempt >= TRIES) throw new Error('other syncs kept saving first; try again');
  }
}

// All pages of the update, then the balances and statements, then one more
// look for changes that came in meanwhile, so the balances go with the
// transactions. If Plaid's data changes while paging, paging starts over
// from the first page, as Plaid asks.
async function fetchUpdate(plaid: PlaidClient, key: BankKey, start: string | null, pageSize: number): Promise<Fetched> {
  for (let restart = 0; ; restart += 1) {
    try {
      const pages: TransactionsSyncResponse[] = [];
      let cursor = start;
      const more = async (): Promise<void> => {
        for (;;) {
          const page = checkPage(await plaid.syncTransactions(key, cursor, pageSize));
          pages.push(page);
          cursor = page.next_cursor;
          if (!page.has_more) return;
        }
      };
      await more();
      for (let round = 0; ; round += 1) {
        const accounts = await plaid.getAccounts(key);
        const cards = accounts.accounts.some((a) => a.type === 'credit') ? await creditCards(plaid, key) : null;
        const before = pages.length;
        await more();
        const quiet = pages.slice(before).every((p) => p.added.length === 0 && p.modified.length === 0 && p.removed.length === 0);
        if (quiet || round >= 2) return { pages, cursor: cursor ?? '', accounts, cards };
      }
    } catch (error) {
      if (error instanceof PlaidError && error.errorCode === 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' && restart < TRIES) continue;
      throw error;
    }
  }
}

async function creditCards(plaid: PlaidClient, key: BankKey): Promise<readonly PlaidCreditCard[] | null> {
  try {
    const reply: LiabilitiesGetResponse = await plaid.getLiabilities(key);
    return reply.liabilities.credit ?? [];
  } catch (error) {
    // Without the Liabilities product there are no statements to read.
    if (error instanceof PlaidError && (error.errorCode === 'PRODUCTS_NOT_SUPPORTED' || error.errorCode === 'NO_LIABILITY_ACCOUNTS')) return null;
    throw error;
  }
}

function checkPage(page: TransactionsSyncResponse): TransactionsSyncResponse {
  if (!Array.isArray(page.added) || !Array.isArray(page.modified) || !Array.isArray(page.removed) || typeof page.next_cursor !== 'string' || typeof page.has_more !== 'boolean') {
    throw new Error('Plaid sent a transactions page the app cannot read');
  }
  return page;
}

// Inside one database transaction: work out the plan and write all of it.
function save(input: SyncInput, startCursor: string | null, fetched: Fetched): SyncResult | 'cursor-moved' {
  const { db } = input;
  const connection = readConnection(db);
  if (connection === null) throw new Error('the bank connection is gone');
  if (connection.cursor !== startCursor) return 'cursor-moved';

  // Pages in order: what each id came to in the end.
  const latest = new Map<string, unknown>();
  const removed = new Set<string>();
  let added = 0;
  let modified = 0;
  let removedCount = 0;
  for (const page of fetched.pages) {
    for (const tx of [...page.added, ...page.modified]) {
      latest.set(tx.transaction_id, tx);
      removed.delete(tx.transaction_id);
    }
    for (const r of page.removed) removed.add(r.transaction_id);
    added += page.added.length;
    modified += page.modified.length;
    removedCount += page.removed.length;
  }
  const statusSeen = fetched.pages.some((p) => p.transactions_update_status === 'HISTORICAL_UPDATE_COMPLETE');
  const historyComplete = connection.historyComplete || statusSeen;

  const sync = nextSyncNumber(db);
  const storedAccounts = readAccounts(db);
  const changedAccounts = fetched.accounts.accounts.filter((a) => storedAccounts.find((s) => s.plaidAccountId === a.account_id)?.rawText !== JSON.stringify(a));
  // Roles are kept; a new Plaid account has none until one is set.
  const roles = rolesOf(storedAccounts);
  const storedCards = readStatements(db);
  const changedCards = (fetched.cards ?? []).flatMap((card) =>
    card.account_id !== null && storedCards.get(card.account_id)?.rawText !== JSON.stringify(card) ? [{ accountId: card.account_id, card }] : [],
  );

  const book = loadBook(db);
  const plan = planSync({
    stored: readItems(db),
    changed: [...latest.values()],
    removed: [...removed],
    roles,
    rules: readBankRules(db),
    book,
    today: input.today,
    sync,
  });

  const plaidSentNothing = added + modified + removedCount === 0;
  const changed =
    !plaidSentNothing ||
    plan.items.length > 0 ||
    plan.events.length > 0 ||
    plan.attention.length > 0 ||
    changedAccounts.length > 0 ||
    changedCards.length > 0 ||
    historyComplete !== connection.historyComplete ||
    connection.cursor === null ||
    connection.needsLogin;
  const result: SyncResult = {
    changed,
    needsLogin: false,
    added,
    modified,
    removed: removedCount,
    sent: plan.events.length,
    attention: plan.attention,
    historyComplete,
  };
  if (!changed) return result;

  for (const account of changedAccounts) saveAccount(db, account, JSON.stringify(account), sync);
  for (const { accountId, card } of changedCards) saveStatement(db, accountId, JSON.stringify(card), sync);
  for (const item of plan.items) saveItem(db, item);
  // Each with the day of the sync, and the book's totals after it.
  plan.events.forEach((txn, i) => appendEvent(db, { event: { kind: 'receive', txn }, date: input.today, sync, totals: plan.totals[i] ?? null }));
  for (const attention of plan.attention) addAttention(db, sync, attention);
  // With nothing new from Plaid, the cursor stays as it was.
  const cursor = plaidSentNothing && connection.cursor !== null ? connection.cursor : fetched.cursor;
  saveConnectionState(db, { cursor, historyComplete, needsLogin: false });
  saveSync(db, {
    id: sync,
    today: input.today,
    cursorBefore: startCursor,
    cursorAfter: cursor,
    added,
    modified,
    removed: removedCount,
    sent: plan.events.length,
    held: plan.attention.length,
  });
  input.beforeCommit?.();
  return result;
}
