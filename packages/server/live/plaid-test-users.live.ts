import { DEFAULT_SETTINGS, startTracking, type AccountId, type BankTransaction, type Purchase } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { readPlaidItem } from '../src/bank/plaid-item.js';
import { cardStatement } from '../src/bank/statements.js';
import { readAccounts, readItems, readStatements } from '../src/db/store.js';
import { BankKey } from '../src/plaid/client.js';
import type { PlaidAccount, PlaidRemovedTransaction, PlaidTransaction } from '../src/plaid/types.js';
import { planSync, type StoredItem } from '../src/sync/plan.js';
import { connectLive, fact, openKey, saveRecording, syncUntilHistory, todayUtc, wait } from './test-bank.js';

// Two of Plaid's own test users, for what the made-up accounts cannot show:
// a card statement with every detail (user_good), and pending charges that
// post (user_transactions_dynamic, which posts them when asked to refresh).
const today = todayUtc();

describe('a card statement from the test bank (user_good)', () => {
  it('9.1 to 9.3 the statement balance, the minimum, the due date, and the statement date, read to the cent', async () => {
    const bank = await connectLive({ username: 'user_good', password: 'pass_good', today });
    await syncUntilHistory(bank, today);
    const statements = [...readStatements(bank.db).values()];
    for (const s of statements) fact(`statement: ${s.rawText}`);
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      const read = cardStatement('everyday-card', s.raw);
      fact(`read as: ${JSON.stringify(read)}`);
      expect(read.ok).toBe(true);
      if (!read.ok) continue;
      expect(read.statement.statementBalance).toBe(Math.round((s.raw.last_statement_balance ?? Number.NaN) * 100));
      expect(read.statement.minimumPayment).toBe(Math.round((s.raw.minimum_payment_amount ?? Number.NaN) * 100));
      expect(read.statement.dueDate).toBe(s.raw.next_payment_due_date);
      expect(read.statement.closingDate).toBe(s.raw.last_statement_issue_date);
    }
    saveRecording('user-good', bank.recorded);
  });
});

