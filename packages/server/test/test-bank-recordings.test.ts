// What Plaid's test bank really sent, saved (test/fixtures/test-bank-*.json),
// played back offline, so npm test keeps checking the app against the test
// bank's real answers and not only against made-up ones. The recordings were
// made by npm run test:sandbox with LIVE_RECORD set, and hold no keys.
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, startTracking, type AccountId, type Purchase } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { readPlaidItem } from '../src/bank/plaid-item.js';
import { checkBankRules } from '../src/bank/reading.js';
import { connectTestBank } from '../src/connect.js';
import { TokenBox } from '../src/crypto/token-box.js';
import { openDatabase } from '../src/db/database.js';
import { loadBook, readAccounts, setAccountRoles, setBankRules } from '../src/db/store.js';
import { memoryLog } from '../src/log.js';
import { PlaidClient } from '../src/plaid/client.js';
import { plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';
import type { PlaidAccount, PlaidRemovedTransaction, PlaidTransaction } from '../src/plaid/types.js';
import { setUpTracking, setupPreview } from '../src/setup-day.js';
import { bankStatus } from '../src/status.js';
import { planSync, type StoredItem } from '../src/sync/plan.js';
import { syncBank } from '../src/sync/sync.js';
import { TOKEN_KEY } from './harness.js';
import { REPLAY_KEYS, Replay, loadRecording } from './replay.js';

const keys = plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: REPLAY_KEYS.clientId, PLAID_SECRET: REPLAY_KEYS.secret });

