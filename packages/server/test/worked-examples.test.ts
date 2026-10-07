// Every example in packages/server/worked-examples.txt is also a test. The
// expected numbers come from its "Check:" lines, so the file checked by hand
// and the test can never drift apart.
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, bankSide, parseDollars, type Cents } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { checkBankRules } from '../src/bank/reading.js';
import { connectTestBank } from '../src/connect.js';
import { TokenBox } from '../src/crypto/token-box.js';
import { openDatabase } from '../src/db/database.js';
import { loadBook, readAccounts, setAccountRoles, setBankRules } from '../src/db/store.js';
import { memoryLog } from '../src/log.js';
import { PlaidClient } from '../src/plaid/client.js';
import { plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';
import { setUpTracking, setupPreview } from '../src/setup-day.js';
import { bankStatus } from '../src/status.js';
import { syncBank } from '../src/sync/sync.js';
import { ACCOUNT_IDS, FakePlaid } from './fake-plaid.js';
import { TOKEN_KEY, book, tracking } from './harness.js';
import { REPLAY_KEYS, Replay, loadRecording } from './replay.js';

const text = readFileSync(new URL('../worked-examples.txt', import.meta.url), 'utf8');

function checksOf(number: number): Map<string, Cents> {
  const block = text.split(/^EXAMPLE /m).find((b) => b.startsWith(`${number}.`));
  if (block === undefined) throw new Error(`no example ${number}`);
  const checks = new Map<string, Cents>();
  for (const line of block.matchAll(/^Check: (.*)$/gm)) {
    for (const part of (line[1] ?? '').split('|')) {
      const m = /^\s*([a-z][a-z ]*?)\s+(-?[\d,]+\.\d{2})\s*$/.exec(part);
      if (m === null) throw new Error(`cannot read "${part}" in example ${number}`);
      checks.set(m[1] ?? '', parseDollars(m[2] ?? ''));
    }
  }
  return checks;
}

const keys = plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: REPLAY_KEYS.clientId, PLAID_SECRET: REPLAY_KEYS.secret });

