import { describe, expect, it } from 'vitest';
import { connectQuestion } from '../src/bank-desk.js';
import { TokenBox } from '../src/crypto/token-box.js';
import { openDatabase } from '../src/db/database.js';
import { readAccounts, readConnection, setAccountRoles } from '../src/db/store.js';
import { Keeper, type SyncBank } from '../src/history/keeper.js';
import { memoryLog, type LogLine } from '../src/log.js';
import { PlaidClient } from '../src/plaid/client.js';
import { plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';
import { serverLinesIn } from '../src/server-log.js';
import { ACCOUNT_IDS, FakePlaid, fourAccounts } from './fake-plaid.js';
import { POSTED_AT_START, TOKEN_KEY } from './harness.js';
import { noonInNewYork } from './keeper-harness.js';

// Rules 1.1 to 1.3 (QUESTIONS.md A46), on the server: connecting the bank,
// which account is which, and logging in to the bank again. Against the
// made-up bank (fake-plaid.ts): Plaid Link itself is the browser's, so here
// its answer is the made-up bank's link key. Every name and number is made up.

const PICKS = { checking: ACCOUNT_IDS.checking, savings: ACCOUNT_IDS.savings, 'everyday-card': ACCOUNT_IDS.everyday, 'old-card': ACCOUNT_IDS.old } as const;

function fresh(accounts = fourAccounts(POSTED_AT_START)) {
  const db = openDatabase(':memory:');
  const fake = new FakePlaid(accounts);
  const lines: LogLine[] = [];
  const log = memoryLog(lines, [fake.clientId, fake.secret]);
  const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log });
  const box = new TokenBox(TOKEN_KEY);
  const life = { now: noonInNewYork('2026-10-01') };
  const keeper = Keeper.open({ db, now: () => life.now, log });
  const bank: SyncBank = { plaid, box, log, pageSize: 3 };
  const desk = keeper.bankDesk(bank);
  const asked = (endpoint: string): number => fake.calls.filter((c) => c.endpoint === endpoint).length;
  return { db, fake, keeper, desk, bank, lines, box, life, asked };
}

async function connectedFresh(accounts = fourAccounts(POSTED_AT_START)) {
  const f = fresh(accounts);
  expect(await f.desk.link({ mode: 'connect', yes: true })).toMatchObject({ ok: true });
  expect(await f.desk.connected({ publicToken: f.fake.publicToken })).toMatchObject({ ok: true });
  return f;
}

