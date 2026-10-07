import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { connectTestBank } from '../src/connect.js';
import { TokenBox } from '../src/crypto/token-box.js';
import { openDatabase } from '../src/db/database.js';
import { readConnection, readItems, setAccountRoles, setBankRules } from '../src/db/store.js';
import { memoryLog, type LogLine } from '../src/log.js';
import { PlaidClient } from '../src/plaid/client.js';
import { plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';
import { syncBank } from '../src/sync/sync.js';
import { ACCOUNT_IDS, FakePlaid, fourAccounts } from './fake-plaid.js';
import { BANK_RULES, POSTED_AT_START, SETUP_DAY, TOKEN_KEY, book, dump, setUp, status, tracking, type Harness } from './harness.js';

const C = ACCOUNT_IDS.checking;
const E = ACCOUNT_IDS.everyday;

// A week of made-up activity, enough to fill several pages.
function aWeek(h: Harness): void {
  h.fake.addPosted({ id: 'w1', account: C, amount: 450, date: '2026-10-02', description: 'COFFEE SHOP' });
  h.fake.addPending({ id: 'w2', account: E, amount: 6_000, date: '2026-10-02', description: 'GROCERY OUTLET' });
  h.fake.addPosted({ id: 'w3', account: C, amount: 50_000, date: '2026-10-03', description: 'Online Banking transfer to SAV 2222' });
  h.fake.addPosted({ id: 'w4', account: ACCOUNT_IDS.savings, amount: -50_000, date: '2026-10-03', description: 'Online Banking transfer from CHK 1111' });
  h.fake.postPending('w2', { id: 'w2-posted', date: '2026-10-04', amount: 6_100 });
  h.fake.addPosted({ id: 'w5', account: C, amount: 40_000, date: '2026-10-04', description: 'Zelle payment to MOM MADEUP' });
  h.fake.addPending({ id: 'w6', account: E, amount: 7_500, date: '2026-10-05', description: 'GAS STATION HOLD' });
  h.fake.dropPending('w6');
  h.fake.addPosted({ id: 'w7', account: C, amount: 1_999, date: '2026-10-06', description: 'SOMEWHERE NEW' });
}

// What the money looks like: the book and what is waiting, not how it got there.
function money(h: Harness): unknown {
  const b = book(h);
  return { pots: b.pots(), debt: b.oldCardDebt(), review: b.reviewItems(), transit: b.inTransit(), check: status(h).selfCheck };
}

describe('sync: running it again is safe', () => {
  it('sync: a second sync with nothing new changes nothing at all', async () => {
    const h = await tracking();
    aWeek(h);
    await h.sync('2026-10-06');
    const before = dump(h.db);
    const second = await h.sync('2026-10-06');
    expect(second.changed).toBe(false);
    expect(dump(h.db)).toEqual(before);
  });

  it('sync: the same changes sent again are not counted twice', async () => {
    const h = await tracking();
    aWeek(h);
    await h.sync('2026-10-06');
    const before = money(h);
    const events = dump(h.db)['book_events'];
    // Plaid hands out every change since setup day again, as if the cursor were lost.
    const connection = readConnection(h.db);
    h.db.prepare('UPDATE connection SET cursor = ?').run('cursor-0');
    await h.sync('2026-10-07');
    expect(money(h)).toEqual(before);
    expect(dump(h.db)['book_events']).toEqual(events);
    expect(connection).not.toBeNull();
  });

  it('sync: a sync cut off partway saves nothing, and the next one ends up the same as one that was never cut off', async () => {
    const steady = await tracking();
    aWeek(steady);
    await steady.sync('2026-10-06');

    const cut = await tracking();
    aWeek(cut);
    const before = dump(cut.db);
    let calls = 0;
    cut.fake.beforeCall = (endpoint) => {
      if (endpoint === '/transactions/sync') calls += 1;
      return calls === 2 ? 'network' : undefined;
    };
    await expect(cut.sync('2026-10-06')).rejects.toThrow(/could not be reached/);
    expect(dump(cut.db)).toEqual(before);
    cut.fake.beforeCall = undefined;
    await cut.sync('2026-10-06');
    expect(money(cut)).toEqual(money(steady));
  });

  it('sync: a failure while saving saves nothing, and running it again finishes the job', async () => {
    const steady = await tracking();
    aWeek(steady);
    await steady.sync('2026-10-06');

    const h = await tracking();
    aWeek(h);
    const before = dump(h.db);
    await expect(
      h.sync('2026-10-06', {
        beforeCommit: () => {
          throw new Error('the disk filled up (made up)');
        },
      }),
    ).rejects.toThrow(/disk filled up/);
    expect(dump(h.db)).toEqual(before);
    await h.sync('2026-10-06');
    expect(money(h)).toEqual(money(steady));
  });

  it('sync: if Plaid\'s data changes while paging, paging starts over from the first page', async () => {
    const h = await tracking();
    aWeek(h);
    const start = readConnection(h.db)?.cursor;
    const callsBefore = h.fake.calls.length;
    let pages = 0;
    h.fake.beforeCall = (endpoint) => {
      if (endpoint !== '/transactions/sync') return undefined;
      pages += 1;
      // While the second page is asked for, the bank posts something new.
      if (pages === 2) h.fake.addPosted({ id: 'w8', account: C, amount: 321, date: '2026-10-06', description: 'COFFEE' });
      return undefined;
    };
    await h.sync('2026-10-06');
    expect(status(h).selfCheck).toMatchObject({ ok: true });
    const ids = book(h).purchases().map((p) => p.id);
    expect(ids.filter((id) => id === 'w8')).toHaveLength(1);
    // The first page was asked for twice: once, and again after the change.
    expect(h.fake.calls.slice(callsBefore).filter((c) => c.endpoint === '/transactions/sync' && c.body['cursor'] === start)).toHaveLength(2);
  });

  it('sync: two syncs at once count everything once', async () => {
    const h = await tracking();
    aWeek(h);
    let other: Promise<unknown> | undefined;
    h.fake.beforeCall = (endpoint) => {
      // While the first sync is still asking Plaid, a second one runs to the end.
      if (endpoint === '/accounts/get' && other === undefined) {
        h.fake.beforeCall = undefined;
        other = h.sync('2026-10-06');
      }
      return undefined;
    };
    await h.sync('2026-10-06');
    await other;
    const steady = await tracking();
    aWeek(steady);
    await steady.sync('2026-10-06');
    expect(money(h)).toEqual(money(steady));
  });

  it('10.5 when the bank wants a new login, the sync says so and changes nothing else', async () => {
    const h = await tracking();
    aWeek(h);
    h.fake.needsLogin = true;
    const result = await h.sync('2026-10-06');
    expect(result.needsLogin).toBe(true);
    expect(status(h).needsLogin).toBe(true);
    expect(book(h).purchases()).toEqual([]);
    h.fake.needsLogin = false;
    await h.sync('2026-10-07');
    expect(status(h).needsLogin).toBe(false);
    expect(status(h).selfCheck?.ok).toBe(true);
  });
});

describe('safety: the bank key', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('safety: the database file never holds the bank key, only its sealed form', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'budget-key-'));
    dirs.push(dir);
    const path = join(dir, 'budget.sqlite');
    const fake = new FakePlaid(fourAccounts(POSTED_AT_START));
    const db = openDatabase(path);
    const log = memoryLog([]);
    const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log });
    const box = new TokenBox(TOKEN_KEY);
    await connectTestBank({ db, plaid, box, log, today: SETUP_DAY, institutionId: 'ins_109508' });
    await syncBank({ db, plaid, box, log, today: SETUP_DAY });
    const sealed = readConnection(db)?.sealedKey ?? '';
    expect(box.open(sealed, fake.itemId)).toBe(fake.accessToken);
    db.close();
    const secretPart = fake.accessToken.slice('access-sandbox-'.length);
    for (const file of readdirSync(dir)) {
      const bytes = readFileSync(join(dir, file));
      expect(bytes.includes(Buffer.from(secretPart)), file).toBe(false);
      expect(bytes.includes(Buffer.from(secretPart, 'utf16le')), file).toBe(false);
    }
  });

  it('safety: nothing secret shows up in the log of a whole run, failures included', async () => {
    const h = await tracking();
    aWeek(h);
    h.fake.beforeCall = (endpoint, _body, n) => (endpoint === '/transactions/sync' && n % 2 === 0 ? 'network' : undefined);
    await h.sync('2026-10-06').catch(() => undefined);
    h.fake.beforeCall = undefined;
    h.fake.needsLogin = true;
    await h.sync('2026-10-06');
    h.fake.needsLogin = false;
    await h.sync('2026-10-06');
    const all = JSON.stringify(h.lines);
    expect(h.lines.length).toBeGreaterThan(10);
    expect(all).not.toContain(h.fake.accessToken.slice('access-sandbox-'.length));
    expect(all).not.toContain(h.fake.secret);
    expect(all).not.toContain(h.fake.clientId);
  });

  it('safety: a stored key sealed for another connection does not open', async () => {
    const h = await tracking();
    h.db.prepare("UPDATE connection SET item_id = 'item-made-up-2'").run();
    await expect(h.sync('2026-10-06')).rejects.toThrow(/cannot be opened/);
  });
});

