import { DEFAULT_SETTINGS, addDays, type AccountId } from '@budget-app/money';
import { beforeAll, describe, expect, it } from 'vitest';
import { centsFromPlaid } from '../src/bank/amounts.js';
import { checkBankRules } from '../src/bank/reading.js';
import { loadBook, readAccounts, readItems, setAccountRoles, setBankRules } from '../src/db/store.js';
import { BankKey } from '../src/plaid/client.js';
import type { PlaidAccount, PlaidTransaction } from '../src/plaid/types.js';
import { setUpTracking, setupPreview } from '../src/setup-day.js';
import { bankStatus } from '../src/status.js';
import { accountsLikeHis, connectLive, fact, openKey, saveRecording, syncUntilHistory, todayUtc, wait, type LiveBank } from './test-bank.js';

// Plaid's test bank, with made-up accounts shaped like his: one checking, one
// savings, two cards. Checked against what the test bank really returns, not
// against what the app assumes: amount signs, pending charges and balances
// (B36), card statements, both halves of a transfer, and the self-check
// against the test bank's own balances.
//
// Plaid's test bank never moves an account's balance when transactions are
// added: Plaid's own words are that its "transaction history may show income
// and outflow inconsistent with the balance shown on the account". So the
// self-check against the test bank's balances can pass on setup day. After
// new activity it can only show the activity itself: the app's totals move
// by exactly what the activity says, and the test bank's do not move at all.
const today = todayUtc();
const MASKS: Record<string, AccountId> = { '1111': 'checking', '2222': 'savings', '3333': 'everyday-card', '4444': 'old-card' };

let bank: LiveBank;
const accountOf = (role: AccountId): PlaidAccount => {
  const account = readAccounts(bank.db).find((a) => a.role === role);
  if (account === undefined) throw new Error(`no ${role} account`);
  return account.raw;
};
const items = (): PlaidTransaction[] => [...readItems(bank.db).values()].map((i) => i.raw as PlaidTransaction);
const find = (role: AccountId, text: string): PlaidTransaction[] =>
  items().filter((t) => t.account_id === accountOf(role).account_id && (t.original_description ?? t.name).includes(text));
const cents = (n: number | null): number | null => (n === null ? null : centsFromPlaid(n));