describe('1.1 connecting the bank', () => {
  it('1.1 with nothing connected the screen offers to connect, on the test bank here', () => {
    const { desk } = fresh();
    expect(desk.view()).toEqual({ state: 'none', bank: 'test' });
  });

  it('1.1 connecting asks first: without his yes no link key is made, and nothing is asked of the bank', async () => {
    const { desk, fake } = fresh();
    const answer = await desk.link({ mode: 'connect', yes: false });
    expect(answer).toMatchObject({ ok: false, code: 'needs-yes' });
    // The test bank (the rehearsal): free.
    expect(answer.ok ? '' : answer.why).toBe(connectQuestion('test'));
    expect(connectQuestion('test')).toBe("Connecting to Plaid's test bank is free: it uses none of your 10 real connections. Connect the bank?");
    // The real bank: 1 of the 10, and gone for good once removed.
    expect(connectQuestion('real')).toBe('Connecting uses 1 of the 10 connections Plaid allows, and one that is removed never comes back. Connect the bank?');
    expect(fake.calls).toEqual([]);
  });

  it('1.1 with his yes: a link key for a new connection, 90 days of transactions and card statements; nothing is connected yet', async () => {
    const { desk, fake, db } = fresh();
    const answer = await desk.link({ mode: 'connect', yes: true });
    expect(answer).toMatchObject({ ok: true });
    expect(answer.ok && answer.linkToken.startsWith('link-sandbox-')).toBe(true);
    expect(fake.calls.map((c) => c.endpoint)).toEqual(['/link/token/create']);
    expect(fake.calls[0]?.body).toMatchObject({ products: ['transactions', 'liabilities'], transactions: { days_requested: 90 } });
    expect(fake.calls[0]?.body).not.toHaveProperty('access_token');
    expect(readConnection(db)).toBeNull();
  });

  it('1.1 once Link hands back the bank\'s answer the connection is kept at once, sealed; the accounts are listed with none picked', async () => {
    const { desk, db, fake, box } = await connectedFresh();
    const connection = readConnection(db);
    expect(connection?.itemId).toBe(fake.itemId);
    expect(connection?.sealedKey).not.toContain(fake.accessToken);
    expect(box.open(connection?.sealedKey ?? '', fake.itemId)).toBe(fake.accessToken);
    const view = desk.view();
    expect(view).toMatchObject({ state: 'connected', bank: 'test', connectedOn: '2026-10-01', needsLogin: false, rolesSet: false, rolesFixed: false });
    expect(view.state === 'connected' ? view.accounts.map((a) => [a.id, a.name, a.mask, a.kind, a.role]).sort() : []).toEqual([
      [ACCOUNT_IDS.checking, 'Made-up Checking', '1111', 'depository checking', null],
      [ACCOUNT_IDS.everyday, 'Made-up Everyday Card', '3333', 'credit credit card', null],
      [ACCOUNT_IDS.old, 'Made-up Old Card', '4444', 'credit credit card', null],
      [ACCOUNT_IDS.savings, 'Made-up Savings', '2222', 'depository savings', null],
    ]);
    // The view and the log never hold the bank key or the link key.
    expect(JSON.stringify(view)).not.toContain(fake.accessToken);
    expect(JSON.stringify(view)).not.toContain(fake.publicToken);
  });

  it('1.1 there is only ever one connection: Connect is refused once there is one, and a second answer from Link is never exchanged', async () => {
    const { desk, fake } = await connectedFresh();
    const exchanges = (): number => fake.calls.filter((c) => c.endpoint === '/item/public_token/exchange').length;
    expect(exchanges()).toBe(1);
    expect(await desk.link({ mode: 'connect', yes: true })).toMatchObject({ ok: false, code: 'connected-already' });
    expect(await desk.connected({ publicToken: fake.publicToken })).toMatchObject({ ok: false, code: 'connected-already' });
    expect(exchanges()).toBe(1);
    expect(fake.calls.filter((c) => c.endpoint === '/link/token/create')).toHaveLength(1);
  });

  it('1.1 two answers from Link at once (a double tap) make one connection and one exchange', async () => {
    const { desk, fake, db } = fresh();
    await desk.link({ mode: 'connect', yes: true });
    const [a, b] = await Promise.all([desk.connected({ publicToken: fake.publicToken }), desk.connected({ publicToken: fake.publicToken })]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ code: expect.stringMatching(/^(busy|connected-already)$/) });
    expect(fake.calls.filter((c) => c.endpoint === '/item/public_token/exchange')).toHaveLength(1);
    expect(readConnection(db)).not.toBeNull();
  });

  it('1.1 an answer the bank does not take keeps nothing, and says so', async () => {
    const { desk, db } = fresh();
    for (const publicToken of ['public-sandbox-not-this-one', ['public', 'production', '0f1e2d3c'].join('-'), 'nonsense']) {
      expect(await desk.connected({ publicToken }), publicToken).toMatchObject({ ok: false, code: 'bank-said-no' });
    }
    expect(readConnection(db)).toBeNull();
    expect(readAccounts(db)).toEqual([]);
  });

  it('1.1 13.5 connecting is in the change log, dated', async () => {
    const { db } = await connectedFresh();
    expect(serverLinesIn(db)).toContainEqual(expect.objectContaining({ date: '2026-10-01', action: 'bank-connected' }));
  });

  it('1.1 if the accounts cannot be read right after, the connection is kept all the same, and they are read on the next look', async () => {
    const f = fresh();
    await f.desk.link({ mode: 'connect', yes: true });
    f.fake.beforeCall = (endpoint) => (endpoint === '/accounts/get' ? 'network' : undefined);
    expect(await f.desk.connected({ publicToken: f.fake.publicToken })).toMatchObject({ ok: true });
    expect(readConnection(f.db)).not.toBeNull();
    expect(f.desk.view()).toMatchObject({ state: 'connected', accounts: [] });
    f.fake.beforeCall = undefined;
    expect(await f.desk.read()).toMatchObject({ ok: true });
    expect(f.desk.view()).toMatchObject({ state: 'connected', accounts: expect.arrayContaining([expect.objectContaining({ id: ACCOUNT_IDS.old })]) });
  });
});