describe('what the app does not apply waits for his decision, and the self-check shows it', () => {
  it('0.1 an amount that is not whole cents is held, not rounded', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'frac', account: C, amount: 100, date: '2026-10-02', description: 'COFFEE' });
    const raw = h.fake.changes.at(-1);
    if (raw?.type === 'added') (raw.tx as { amount: number }).amount = 1.005;
    await h.sync('2026-10-02');
    expect(readItems(h.db).get('frac')?.status).toBe('held');
    expect(status(h).attention[0]?.what).toMatch(/whole number of cents/);
  });

  it('0.5 money in another currency is held', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'cad', account: E, amount: 2_000, date: '2026-10-02', description: 'COFFEE', currency: 'CAD' });
    await h.sync('2026-10-02');
    expect(readItems(h.db).get('cad')?.status).toBe('held');
    expect(status(h).attention[0]?.what).toMatch(/not in dollars/);
  });

  it('a new description from the bank changes nothing in the book', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'shop', account: C, amount: 1_000, date: '2026-10-02', description: 'COFFEE' });
    await h.sync('2026-10-02');
    const before = money(h);
    h.fake.modify('shop', { description: 'COFFEE SHOP DOWNTOWN' });
    await h.sync('2026-10-03');
    expect(money(h)).toEqual(before);
    expect(status(h).attention).toEqual([]);
  });

  it('activity on an account that is not one of his four is left out of everything', async () => {
    const fake = new FakePlaid([...fourAccounts(POSTED_AT_START), { id: 'acct-extra', name: 'Made-up Other Savings', mask: '9999', kind: 'savings', posted: 77_700 }]);
    const db = openDatabase(':memory:');
    const lines: LogLine[] = [];
    const log = memoryLog(lines);
    const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log });
    const box = new TokenBox(TOKEN_KEY);
    await connectTestBank({ db, plaid, box, log, today: SETUP_DAY, institutionId: 'ins_109508' });
    await syncBank({ db, plaid, box, log, today: SETUP_DAY });
    setAccountRoles(db, { [ACCOUNT_IDS.checking]: 'checking', [ACCOUNT_IDS.savings]: 'savings', [ACCOUNT_IDS.everyday]: 'everyday-card', [ACCOUNT_IDS.old]: 'old-card' });
    setBankRules(db, BANK_RULES, SETUP_DAY);
    const h: Harness = { fake, db, lines, plaid, box, sync: (today) => syncBank({ db, plaid, box, log, today }) };
    expect(setUp(h).ok).toBe(true);
    fake.addPosted({ id: 'x', account: 'acct-extra', amount: 5_000, date: '2026-10-02', description: 'COFFEE' });
    await h.sync('2026-10-02');
    expect(readItems(db).get('x')?.status).toBe('skipped');
    expect(status(h).selfCheck?.ok).toBe(true);
  });
});