describe('worked examples: reading the bank', () => {
  it('example 1, a week at the test bank, from the saved bank answers', async () => {
    const replay = new Replay(loadRecording('a-week-at-the-test-bank.json'), 'item-made-up-1');
    const db = openDatabase(':memory:');
    const log = memoryLog([]);
    const plaid = new PlaidClient(keys, { fetch: replay.fetch, log });
    const box = new TokenBox(TOKEN_KEY);
    await connectTestBank({ db, plaid, box, log, today: '2026-10-01', institutionId: 'ins_109508' });
    await syncBank({ db, plaid, box, log, today: '2026-10-01' });
    // His accounts, by the last four digits the bank shows.
    const byMask = { '5432': 'checking', '9876': 'savings', '1111': 'everyday-card', '2222': 'old-card' } as const;
    setAccountRoles(db, Object.fromEntries(readAccounts(db).map((a) => [a.plaidAccountId, byMask[a.raw.mask as keyof typeof byMask]])));
    setBankRules(
      db,
      checkBankRules([
        { id: '1', account: 'checking', contains: 'transfer to SAV 9876', means: 'transfer', other: 'savings' },
        { id: '2', account: 'savings', contains: 'transfer from CHK 5432', means: 'transfer', other: 'checking' },
        { id: '3', account: 'checking', contains: 'payment to CRD 1111', means: 'transfer', other: 'everyday-card' },
        { id: '4', account: 'checking', contains: 'payment to CRD 2222', means: 'transfer', other: 'old-card' },
        { id: '5', account: 'everyday-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
        { id: '6', account: 'old-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
        { id: '7', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' },
        { id: '8', account: 'everyday-card', contains: 'INTEREST CHARGE', means: 'card-interest' },
      ]),
      '2026-10-01',
    );
    const checks = checksOf(1);
    const money = setupPreview(db, []).startingMoney;
    expect(money).toBe(checks.get('starting money'));
    const setup = setUpTracking(db, {
      today: '2026-10-01',
      assignment: { savings: 500_000, momReserve: 110_000, wants: 30_000, heldForOthers: 0, needs: money - 640_000 },
      lastPaycheckDate: '2026-09-25',
      settings: {
        ...DEFAULT_SETTINGS,
        paycheckRule: { contains: 'MADEUP CORP PAYROLL' },
        momRule: { contains: 'Zelle payment to MOM MADEUP' },
        leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' },
      },
      rules: [
        { id: 'coffee', for: 'purchase', contains: 'COFFEE', bucket: 'wants' },
        { id: 'gas', for: 'purchase', contains: 'GAS STATION', bucket: 'needs' },
      ],
      inTransit: [],
    });
    expect(setup.ok).toBe(true);

    replay.stage = 1;
    await syncBank({ db, plaid, box, log, today: '2026-10-09' });
    const book = loadBook(db);
    const status = bankStatus(db);
    const pots = book?.pots();
    expect(pots?.savings).toBe(checks.get('savings'));
    expect(pots?.needs).toBe(checks.get('needs'));
    expect(pots?.wants).toBe(checks.get('wants'));
    expect(pots?.momReserve).toBe(checks.get('mom reserve'));
    expect(pots?.unsortedOut).toBe(checks.get('unsorted spending'));
    expect(status.selfCheck?.bankSide).toBe(checks.get('bank side'));
    expect(status.selfCheck?.difference).toBe(checks.get('difference'));
    expect(book?.oldCardDebt()).toBe(checks.get('old card debt'));
    expect(status.oldCard?.difference).toBe(0);
    expect(status.inTransit).toEqual({ total: 0, items: [] });
    expect(status.attention).toEqual([]);
    expect(status.statements.map((s) => s.result.ok)).toEqual([true, true]);
  });

  it('example 2, pending money in waits until it posts (B36)', async () => {
    const fake = new FakePlaid([
      { id: ACCOUNT_IDS.checking, name: 'Made-up Checking', mask: '1111', kind: 'checking', posted: 100_000 },
      { id: ACCOUNT_IDS.savings, name: 'Made-up Savings', mask: '2222', kind: 'savings', posted: 0 },
      { id: ACCOUNT_IDS.everyday, name: 'Made-up Everyday Card', mask: '3333', kind: 'credit card', posted: 0, limit: 100_000 },
      { id: ACCOUNT_IDS.old, name: 'Made-up Old Card', mask: '4444', kind: 'credit card', posted: 0, limit: 100_000 },
    ]);
    fake.addPending({ id: 'charge', account: ACCOUNT_IDS.checking, amount: 3_000, date: '2026-10-01', description: 'GROCERY' });
    fake.addPending({ id: 'coming', account: ACCOUNT_IDS.checking, amount: -20_000, date: '2026-10-01', description: 'MOBILE DEPOSIT' });
    const db = openDatabase(':memory:');
    const log = memoryLog([]);
    const plaid = new PlaidClient(plaidKeysFromEnv({ PLAID_ENV: 'sandbox', PLAID_CLIENT_ID: fake.clientId, PLAID_SECRET: fake.secret }), { fetch: fake.fetch, log });
    const box = new TokenBox(TOKEN_KEY);
    await connectTestBank({ db, plaid, box, log, today: '2026-10-01', institutionId: 'ins_109508' });
    await syncBank({ db, plaid, box, log, today: '2026-10-01' });
    setAccountRoles(db, { [ACCOUNT_IDS.checking]: 'checking', [ACCOUNT_IDS.savings]: 'savings', [ACCOUNT_IDS.everyday]: 'everyday-card', [ACCOUNT_IDS.old]: 'old-card' });
    const checks = checksOf(2);
    const preview = setupPreview(db, []);
    expect(preview.startingMoney).toBe(checks.get('bank side'));
    expect(bankSide({ ...preview.posted, checking: preview.posted.checking - 3_000 })).toBe(checks.get('bank side'));
    const available = readAccounts(db).find((a) => a.role === 'checking')?.raw.balances.available;
    expect(available === undefined || available === null ? null : parseDollars(available.toFixed(2))).toBe(checks.get('available'));
  });

  it('example 3, the bank changes its mind (A13, A14, A16)', async () => {
    // The harness's setup day: the same balances and assignment as the example.
    const h = await tracking();
    h.fake.addPending({ id: 'tab', account: ACCOUNT_IDS.everyday, amount: 2_000, date: '2026-10-02', description: 'COFFEE BAR' });
    await h.sync('2026-10-02');
    h.fake.modify('tab', { amount: 2_600 });
    h.fake.addPosted({ id: 'coffee', account: ACCOUNT_IDS.checking, amount: 1_000, date: '2026-10-03', description: 'COFFEE' });
    h.fake.addPosted({ id: 'coffee-copy', account: ACCOUNT_IDS.checking, amount: 1_000, date: '2026-10-03', description: 'COFFEE' });
    await h.sync('2026-10-03');
    h.fake.removePosted('coffee-copy', { keepBalance: false });
    h.fake.addPosted({ id: 'bill', account: ACCOUNT_IDS.savings, amount: 7_500, date: '2026-10-04', description: 'BILL PAY MADE UP INSURANCE' });
    await h.sync('2026-10-04');
    const checks = checksOf(3);
    const status = bankStatus(h.db);
    const b = book(h);
    expect(b.pots().wants).toBe(checks.get('wants'));
    expect(b.pots().unsortedOut).toBe(checks.get('unsorted spending'));
    expect(status.selfCheck?.bankSide).toBe(checks.get('bank side'));
    expect(status.selfCheck?.difference).toBe(checks.get('difference'));
    const balances = status.bank?.ok === true ? status.bank.view.withPending : null;
    if (balances === null) throw new Error('no bank balances');
    const alerts = b.takeAlerts({ bankConnection: 'ok', bankBalances: balances });
    expect(alerts.reduce((sum, a) => sum + (a.kind === 'bank-took-back' ? a.amount : 0), 0)).toBe(checks.get('taken back'));
    expect(status.attention).toEqual([]);
  });
});