describe('1.2 which account is which', () => {
  it('1.2 nothing is read from the bank until all four are picked: no sync is due, and a sync is refused', async () => {
    const { keeper, bank, asked } = await connectedFresh();
    expect(keeper.syncDueIn()).toBeNull();
    await expect(keeper.sync(bank)).rejects.toThrow(/not all picked/);
    expect(asked('/transactions/sync')).toBe(0);
  });

  it('1.2 all four means all four: with three picked, or one, nothing is read, no sync is due, and the screen asks for the rest', async () => {
    // The screen sends the four together; a book with fewer is written
    // straight to the database, as a check on the rule itself.
    const { keeper, bank, desk, db, asked } = await connectedFresh();
    for (const picked of [{ [PICKS.checking]: 'checking', [PICKS.savings]: 'savings', [PICKS['everyday-card']]: 'everyday-card' }, { [PICKS.checking]: 'checking' }] as const) {
      setAccountRoles(db, picked);
      expect(keeper.syncDueIn(), JSON.stringify(picked)).toBeNull();
      await expect(keeper.sync(bank)).rejects.toThrow(/not all picked/);
      expect(desk.view()).toMatchObject({ rolesSet: false });
      expect(await desk.read()).toMatchObject({ ok: true, said: 'The accounts were read. Now say which account is which.' });
    }
    expect(asked('/transactions/sync')).toBe(0);
  });

  it('1.2 asks first, then each of the four is kept by the bank\'s own account id, and the bank is read', async () => {
    const { desk, db, keeper, asked } = await connectedFresh();
    expect(desk.roles({ roles: PICKS, yes: false })).toMatchObject({ ok: false, code: 'needs-yes' });
    expect(readAccounts(db).every((a) => a.role === null)).toBe(true);
    expect(desk.roles({ roles: PICKS, yes: true })).toMatchObject({ ok: true });
    expect(Object.fromEntries(readAccounts(db).map((a) => [a.role, a.plaidAccountId]))).toEqual(PICKS);
    expect(desk.view()).toMatchObject({ rolesSet: true, rolesFixed: false });
    expect(keeper.syncDueIn()).toBe(0);
    expect(await desk.read()).toMatchObject({ ok: true });
    expect(asked('/transactions/sync')).toBeGreaterThan(0);
  });

  it('1.2 13.5 the accounts picked are in the change log, by name and last digits', async () => {
    const { desk, db } = await connectedFresh();
    desk.roles({ roles: PICKS, yes: true });
    const line = serverLinesIn(db).find((l) => l.action === 'bank-accounts');
    expect(line).toMatchObject({ date: '2026-10-01', accounts: { checking: 'Made-up Checking ••1111', savings: 'Made-up Savings ••2222', 'everyday-card': 'Made-up Everyday Card ••3333', 'old-card': 'Made-up Old Card ••4444' } });
  });

  it('1.2 a pick that leaves one out, picks one account twice, or names an account the bank did not send is refused, and nothing changes', async () => {
    const { desk, db } = await connectedFresh();
    const bad: Record<string, string>[] = [
      { checking: ACCOUNT_IDS.checking, savings: ACCOUNT_IDS.savings, 'everyday-card': ACCOUNT_IDS.everyday },
      { ...PICKS, 'old-card': ACCOUNT_IDS.everyday },
      { ...PICKS, savings: 'acct-not-at-the-bank' },
      { ...PICKS, brokerage: 'acct-savings' },
      { ...PICKS, checking: '' },
    ];
    for (const roles of bad) {
      const answer = desk.roles({ roles: roles as typeof PICKS, yes: true });
      expect(answer, JSON.stringify(roles)).toMatchObject({ ok: false, code: 'not-roles' });
    }
    expect(readAccounts(db).every((a) => a.role === null)).toBe(true);
    expect(serverLinesIn(db).filter((l) => l.action === 'bank-accounts')).toEqual([]);
  });

  it('1.2 an account that is none of the four is never read: it stays unpicked, and setup day counts only the four', async () => {
    const extra = { id: 'acct-brokerage', name: 'Made-up Brokerage', mask: '5555', kind: 'savings' as const, posted: 1_234_500 };
    const { desk, keeper, fake } = await connectedFresh([...fourAccounts(POSTED_AT_START), extra]);
    fake.addPosted({ id: 'brokerage-1', account: extra.id, amount: -77_700, date: '2026-09-30', description: 'MADE UP DIVIDEND' });
    desk.roles({ roles: PICKS, yes: true });
    await desk.read();
    const view = desk.view();
    expect(view.state === 'connected' ? view.accounts.find((a) => a.id === extra.id)?.role : 'missing').toBeNull();
    const setup = keeper.setupView();
    expect(setup).toMatchObject({ state: 'not-set-up', ready: true });
    // Checking + savings - everyday card (12.1, 14.2): the made-up brokerage is not in it.
    expect(setup.state === 'not-set-up' && setup.ready ? setup.startingMoney : null).toBe(POSTED_AT_START.checking + POSTED_AT_START.savings - POSTED_AT_START.everyday);
  });

  it('1.2 they can be picked again before tracking starts, and once it starts they cannot change', async () => {
    const { desk, keeper } = await connectedFresh();
    desk.roles({ roles: PICKS, yes: true });
    expect(desk.roles({ roles: { ...PICKS, checking: ACCOUNT_IDS.savings, savings: ACCOUNT_IDS.checking }, yes: true })).toMatchObject({ ok: true });
    desk.roles({ roles: PICKS, yes: true });
    await desk.read();
    // Setup day, through its desk: tracking starts.
    const { setUpThroughTheDesk } = await import('./keeper-harness.js');
    setUpThroughTheDesk({ keeper } as Parameters<typeof setUpThroughTheDesk>[0]);
    expect(keeper.book()).not.toBeNull();
    expect(desk.view()).toMatchObject({ rolesFixed: true });
    expect(desk.roles({ roles: PICKS, yes: true })).toMatchObject({ ok: false, code: 'roles-fixed' });
  });
});