// QUESTIONS.md A13 and A14: the app follows the bank when it changes or takes
// back something the app already counted, so a mismatch warning always means
// something. Nothing waits for his decision, and the self-check passes.
describe('the bank changing what the app counted', () => {
  it('4.6 a pending charge whose amount changes before it posts: the new amount counts right away, in its bucket (A13)', async () => {
    const h = await tracking();
    h.fake.addPending({ id: 'tab', account: E, amount: 2_000, date: '2026-10-02', description: 'COFFEE BAR' });
    await h.sync('2026-10-02');
    const wants = book(h).pots().wants;
    h.fake.modify('tab', { amount: 2_600 });
    await h.sync('2026-10-03');
    expect(status(h).attention).toEqual([]);
    expect(status(h).selfCheck).toMatchObject({ ok: true, difference: 0 });
    expect(book(h).pots().wants).toBe(wants - 600);
    expect(book(h).purchases()).toMatchObject([{ id: 'tab', amount: 2_600, pending: true }]);
    // Lower again, by one cent, then it posts at that amount.
    h.fake.modify('tab', { amount: 2_599 });
    await h.sync('2026-10-04');
    expect(book(h).pots().wants).toBe(wants - 599);
    h.fake.postPending('tab', { id: 'tab-posted', date: '2026-10-05' });
    await h.sync('2026-10-05');
    expect(status(h).selfCheck).toMatchObject({ ok: true, difference: 0 });
    expect(book(h).pots().wants).toBe(wants - 599);
    expect(status(h).attention).toEqual([]);
  });

  it('4.10 the bank taking back a transaction the app counted: the app takes it back too, logs it, and says so (A14)', async () => {
    const h = await tracking();
    const before = book(h).pots();
    h.fake.addPosted({ id: 'twice', account: C, amount: 1_000, date: '2026-10-02', description: 'COFFEE' });
    await h.sync('2026-10-02');
    expect(book(h).pots().wants).toBe(before.wants - 1_000);
    h.fake.removePosted('twice', { keepBalance: false });
    await h.sync('2026-10-03');
    expect(status(h).attention).toEqual([]);
    expect(status(h).selfCheck).toMatchObject({ ok: true, difference: 0 });
    expect(book(h).pots()).toEqual(before);
    expect(book(h).changeLog().at(-1)).toEqual({ date: '2026-10-03', kind: 'bank-took-back', id: 'twice', description: 'COFFEE', amount: 1_000 });
    const bank = status(h).bank;
    if (bank?.ok !== true) throw new Error('no bank balances');
    expect(book(h).takeAlerts({ bankConnection: 'ok', bankBalances: bank.view.withPending })).toContainEqual({
      kind: 'bank-took-back',
      id: 'twice',
      date: '2026-10-03',
      description: 'COFFEE',
      amount: 1_000,
    });
    // Syncing again changes nothing.
    const events = dump(h.db)['book_events'];
    await h.sync('2026-10-04');
    expect(dump(h.db)['book_events']).toEqual(events);
  });

  it('4.10 a posted transaction the bank changes: the old one is taken back and the new one counted as new (A14)', async () => {
    const h = await tracking();
    const before = book(h).pots();
    h.fake.addPosted({ id: 'fix', account: C, amount: 1_000, date: '2026-10-02', description: 'COFFEE' });
    await h.sync('2026-10-02');
    h.fake.modify('fix', { amount: 1_250 });
    await h.sync('2026-10-03');
    expect(status(h).attention).toEqual([]);
    expect(status(h).selfCheck).toMatchObject({ ok: true, difference: 0 });
    expect(book(h).pots().wants).toBe(before.wants - 1_250);
    expect(book(h).changeLog().at(-1)).toMatchObject({ date: '2026-10-03', kind: 'bank-took-back', id: 'fix', amount: 1_000 });
    // Changed again, then removed: each version is taken back once.
    h.fake.modify('fix', { amount: 900 });
    await h.sync('2026-10-04');
    expect(book(h).pots().wants).toBe(before.wants - 900);
    h.fake.removePosted('fix', { keepBalance: false });
    await h.sync('2026-10-05');
    expect(book(h).pots()).toEqual(before);
    expect(status(h).selfCheck).toMatchObject({ ok: true, difference: 0 });
    expect(book(h).changeLog().flatMap((e) => (e.kind === 'bank-took-back' ? [e.amount] : []))).toEqual([1_000, 1_250, 900]);
    expect(status(h).attention).toEqual([]);
  });

  it('4.10 a card payment landing that the bank takes back: the payment is on its way again (A14, 12.5)', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'pay-out', account: C, amount: 20_000, date: '2026-10-02', description: 'Online payment to CRD 3333' });
    h.fake.addPosted({ id: 'pay-in', account: E, amount: -20_000, date: '2026-10-03', description: 'PAYMENT - THANK YOU' });
    await h.sync('2026-10-03');
    expect(book(h).inTransit().total).toBe(0);
    h.fake.removePosted('pay-in', { keepBalance: false });
    await h.sync('2026-10-04');
    expect(book(h).inTransit().total).toBe(20_000);
    expect(status(h).selfCheck).toMatchObject({ ok: true, difference: 0 });
    expect(status(h).attention).toEqual([]);
  });
});