describe('the test bank\'s real answers, played back', () => {
  it('accounts like his: setup day passes, the activity flows in, and the app moves by exactly the activity', async () => {
    const recording = loadRecording('test-bank-accounts-like-his.json');
    const itemId = (recording.stages[0]?.accounts as { item: { item_id: string } }).item.item_id;
    const replay = new Replay(recording, itemId);
    const db = openDatabase(':memory:');
    const log = memoryLog([]);
    const plaid = new PlaidClient(keys, { fetch: replay.fetch, log });
    const box = new TokenBox(TOKEN_KEY);
    await connectTestBank({ db, plaid, box, log, today: '2026-10-07', institutionId: 'ins_109508' });
    await syncBank({ db, plaid, box, log, today: '2026-10-07' });
    const masks: Record<string, AccountId> = { '1111': 'checking', '2222': 'savings', '3333': 'everyday-card', '4444': 'old-card' };
    setAccountRoles(db, Object.fromEntries(readAccounts(db).map((a) => [a.plaidAccountId, masks[a.raw.mask ?? ''] ?? null])));
    setBankRules(
      db,
      checkBankRules([
        { id: '1', account: 'checking', contains: 'transfer to SAV 2222', means: 'transfer', other: 'savings' },
        { id: '2', account: 'savings', contains: 'transfer from CHK 1111', means: 'transfer', other: 'checking' },
        { id: '3', account: 'checking', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' },
        { id: '4', account: 'checking', contains: 'payment to CRD 4444', means: 'transfer', other: 'old-card' },
        { id: '5', account: 'everyday-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
        { id: '6', account: 'old-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
        { id: '7', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' },
      ]),
      '2026-10-07',
    );
    const preview = setupPreview(db, []);
    // (3,000.00 - 25.50) + 5,000.00 - (450.00 + 60.00) = 7,464.50
    expect(preview.startingMoney).toBe(746_450);
    const outcome = setUpTracking(db, {
      today: '2026-10-07',
      assignment: { savings: 500_000, momReserve: 100_000, wants: 20_000, heldForOthers: 0, needs: 746_450 - 620_000 },
      lastPaycheckDate: '2026-09-25',
      settings: { ...DEFAULT_SETTINGS, paycheckRule: { contains: 'MADEUP CORP PAYROLL' }, momRule: { contains: 'Zelle payment to MOM MADEUP' }, leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } },
      rules: [{ id: 'coffee', for: 'purchase', contains: 'COFFEE', bucket: 'wants' }],
      inTransit: [],
    });
    expect(outcome.ok).toBe(true);
    expect(bankStatus(db).selfCheck).toMatchObject({ ok: true, bankSide: 746_450 });

    replay.stage = 1;
    await syncBank({ db, plaid, box, log, today: '2026-10-07' });
    const status = bankStatus(db);
    const book = loadBook(db);
    expect(status.attention).toEqual([]);
    expect(status.inTransit).toEqual({ total: 0, items: [] });
    expect(book?.paychecks().map((p) => p.amount)).toEqual([250_000]);
    expect(book?.momSentInMonth('2026-10').sent).toBe(20_000);
    // The app moved by exactly what the ten transactions say; the test bank's
    // balances did not move at all.
    const activity = 197_050 + 10_000 + 15_999;
    expect(status.selfCheck).toMatchObject({ bankSide: 746_450, appSide: 746_450 + activity, difference: -activity });
  });

  it('4.6 a refresh that posts pending charges: each posted charge replaces its pending one, and nothing is counted twice', () => {
    const saved = JSON.parse(readFileSync(new URL('fixtures/test-bank-pending-posts.json', import.meta.url), 'utf8')) as {
      accounts: PlaidAccount[];
      history: PlaidTransaction[];
      update: { added: PlaidTransaction[]; modified: PlaidTransaction[]; removed: PlaidRemovedTransaction[] };
    };
    const [checking, card] = saved.accounts;
    if (checking === undefined || card === undefined) throw new Error('the recording has no checking account or card');
    const roles = new Map<string, AccountId>([
      [checking.account_id, 'checking'],
      [card.account_id, 'everyday-card'],
    ]);
    // Setup day with the pending charges counted (A10).
    const stored = new Map<string, StoredItem>();
    const pendingCharges: Purchase[] = [];
    for (const raw of saved.history) {
      const read = readPlaidItem(raw);
      if (!read.ok) throw new Error(read.why);
      const role = roles.get(read.item.accountId);
      if (role === undefined || role === 'savings') continue;
      pendingCharges.push({ kind: 'purchase', id: read.item.id, account: role, date: read.item.day, amount: read.item.amount, description: read.item.description, pending: true });
      stored.set(read.item.id, {
        transactionId: read.item.id,
        accountId: read.item.accountId,
        raw,
        pending: true,
        amountCents: read.item.amount,
        removed: false,
        status: 'sent',
        kind: 'purchase',
        bookId: read.item.id,
        replacedBy: null,
        firstSync: 1,
        lastSync: 1,
      });
    }
    const cents = (a: PlaidAccount): number => Math.round((a.balances.current ?? 0) * 100);
    const pendingTotal = pendingCharges.reduce((sum, c) => sum + c.amount, 0);
    const setup = startTracking({
      date: '2026-10-07',
      bankBalances: { checking: cents(checking), savings: 0, everydayCard: cents(card) },
      pendingCharges,
      oldCardBalance: 0,
      assignment: { savings: 0, needs: cents(checking) - cents(card) - pendingTotal, wants: 0, momReserve: 0, heldForOthers: 0 },
      lastPaycheckDate: '2026-10-07',
      settings: DEFAULT_SETTINGS,
    });
    if (!setup.ok) throw new Error('the setup does not add up');
    const removed = saved.update.removed.map((r) => r.transaction_id);
    const plan = planSync({ stored, changed: [...saved.update.added, ...saved.update.modified], removed, roles, rules: [], book: setup.book, today: '2026-10-07', sync: 2 });
    // The test bank removed each pending charge and added its posted version,
    // linked to it, in the same update.
    expect(removed.sort()).toEqual(pendingCharges.map((c) => c.id).sort());
    const postings = plan.events.filter((e): e is Purchase => e.kind === 'purchase' && e.pendingId !== undefined);
    expect(postings.map((p) => p.pendingId).sort()).toEqual(removed.sort());
    expect(plan.events.filter((e) => e.kind === 'pending-dropped')).toEqual([]);
    // Each posted charge was counted at setup at the same amount, so no bucket moved for them.
    for (const p of postings) expect(p.amount).toBe(pendingCharges.find((c) => c.id === p.pendingId)?.amount);
    const ids = setup.book.purchases().map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The new pending charges count once each (4.6), and the one the test
    // bank sent in fractions of a cent (38.38955) waits for a decision (0.1).
    expect(plan.events.filter((e) => e.kind === 'purchase' && e.pending).map((e) => ('amount' in e ? e.amount : 0)).sort((a, b) => a - b)).toEqual([1_377, 1_696, 5_100, 23_850, 30_600]);
    expect(plan.attention.map((a) => a.what)).toEqual(['the bank sent something the app cannot read: amount is not a whole number of cents: 38.38955']);
  });
});