describe('1.3 logging in to the bank again', () => {
  async function picked() {
    const f = await connectedFresh();
    f.desk.roles({ roles: PICKS, yes: true });
    await f.desk.read();
    return f;
  }

  it('1.3 offered only with a connection: before one, it is refused and nothing is asked of the bank', async () => {
    const { desk, fake } = fresh();
    expect(await desk.link({ mode: 'login-again' })).toMatchObject({ ok: false, code: 'not-connected' });
    expect(fake.calls).toEqual([]);
  });

  it('1.3 its link key is for the same connection: the bank key, no products, a missing account can be added; it asks no yes (no new connection)', async () => {
    const { desk, fake } = await picked();
    const before = fake.calls.length;
    const answer = await desk.link({ mode: 'login-again' });
    expect(answer).toMatchObject({ ok: true });
    const call = fake.calls.slice(before).find((c) => c.endpoint === '/link/token/create');
    expect(call?.body).toMatchObject({ access_token: fake.accessToken, update: { account_selection_enabled: true } });
    expect(call?.body).not.toHaveProperty('products');
  });

  it('1.3 10.5 after logging in again the bank is read: the login is no longer asked for, nothing already read changes, and no second connection is made', async () => {
    const { desk, keeper, bank, fake, db } = await picked();
    fake.needsLogin = true;
    await keeper.sync(bank);
    expect(desk.view()).toMatchObject({ needsLogin: true });
    const items = db.prepare('SELECT transaction_id, raw FROM bank_items ORDER BY transaction_id').all();
    const exchanges = fake.calls.filter((c) => c.endpoint === '/item/public_token/exchange').length;
    expect(await desk.link({ mode: 'login-again' })).toMatchObject({ ok: true });
    // He logs in on the bank's own screen (Link, update mode); the bank takes it.
    fake.needsLogin = false;
    expect(await desk.read({ loggedInAgain: true })).toMatchObject({ ok: true });
    expect(desk.view()).toMatchObject({ needsLogin: false });
    expect(db.prepare('SELECT transaction_id, raw FROM bank_items ORDER BY transaction_id').all()).toEqual(items);
    expect(fake.calls.filter((c) => c.endpoint === '/item/public_token/exchange').length).toBe(exchanges);
    expect(serverLinesIn(db)).toContainEqual(expect.objectContaining({ action: 'bank-logged-in-again' }));
  });

  it('1.2 1.3 a missing account: logging in again adds it, and it can then be picked', async () => {
    const three = fourAccounts(POSTED_AT_START).filter((a) => a.id !== ACCOUNT_IDS.old);
    const f = await connectedFresh(three);
    expect(f.desk.roles({ roles: PICKS, yes: true })).toMatchObject({ ok: false, code: 'not-roles' });
    expect(await f.desk.link({ mode: 'login-again' })).toMatchObject({ ok: true });
    const old = fourAccounts(POSTED_AT_START).find((a) => a.id === ACCOUNT_IDS.old);
    if (old === undefined) throw new Error('no old card');
    f.fake.accounts.set(old.id, { input: old, posted: old.posted });
    expect(await f.desk.read({ loggedInAgain: true })).toMatchObject({ ok: true });
    expect(f.desk.roles({ roles: PICKS, yes: true })).toMatchObject({ ok: true });
  });
});