// QUESTIONS.md A16.
describe('money leaving savings', () => {
  it('4.9 money leaving savings that no rule names waits in review as spending, and the self-check passes (A16)', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'odd', account: ACCOUNT_IDS.savings, amount: 7_500, date: '2026-10-02', description: 'WITHDRAWAL' });
    await h.sync('2026-10-02');
    expect(readItems(h.db).get('odd')?.status).toBe('sent');
    expect(status(h).attention).toEqual([]);
    expect(status(h).selfCheck).toMatchObject({ ok: true, difference: 0 });
    expect(book(h).reviewItems()).toMatchObject([{ type: 'spending', id: 'odd', amount: 7_500, reason: 'from-savings' }]);
  });

  it('12.1 a charge pending on savings counts while pending, and its posting replaces it (4.6, 4.9)', async () => {
    const h = await tracking();
    h.fake.addPending({ id: 'sav-hold', account: ACCOUNT_IDS.savings, amount: 6_000, date: '2026-10-02', description: 'BILL PAY MADE UP INSURANCE' });
    await h.sync('2026-10-02');
    expect(status(h).bank).toMatchObject({ ok: true, view: { pendingCharges: [{ account: 'savings', amount: 6_000 }] } });
    expect(status(h).selfCheck).toMatchObject({ ok: true, difference: 0 });
    expect(book(h).reviewItems()).toMatchObject([{ type: 'spending', id: 'sav-hold', amount: 6_000, reason: 'from-savings' }]);
    h.fake.postPending('sav-hold', { id: 'sav-posted', date: '2026-10-03', amount: 6_001 });
    await h.sync('2026-10-03');
    expect(status(h).selfCheck).toMatchObject({ ok: true, difference: 0 });
    expect(book(h).reviewItems()).toMatchObject([{ type: 'spending', id: 'sav-hold', amount: 6_001, reason: 'from-savings' }]);
    expect(status(h).attention).toEqual([]);
  });

  it('7.4 and 8.1 a payment to mom from savings comes out of the mom reserve, like one from checking (A16)', async () => {
    const h = await tracking();
    const reserve = book(h).pots().momReserve;
    h.fake.addPosted({ id: 'mom-sav', account: ACCOUNT_IDS.savings, amount: 30_000, date: '2026-10-02', description: 'Zelle payment to MOM MADEUP' });
    await h.sync('2026-10-02');
    expect(book(h).pots().momReserve).toBe(reserve - 30_000);
    expect(book(h).momSentInMonth('2026-10').sent).toBe(30_000);
    expect(status(h).selfCheck).toMatchObject({ ok: true, difference: 0 });
    expect(status(h).attention).toEqual([]);
  });

  it('7.4 a payment to a friend from savings waits in review as a payment to a person (A16)', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'pal', account: ACCOUNT_IDS.savings, amount: 4_000, date: '2026-10-02', description: 'Zelle payment to FRIEND MADEUP' });
    await h.sync('2026-10-02');
    expect(book(h).reviewItems()).toMatchObject([{ type: 'spending', id: 'pal', amount: 4_000, reason: 'person-payment' }]);
    expect(status(h).selfCheck).toMatchObject({ ok: true, difference: 0 });
  });
});