describe('pending charges that post, at the test bank (user_transactions_dynamic)', () => {
  it('4.6 a pending charge that posts is removed, and its posted version added and linked to it, in the same update', async () => {
    const bank = await connectLive({ username: 'user_transactions_dynamic', password: 'any-password', today });
    await syncUntilHistory(bank, today);
    const accounts = readAccounts(bank.db).map((a) => a.raw);
    const byType = (type: string, subtype: string): PlaidAccount | undefined => accounts.find((a) => a.type === type && a.subtype === subtype);
    const checking = byType('depository', 'checking');
    const card = byType('credit', 'credit card');
    if (checking === undefined || card === undefined) throw new Error('the test user has no checking account or no card');
    // This test user has a checking account and a card; the app reads them
    // as his checking and everyday card. Its loans are left out.
    const roles = new Map<string, AccountId>([
      [checking.account_id, 'checking'],
      [card.account_id, 'everyday-card'],
    ]);

    // Setup day by hand, as far as these two accounts go: the starting money
    // is what they show, with their pending charges counted (A10).
    const stored = new Map<string, StoredItem>([...readItems(bank.db)].map(([id, item]) => [id, { ...item }]));
    const pendingCharges: Purchase[] = [];
    for (const item of stored.values()) {
      const read = readPlaidItem(item.raw);
      const role = roles.get(item.accountId);
      if (!read.ok || role === undefined || role === 'savings' || !read.item.pending || read.item.amount <= 0) continue;
      pendingCharges.push({ kind: 'purchase', id: item.transactionId, account: role, date: read.item.day, amount: read.item.amount, description: read.item.description, pending: true });
      item.status = 'sent';
      item.kind = 'purchase';
      item.bookId = item.transactionId;
    }
    fact(`pending charges on setup day: ${pendingCharges.map((c) => `${c.account} ${c.amount / 100} ${c.description}`).join('; ')}`);
    const balance = (a: PlaidAccount): number => Math.round((a.balances.current ?? 0) * 100);
    const setup = startTracking({
      date: today,
      bankBalances: { checking: balance(checking), savings: 0, everydayCard: balance(card) },
      pendingCharges,
      oldCardBalance: 0,
      assignment: { savings: 0, needs: balance(checking) - balance(card) - pendingCharges.reduce((sum, c) => sum + (c.account === 'checking' ? c.amount : c.account === 'everyday-card' ? c.amount : 0), 0), wants: 0, momReserve: 0, heldForOthers: 0 },
      lastPaycheckDate: today,
      settings: DEFAULT_SETTINGS,
    });
    if (!setup.ok) throw new Error(`the made-up setup does not add up by ${setup.difference}`);

    // Ask the test bank to move on, until some pending charges post.
    const key = new BankKey(openKey(bank));
    let cursor = (bank.db.prepare('SELECT cursor FROM connection').get() as { cursor: string }).cursor;
    const added: PlaidTransaction[] = [];
    const modified: PlaidTransaction[] = [];
    const removed: PlaidRemovedTransaction[] = [];
    for (let round = 0; round < 8 && removed.length === 0; round += 1) {
      await bank.plaid.refreshTransactions(key);
      for (let tries = 0; tries < 20; tries += 1) {
        await wait(2_000);
        const page = await bank.plaid.syncTransactions(key, cursor, 500);
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed);
        cursor = page.next_cursor;
        if (page.added.length + page.modified.length + page.removed.length > 0 && !page.has_more) break;
      }
    }
    fact(`after the refreshes: added ${added.length}, modified ${modified.length}, removed ${removed.length}`);
    expect(removed.length).toBeGreaterThan(0);

    // What the test bank did: each removed pending charge has its posted
    // version in the same update, linked by pending_transaction_id.
    const removedIds = new Set(removed.map((r) => r.transaction_id));
    const postedFor = new Map(added.filter((t) => !t.pending && t.pending_transaction_id !== null).map((t) => [t.pending_transaction_id as string, t]));
    for (const id of removedIds) {
      const before = stored.get(id)?.raw as PlaidTransaction | undefined;
      const after = postedFor.get(id);
      fact(`removed ${before?.pending === true ? 'pending' : 'posted'} ${before?.amount} ${before?.name}; posted version ${after === undefined ? 'none' : `${after.amount} on ${after.date}`}`);
      expect(before?.pending, `${id} was pending`).toBe(true);
      expect(after, `${id} has a posted version linked to it`).toBeDefined();
      expect(after?.account_id).toBe(before?.account_id);
    }

    // What the app makes of it: each posted charge replaces its pending one
    // in the book (4.6), nothing is dropped, and a charge is counted once.
    const plan = planSync({ stored, changed: [...added, ...modified], removed: [...removedIds], roles, rules: [], book: setup.book, today, sync: 99 });
    const events: BankTransaction[] = [...plan.events];
    const postings = events.filter((e) => e.kind === 'purchase' && e.pendingId !== undefined);
    const ours = pendingCharges.filter((c) => removedIds.has(c.id)).map((c) => c.id);
    fact(`the app: ${postings.length} postings for ${ours.length} pending charges of these two accounts; ${events.filter((e) => e.kind === 'pending-dropped').length} dropped`);
    expect(postings.map((p) => (p as Purchase).pendingId).sort()).toEqual(ours.sort());
    expect(events.filter((e) => e.kind === 'pending-dropped')).toEqual([]);
    const ids = setup.book.purchases().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Rule 0.1: the test bank also sends amounts with fractions of a cent
    // (37.804077, say). The app holds those for a decision instead of rounding.
    for (const a of plan.attention) fact(`waits for a decision: ${a.what}`);
    for (const a of plan.attention) expect(a.what).toMatch(/whole number of cents|no place for it|cannot read/);
    saveRecording('user-dynamic', bank.recorded);
  });
});