describe('the test bank, with accounts like his', () => {
  beforeAll(async () => {
    bank = await connectLive({ username: 'user_custom', password: accountsLikeHis(today), today });
    await syncUntilHistory(bank, today);
    setAccountRoles(bank.db, Object.fromEntries(readAccounts(bank.db).map((a) => [a.plaidAccountId, MASKS[a.raw.mask ?? ''] ?? null])));
  });

  it('his four accounts: one checking, one savings, two cards', () => {
    const accounts = readAccounts(bank.db);
    for (const a of accounts) fact(`${a.raw.name} (${a.raw.type}, ${a.raw.subtype}, mask ${a.raw.mask}): current ${a.raw.balances.current}, available ${a.raw.balances.available}, limit ${a.raw.balances.limit}`);
    expect(accounts.map((a) => a.role).sort()).toEqual(['checking', 'everyday-card', 'old-card', 'savings']);
    expect(accountOf('checking')).toMatchObject({ type: 'depository', subtype: 'checking' });
    expect(accountOf('savings')).toMatchObject({ type: 'depository', subtype: 'savings' });
    expect(accountOf('everyday-card')).toMatchObject({ type: 'credit', subtype: 'credit card' });
    expect(accountOf('old-card')).toMatchObject({ type: 'credit', subtype: 'credit card' });
  });

  it('amount signs: money out is positive and money in is negative, on every account', () => {
    for (const t of items()) fact(`${t.date} ${t.pending ? 'pending' : 'posted '} ${String(t.amount).padStart(9)} ${t.original_description ?? t.name}, authorized ${t.authorized_date}`);
    expect(find('checking', 'PAYROLL').map((t) => t.amount)).toEqual([-2500]);
    expect(find('checking', 'GROCERY OUTLET').map((t) => t.amount)).toEqual([45.67]);
    expect(find('savings', 'INTEREST EARNED').map((t) => t.amount)).toEqual([-1.23]);
    expect(find('everyday-card', 'COFFEE SHOP').map((t) => t.amount)).toEqual([12.34]);
  });

  it('4.1 a posted purchase keeps the day it was made in authorized_date; its date is the day it posted', () => {
    const groceries = find('checking', 'GROCERY OUTLET')[0];
    expect(groceries?.authorized_date).toBe(addDays(today, -6));
    expect(groceries?.date).toBe(addDays(today, -5));
  });

  it('B36 a pending charge is pending, and is in the available balance but not the posted one', () => {
    const gas = find('checking', 'GAS STATION');
    const card = find('everyday-card', 'GROCERY OUTLET');
    expect(gas.map((t) => [t.pending, t.amount])).toEqual([[true, 25.5]]);
    expect(card.map((t) => [t.pending, t.amount])).toEqual([[true, 60]]);
    const checking = accountOf('checking').balances;
    const everyday = accountOf('everyday-card').balances;
    fact(`checking: current ${checking.current}, available ${checking.available}; pending out 25.50`);
    fact(`everyday card: current ${everyday.current}, available ${everyday.available}, limit ${everyday.limit}; pending out 60.00`);
    // Plaid: for a bank account, available = current - pending money out;
    // for a card, available = limit - current - pending money out. So
    // current, which the app uses, leaves pending charges out, and the app
    // adds them (12.1).
    expect(cents(checking.available)).toBe((cents(checking.current) ?? 0) - 2_550);
    expect(cents(everyday.available)).toBe((cents(everyday.limit) ?? 0) - (cents(everyday.current) ?? 0) - 6_000);
  });

  it('9.1 the made-up cards come with a minimum payment but no statement balance or due date, and the app says so', () => {
    const statements = bankStatus(bank.db).statements;
    for (const s of statements) fact(`${s.card} statement: ${JSON.stringify(s.result)}`);
    expect(statements.map((s) => s.card)).toEqual(['everyday-card', 'old-card']);
    // A test user with made-up accounts can set only the minimum and the
    // last payment. plaid-test-users.live.ts reads a full statement.
    for (const s of statements) expect(s.result, s.card).toEqual({ ok: false, why: 'the bank did not give the statement date' });
  });

  it('14 setup day: the starting money adds up, and the self-check passes against the test bank, pending charges included', () => {
    setBankRules(
      bank.db,
      checkBankRules([
        { id: '1', account: 'checking', contains: 'transfer to SAV 2222', means: 'transfer', other: 'savings' },
        { id: '2', account: 'savings', contains: 'transfer from CHK 1111', means: 'transfer', other: 'checking' },
        { id: '3', account: 'checking', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' },
        { id: '4', account: 'checking', contains: 'payment to CRD 4444', means: 'transfer', other: 'old-card' },
        { id: '5', account: 'everyday-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
        { id: '6', account: 'old-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
        { id: '7', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' },
        { id: '8', account: 'everyday-card', contains: 'INTEREST', means: 'card-interest' },
        { id: '9', account: 'old-card', contains: 'INTEREST', means: 'card-interest' },
      ]),
      today,
    );
    const preview = setupPreview(bank.db, []);
    fact(`starting money ${preview.startingMoney / 100}; posted ${JSON.stringify(preview.posted)}; pending ${preview.pendingCharges.map((c) => `${c.account} ${c.amount / 100}`).join(', ')}`);
    // (3,000.00 - 25.50) + 5,000.00 - (450.00 + 60.00) = 7,464.50
    expect(preview.startingMoney).toBe(746_450);
    const savings = preview.posted.savings;
    const outcome = setUpTracking(bank.db, {
      today,
      assignment: { savings, momReserve: 100_000, wants: 20_000, heldForOthers: 0, needs: preview.startingMoney - savings - 120_000 },
      lastPaycheckDate: addDays(today, -12),
      settings: {
        ...DEFAULT_SETTINGS,
        paycheckRule: { contains: 'MADEUP CORP PAYROLL' },
        momRule: { contains: 'Zelle payment to MOM MADEUP' },
        leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' },
      },
      rules: [
        { id: 'coffee', for: 'purchase', contains: 'COFFEE', bucket: 'wants' },
        { id: 'groceries', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
        { id: 'gas', for: 'purchase', contains: 'GAS STATION', bucket: 'needs' },
      ],
      inTransit: [],
    });
    expect(outcome.ok).toBe(true);
    const check = bankStatus(bank.db).selfCheck;
    fact(`self-check on setup day: ${JSON.stringify(check)}`);
    expect(check).toMatchObject({ ok: true, difference: 0, bankSide: 746_450 });
  });

  it('new activity flows in: purchases, a paycheck, mom, a refund, and transfers seen as both halves', async () => {
    const key = new BankKey(openKey(bank));
    const id = (role: AccountId): string => accountOf(role).account_id;
    const tx = (role: AccountId, amount: number, description: string): { account_id: string; date_transacted: string; date_posted: string; amount: number; description: string } => ({
      account_id: id(role),
      date_transacted: today,
      date_posted: today,
      amount,
      description,
    });
    await bank.plaid.createSandboxTransactions(key, [
      tx('checking', 4.5, 'COFFEE SHOP 5'),
      tx('checking', -2500, 'MADEUP CORP PAYROLL'),
      tx('checking', 200, 'Zelle payment to MOM MADEUP'),
      tx('checking', 100, 'Online Banking transfer to SAV 2222'),
      tx('savings', -100, 'Online Banking transfer from CHK 1111'),
      tx('checking', 150, 'Online payment to CRD 3333'),
      tx('everyday-card', -150, 'PAYMENT - THANK YOU'),
      tx('everyday-card', -9.99, 'STORE RETURN'),
      tx('checking', 75, 'Online payment to CRD 4444'),
      tx('old-card', -75, 'PAYMENT - THANK YOU'),
    ]);
    // The test bank takes a few seconds to show them.
    let seen = 0;
    for (let tries = 0; tries < 30 && seen < 10; tries += 1) {
      if (tries === 10) await bank.plaid.refreshTransactions(key);
      await bank.sync(today);
      seen = items().filter((t) => t.date === today && !t.pending).length;
      if (seen < 10) await wait(3_000);
    }
    fact(`new transactions seen: ${seen}`);
    expect(seen).toBe(10);
    // Both halves of each transfer, on the right accounts, with opposite signs.
    expect(find('checking', 'transfer to SAV 2222').map((t) => t.amount)).toEqual([100]);
    expect(find('savings', 'transfer from CHK 1111').map((t) => t.amount)).toEqual([-100]);
    expect(find('checking', 'payment to CRD 3333').map((t) => t.amount)).toEqual([150]);
    expect(find('everyday-card', 'PAYMENT - THANK YOU').map((t) => t.amount)).toEqual([-150]);
    expect(find('checking', 'payment to CRD 4444').map((t) => t.amount)).toEqual([75]);
    expect(find('old-card', 'PAYMENT - THANK YOU').map((t) => t.amount)).toEqual([-75]);
    const status = bankStatus(bank.db);
    fact(`in transit after the transfers: ${JSON.stringify(status.inTransit)}`);
    expect(status.inTransit).toEqual({ total: 0, items: [] });
    for (const a of readAccounts(bank.db)) fact(`after the activity, ${a.raw.name}: current ${a.raw.balances.current}, available ${a.raw.balances.available}`);
    const book = loadBook(bank.db);
    fact(`buckets: ${JSON.stringify(book?.pots())}; old card debt ${book?.oldCardDebt()}; waiting in review ${book?.reviewItems().length}`);
    // The paycheck split (3.1), mom came out of the reserve (8.1), the refund waits (4.5).
    expect(book?.paychecks().map((p) => p.amount)).toEqual([250_000]);
    expect(book?.momSentInMonth(today.slice(0, 7)).sent).toBe(20_000);
    expect(book?.reviewItems().map((r) => [r.type, 'amount' in r ? r.amount : null])).toEqual([['money-in', 999]]);
  });

  it('12.3 the app\'s totals move by exactly what the activity says; the test bank\'s balances do not move', () => {
    const status = bankStatus(bank.db);
    fact(`self-check after the activity: ${JSON.stringify(status.selfCheck)}`);
    fact(`old card: ${JSON.stringify(status.oldCard)}`);
    expect(status.attention).toEqual([]);
    // What the ten new transactions do to checking + savings - everyday card:
    //   checking  +2,500.00 - 4.50 - 200.00 - 100.00 - 150.00 - 75.00 = +1,970.50
    //   savings   +100.00
    //   everyday  owes 150.00 + 9.99 less:                            +159.99
    const activity = 197_050 + 10_000 + 15_999;
    expect(status.selfCheck?.appSide).toBe(746_450 + activity);
    expect(status.selfCheck?.inTransit).toBe(0);
    // The test bank shows the same balances as on setup day, so the self-check
    // is off by exactly the new activity. A bank that moved its balances would
    // put it at zero, as the made-up bank in the offline tests does.
    expect(status.selfCheck?.bankSide).toBe(746_450);
    expect(status.selfCheck?.difference).toBe(-activity);
    // The old card the same way: the app took the 75.00 payment off the debt.
    expect(status.oldCard).toEqual({ book: 292_500, bank: 300_000, difference: 7_500 });
  });

  it('sync: running it again changes nothing', async () => {
    const snapshot = (): string =>
      JSON.stringify(['bank_items', 'book_events', 'accounts', 'statements', 'attention', 'connection', 'syncs'].map((t) => bank.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
    const before = snapshot();
    const result = await bank.sync(today);
    expect(result.changed).toBe(false);
    expect(snapshot()).toBe(before);
  });

  it('safety: the bank key never reached the log, and the database holds it only sealed', () => {
    const key = openKey(bank);
    const secretPart = key.slice('access-sandbox-'.length);
    expect(key.startsWith('access-sandbox-')).toBe(true);
    expect(JSON.stringify(bank.lines)).not.toContain(secretPart);
    expect(JSON.stringify(bank.lines)).not.toContain(bank.keys.secret);
    expect(JSON.stringify(bank.recorded)).not.toContain(secretPart);
    expect(JSON.stringify(bank.db.prepare('SELECT * FROM connection').all())).not.toContain(secretPart);
    saveRecording('accounts-like-his', bank.recorded);
  });
});
