// Every example in packages/server/worked-examples.txt is also a test. The
// expected numbers come from its "Check:" lines, so the file checked by hand
// and the test can never drift apart.
import { readFileSync } from 'node:fs';
import { Book, DEFAULT_SETTINGS, bankSide, cardDue, cardNotices, parseDollars, type CardPayment, type Cents } from '@budget-app/money';
import { describe, expect, it, vi } from 'vitest';
import { readHistory } from '../src/history/history-db.js';
import { acceptRetotal, checkRetotal } from '../src/history/retotal.js';
import { serverLinesIn } from '../src/server-log.js';
import { choose, decision, lifeInAFile, noonInNewYork, setUpThroughTheDesk } from './keeper-harness.js';
import { checkBankRules } from '../src/bank/reading.js';
import { connectTestBank } from '../src/connect.js';
import { TokenBox } from '../src/crypto/token-box.js';
import { openDatabase } from '../src/db/database.js';
import { bankLinesIn, changeBankRuleIn } from '../src/bank-rules-db.js';
import { changeBankRules, itemsReadDifferently, matchesOf } from '../src/bank-rules.js';
import { loadBook, readAccounts, readBankRules, readItems, setAccountRoles, setBankRules } from '../src/db/store.js';
import { memoryLog } from '../src/log.js';
import { PlaidClient } from '../src/plaid/client.js';
import { plaidKeysFromEnv } from '../src/plaid/sandbox-lock.js';
import { setUpTracking, setupPreview } from '../src/setup-day.js';
import { bankStatus } from '../src/status.js';
import { bankView } from '../src/bank/balances.js';
import { cardStatement } from '../src/bank/statements.js';
import { SyncTimer } from '../src/serve/sync-timer.js';
import { syncBank } from '../src/sync/sync.js';
import { FakeClock } from './fake-clock.js';
import { ACCOUNT_IDS, FakePlaid } from './fake-plaid.js';
import { TOKEN_KEY, book, tracking } from './harness.js';
import { REPLAY_KEYS, Replay, loadRecording } from './replay.js';
import { readOutbox } from '../src/alerts/outbox.js';
import { timeIn } from '../src/history/today.js';
import type { AlertTimer } from '../src/serve/alert-timer.js';
import { serveBooks } from '../src/serve/serving.js';
import { FakePhone } from './fake-phone.js';
import type { Life } from './keeper-harness.js';

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

  it('example 4, a bank rule added after setup day reads what comes next (section 2, 24c)', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'gym-1', account: ACCOUNT_IDS.checking, amount: 4_000, date: '2026-10-02', description: 'MADE UP GYM' });
    await h.sync('2026-10-02');
    const spec = { account: 'checking' as const, contains: 'MADE UP GYM', means: 'payment-to-person' as const };
    // What Settings shows before his yes: what it would have matched lately.
    const preview = matchesOf(spec, readBankRules(h.db), bankLinesIn(h.db), { today: '2026-10-03', recentOnly: true });
    expect(preview.count).toBe(1);
    expect(changeBankRuleIn(h.db, { add: spec }, '2026-10-03').ok).toBe(true);
    h.fake.addPosted({ id: 'gym-2', account: ACCOUNT_IDS.checking, amount: 4_000, date: '2026-10-04', description: 'MADE UP GYM' });
    await h.sync('2026-10-04');
    const checks = checksOf(4);
    const items = readItems(h.db);
    expect([items.get('gym-1')?.kind, items.get('gym-2')?.kind]).toEqual(['purchase', 'payment-to-person']);
    const b = book(h);
    const waiting = b.reviewItems();
    expect(waiting.map((i) => i.id)).toEqual(['gym-1', 'gym-2']);
    const amountOf = (id: string): Cents | undefined => {
      const item = waiting.find((i) => i.id === id);
      return item !== undefined && 'amount' in item ? item.amount : undefined;
    };
    expect(amountOf('gym-1')).toBe(checks.get('first gym payment'));
    expect(amountOf('gym-2')).toBe(checks.get('second gym payment'));
    expect(b.pots().unsortedOut).toBe(checks.get('unsorted spending'));
    const status = bankStatus(h.db);
    expect(status.selfCheck?.bankSide).toBe(checks.get('bank side'));
    expect(status.selfCheck?.difference).toBe(checks.get('difference'));
  });

  it('example 5, moving a bank rule up: the first rule that fits wins (section 2, A27)', async () => {
    const h = await tracking();
    const wide = changeBankRuleIn(h.db, { add: { account: 'checking', contains: 'Online Banking transfer', means: 'payment-to-person' } }, '2026-10-02');
    const narrow = changeBankRuleIn(h.db, { add: { account: 'checking', contains: 'Online Banking transfer to CRD 4444', means: 'transfer', other: 'old-card' } }, '2026-10-02');
    if (!wide.ok || !narrow.ok) throw new Error('the rules were refused');
    h.fake.addPosted({ id: 'card-1', account: ACCOUNT_IDS.checking, amount: 10_000, date: '2026-10-03', description: 'Online Banking transfer to CRD 4444' });
    await h.sync('2026-10-03');
    const checks = checksOf(5);
    expect(book(h).pots().unsortedOut).toBe(checks.get('unsorted spending'));
    // What Settings shows before his yes: the Oct 3 payment would change hands.
    const moved = changeBankRules(readBankRules(h.db), { move: { id: narrow.rule.id, direction: 'up' } });
    if (!moved.ok) throw new Error(moved.why);
    expect(itemsReadDifferently(readBankRules(h.db), moved.rules, bankLinesIn(h.db), { today: '2026-10-03', recentOnly: true })).toBe(1);
    expect(changeBankRuleIn(h.db, { move: { id: narrow.rule.id, direction: 'up' } }, '2026-10-03')).toMatchObject({ ok: true, action: 'moved', past: { id: wide.rule.id } });
    h.fake.addPosted({ id: 'card-2', account: ACCOUNT_IDS.checking, amount: 10_000, date: '2026-10-04', description: 'Online Banking transfer to CRD 4444' });
    await h.sync('2026-10-04');
    const items = readItems(h.db);
    expect([items.get('card-1')?.kind, items.get('card-2')?.kind]).toEqual(['payment-to-person', 'transfer-sent']);
    const b = book(h);
    expect(b.reviewItems().map((i) => i.id)).toEqual(['card-1']);
    expect(b.purchases().find((p) => p.id === 'card-2')).toMatchObject({ kind: 'debt-payoff', amount: checks.get('second payment'), sortedTo: { to: 'needs' } });
    expect(b.pots().needs).toBe(checks.get('needs'));
    expect(b.pots().unsortedOut).toBe(checks.get('unsorted spending'));
    expect(b.inTransit().items.map((i) => [i.to, i.amount])).toEqual([['old-card', checks.get('second payment')]]);
    const status = bankStatus(h.db);
    expect(status.selfCheck?.bankSide).toBe(checks.get('bank side'));
    expect(status.selfCheck?.difference).toBe(checks.get('difference'));
  });
});

// "Dates:" lines name days the same way "Check:" lines name amounts.
function datesOf(number: number): Map<string, string> {
  const block = text.split(/^EXAMPLE /m).find((b) => b.startsWith(`${number}.`));
  if (block === undefined) throw new Error(`no example ${number}`);
  const dates = new Map<string, string>();
  for (const line of block.matchAll(/^Dates: (.*)$/gm)) {
    for (const part of (line[1] ?? '').split('|')) {
      const m = /^\s*([a-z][a-z ]*?)\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(part);
      if (m === null) throw new Error(`cannot read "${part}" in example ${number}`);
      dates.set(m[1] ?? '', m[2] ?? '');
    }
  }
  return dates;
}

describe('worked examples: the real server keeps everything', () => {
  it('example 6, a restart in the middle of a pay period finds the books as they were', async () => {
    const checks = checksOf(6);
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life);
      life.now = noonInNewYork('2026-10-03');
      life.h.fake.addPosted({ id: 'store-1', account: ACCOUNT_IDS.everyday, amount: 2_345, date: '2026-10-03', description: 'CORNER STORE 12' });
      await life.sync();
      expect(life.keeper.choice({ id: decision(), item: 'store-1', choice: { to: 'wants' } }).ok).toBe(true);
      const move = { id: decision(), move: { from: 'wants' as const, to: 'needs' as const, amount: checks.get('moved') ?? 0 } };
      const first = life.keeper.move(move);
      expect(first.ok).toBe(true);
      // The totals after each event since setup day: wants, needs, unsorted spending.
      const after = readHistory(life.h.db).filter((e) => e.totals !== null).map((e) => [e.event.kind, e.date, e.totals?.wants, e.totals?.needs, e.totals?.unsortedOut]);
      expect(after).toEqual([
        ['setup', '2026-10-01', 20_000, 235_000, 0],
        ['receive', '2026-10-03', 20_000, 235_000, 2_345],
        ['answer', '2026-10-03', 17_655, 235_000, 0],
        ['answer', '2026-10-03', 12_655, 240_000, 0],
      ]);
      life.restart();
      const pots = life.keeper.book()?.pots();
      expect(pots?.wants).toBe(checks.get('wants'));
      expect(pots?.needs).toBe(checks.get('needs'));
      expect(pots?.unsortedOut).toBe(checks.get('unsorted spending'));
      expect(pots?.savings).toBe(checks.get('savings'));
      expect(pots?.momReserve).toBe(checks.get('mom reserve'));
      expect(life.keeper.book()?.changeLog().at(-1)).toEqual({ date: '2026-10-03', kind: 'money-moved', from: 'wants', to: 'needs', amount: checks.get('moved') });
      // The same move sent again: the first answer back, nothing moved twice.
      expect(life.keeper.move(move)).toEqual({ ...first, replayed: true });
      expect(life.keeper.book()?.pots().wants).toBe(checks.get('wants'));
      // Code changed so the purchase goes to needs: the server would not start, and says which answer.
      const sort = Book.prototype.sort;
      vi.spyOn(Book.prototype, 'sort').mockImplementation(function (this: Book, id, choice, date) {
        return sort.call(this, id, 'to' in choice && choice.to === 'wants' ? { to: 'needs' } : choice, date);
      });
      expect(() => life.reopen()).toThrow(/his answer: sort, 2026-10-03\): the totals differ$/);
    } finally {
      vi.restoreAllMocks();
      life.done();
    }
  });

  it('example 7, today is the date in his home time zone', async () => {
    const checks = checksOf(7);
    const dates = datesOf(7);
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life);
      life.now = new Date('2026-10-03T03:30:00Z');
      expect(life.keeper.today()).toBe(dates.get('now'));
      life.h.fake.addPosted({ id: 'shop-1', account: ACCOUNT_IDS.everyday, amount: checks.get('purchase') ?? 0, date: '2026-10-03', description: 'MADE UP LATE SHOP' });
      await life.sync();
      expect(life.keeper.book()?.purchases().find((p) => p.id === 'shop-1')).toMatchObject({ date: dates.get('bank purchase'), amount: checks.get('purchase') });
      expect(life.keeper.move({ id: decision(), move: { from: 'wants', to: 'needs', amount: checks.get('moved') ?? 0 } }).ok).toBe(true);
      expect(readHistory(life.h.db).at(-1)?.date).toBe(dates.get('hand move'));
      expect(life.keeper.book()?.changeLog().at(-1)?.date).toBe(dates.get('hand move'));
      life.now = new Date('2026-10-10T05:30:00Z');
      expect(life.keeper.settingsChange({ id: decision(), settings: { homeTimeZone: 'America/Los_Angeles' } }).ok).toBe(true);
      expect(life.keeper.today()).toBe(dates.get('after the change'));
      expect(life.keeper.book()?.changeLog().at(-1)?.date).toBe(dates.get('change made'));
    } finally {
      life.done();
    }
  });

  it('example 8, a fix to the money math changes what old answers did (0.6, A28)', async () => {
    const checks = checksOf(8);
    const dates = datesOf(8);
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life);
      for (const [day, id, amount, description] of [
        ['2026-10-02', 'store-1', 2_345, 'CORNER STORE 12'],
        ['2026-10-03', 'cafe', 650, 'MADE UP CAFE'],
      ] as const) {
        life.now = noonInNewYork(day);
        life.h.fake.addPosted({ id, account: ACCOUNT_IDS.everyday, amount, date: day, description });
        await life.sync();
        expect(life.keeper.choice({ id: decision(), item: id, choice: { to: 'wants' } }).ok).toBe(true);
      }
      const sort = Book.prototype.sort;
      vi.spyOn(Book.prototype, 'sort').mockImplementation(function (this: Book, id, choice, date) {
        return sort.call(this, id, 'to' in choice && choice.to === 'wants' ? { to: 'needs' } : choice, date);
      });
      expect(() => life.reopen()).toThrow(/the totals differ$/);
      const found = checkRetotal(life.h.db);
      if (found.state !== 'changed') throw new Error('expected changes');
      expect(found.events.map((e) => [e.what, e.date])).toEqual([
        ['his answer: sort', dates.get('first event')],
        ['from the bank: purchase cafe', '2026-10-03'],
        ['his answer: sort', '2026-10-03'],
      ]);
      const [first, , last] = found.events;
      expect(first?.before?.wants).toBe(checks.get('first wants before'));
      expect(first?.after?.wants).toBe(checks.get('first wants after'));
      expect(first?.after?.needs).toBe(checks.get('first needs after'));
      expect(last?.before?.wants).toBe(checks.get('last wants before'));
      expect(last?.after?.needs).toBe(checks.get('last needs after'));
      expect(acceptRetotal(life.h.db, found.key, noonInNewYork(dates.get('logged') ?? ''))).toEqual({ ok: true, events: 3 });
      expect(serverLinesIn(life.h.db)).toMatchObject([{ action: 'history-retotaled', date: dates.get('logged'), from: { date: dates.get('first event') } }]);
      life.restart();
      expect(life.keeper.book()?.pots()).toMatchObject({ wants: checks.get('first wants after'), needs: checks.get('last needs after') });
    } finally {
      vi.restoreAllMocks();
      life.done();
    }
  });
});

// "Checked at:" lines: each time Home says the bank was last read, in order,
// as "11:30 PM EDT" (New York time, EDT or EST by its offset).
function checkedAtOf(number: number): string[] {
  const block = text.split(/^EXAMPLE /m).find((b) => b.startsWith(`${number}.`));
  const line = block?.match(/^Checked at: (.*)$/m)?.[1];
  if (line === undefined) throw new Error(`no Checked at line in example ${number}`);
  return line.split('|').map((part) => part.trim());
}

// "2026-11-01T01:30:00-05:00" as "1:30 AM EST".
function wallClock(at: string): string {
  const m = /T(\d{2}):(\d{2}):\d{2}(-0[45]):00$/.exec(at);
  if (m === null) throw new Error(`not a New York time: ${at}`);
  const hour = Number(m[1]);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m[2]} ${hour < 12 ? 'AM' : 'PM'} ${m[3] === '-04' ? 'EDT' : 'EST'}`;
}

describe('worked examples: syncing on a timer (Step 3)', () => {
  it('example 9, syncing by itself across the clock change, Checked at, and an answer about something the sync changed (A31)', async () => {
    const checks = checksOf(9);
    const said = checkedAtOf(9);
    const life = await lifeInAFile();
    const seen: string[] = [];
    const timers: SyncTimer[] = [];
    try {
      setUpThroughTheDesk(life);
      expect(life.keeper.book()?.pots().wants).toBe(20_000);
      life.now = new Date('2026-11-01T03:30:00Z');
      const look = (): void => {
        const home = life.keeper.home();
        if (home.state !== 'tracking' || home.checkedAt === null) throw new Error('no Checked at');
        seen.push(wallClock(home.checkedAt.at));
      };
      life.h.fake.addPending({ id: 'cafe-1', account: ACCOUNT_IDS.everyday, amount: checks.get('cafe pending') ?? 0, date: '2026-10-31', description: 'MADE UP CAFE' });
      const clock = new FakeClock(life);
      const timer = new SyncTimer({ syncer: { syncDueIn: () => life.keeper.syncDueIn(), sync: () => life.keeper.sync({ plaid: life.h.plaid, box: life.h.box, log: memoryLog([]), pageSize: 3 }) }, clock, log: memoryLog([]) });
      timers.push(timer);
      const hour = (): Promise<void> => clock.advance(60 * 60_000, () => timer.idle());
      timer.start();
      await timer.idle();
      look();
      const review = life.keeper.review();
      if (review.state !== 'tracking') throw new Error('not tracking');
      const opened = review.items.find((d) => d.item.id === 'cafe-1');
      expect(opened).toMatchObject({ item: { amount: checks.get('cafe pending') }, pending: true });
      life.h.fake.postPending('cafe-1', { id: 'cafe-1-posted', date: '2026-11-01', amount: checks.get('cafe posted') ?? 0 });
      for (let i = 0; i < 4; i += 1) {
        await hour();
        look();
      }
      const events = readHistory(life.h.db).length;
      const answer = life.keeper.choice({ id: decision(), item: 'cafe-1', choice: { to: 'wants' }, seen: opened!.key });
      expect(answer).toEqual({ ok: false, code: 'changed', why: 'MADE UP CAFE changed since you looked: it is now $13.50. Look at it again, then choose. Nothing was changed.' });
      expect(life.keeper.book()?.pots().wants).toBe(20_000);
      expect(readHistory(life.h.db)).toHaveLength(events);
      const again = life.keeper.review();
      if (again.state !== 'tracking') throw new Error('not tracking');
      const now = again.items.find((d) => d.item.id === 'cafe-1')!;
      expect(life.keeper.choice({ id: decision(), item: 'cafe-1', choice: { to: 'wants' }, seen: now.key }).ok).toBe(true);
      expect(life.keeper.book()?.pots().wants).toBe(checks.get('wants after'));
      life.h.fake.beforeCall = () => 'network';
      await hour();
      look();
      life.h.fake.beforeCall = undefined;
      await hour();
      look();
      expect(seen).toEqual(said);
    } finally {
      for (const timer of timers) await timer.stop();
      life.done();
    }
  });
});

// "Times:" lines name moments the way "Checked at" does: "low due 9:15 AM EDT".
function timesOf(number: number): Map<string, string> {
  const block = text.split(/^EXAMPLE /m).find((b) => b.startsWith(`${number}.`));
  if (block === undefined) throw new Error(`no example ${number}`);
  const times = new Map<string, string>();
  for (const line of block.matchAll(/^Times: (.*)$/gm)) {
    for (const part of (line[1] ?? '').split('|')) {
      const m = /^\s*([a-z][a-z0-9 ]*?)\s+(\d{1,2}:\d{2} [AP]M E[DS]T)\s*$/.exec(part);
      if (m === null) throw new Error(`cannot read "${part}" in example ${number}`);
      times.set(m[1] ?? '', m[2] ?? '');
    }
  }
  return times;
}

describe('worked examples: the alerts (Phase 5)', () => {
  const E = ACCOUNT_IDS.everyday;
  const H = 3_600_000;
  const zone = 'America/New_York';
  const syncNow = (life: Life): Promise<unknown> => life.keeper.sync({ plaid: life.h.plaid, box: life.h.box, log: memoryLog([]), pageSize: 3 });

  // The real server on a clock the test moves, sending to a made-up phone.
  function served(life: Life): { clock: FakeClock; phone: FakePhone; alerts: AlertTimer; timer: SyncTimer } {
    const clock = new FakeClock(life);
    const phone = new FakePhone(() => life.now);
    const { alerts, timer } = serveBooks({ keeper: life.keeper, bank: { plaid: life.h.plaid, box: life.h.box, log: memoryLog([]), pageSize: 3 }, clock, webRoot: 'C:/made-up/no-screens/', origin: () => '', sender: phone });
    return { clock, phone, alerts, timer };
  }

  const kept = (life: Life): Map<string, { readonly due: string; readonly sent: string | null; readonly body: string }> =>
    new Map(readOutbox(life.h.db, 100).rows.map((r) => [r.key, { due: wallClock(timeIn(zone, new Date(r.dueAt))), sent: r.sentAt === null ? null : wallClock(timeIn(zone, new Date(r.sentAt))), body: r.body }]));

  it("example 10, a day's alerts with their times: low at 9:15 AM, the review and a 7-day reminder at 8:00 PM", async () => {
    const checks = checksOf(10);
    const times = timesOf(10);
    const life = await lifeInAFile();
    setUpThroughTheDesk(life);
    expect(life.keeper.book()?.startedPeriodWith().needs).toBe(checks.get('started with'));
    expect(Math.floor(((checks.get('started with') ?? 0) * 20) / 100)).toBe(checks.get('low level'));
    life.h.fake.setStatement(E, {
      is_overdue: false,
      last_payment_amount: null,
      last_payment_date: null,
      last_statement_issue_date: '2026-10-03',
      last_statement_balance: (checks.get('statement balance') ?? 0) / 100,
      minimum_payment_amount: (checks.get('minimum') ?? 0) / 100,
      next_payment_due_date: '2026-10-10',
    });
    life.now = new Date('2026-10-03T12:00:00Z');
    const { clock, alerts } = served(life);
    const settle = (): Promise<void> => alerts.idle();
    try {
      alerts.start();
      await syncNow(life);
      await settle();
      await clock.advance(H + 10 * 60_000, settle);
      life.h.fake.addPosted({ id: 'grocery', account: E, amount: 190_000, date: '2026-10-03', description: 'MADE UP GROCERY' });
      await syncNow(life);
      await settle();
      await clock.advance(5 * 60_000, settle);
      expect(choose(life.keeper, { item: 'grocery', choice: { to: 'needs' } }).ok).toBe(true);
      await settle();
      expect(life.keeper.book()?.pots().needs).toBe(checks.get('needs after grocery'));
      await clock.advance(3 * H + 45 * 60_000, settle);
      life.h.fake.addPosted({ id: 'shop', account: E, amount: 1_200, date: '2026-10-03', description: 'MADE UP SHOP' });
      life.h.fake.addPosted({ id: 'deli', account: E, amount: 850, date: '2026-10-03', description: 'MADE UP DELI' });
      await syncNow(life);
      await settle();
      await clock.advance(7 * H + 30 * 60_000, settle);
      const k = kept(life);
      expect([...k.keys()].toSorted()).toEqual(['card-reminder everyday-card due 2026-10-10 7 days before', 'daily-review 2026-10-03', 'low-bucket needs pay period 0'].toSorted());
      const low = k.get('low-bucket needs pay period 0');
      const review = k.get('daily-review 2026-10-03');
      const reminder = k.get('card-reminder everyday-card due 2026-10-10 7 days before');
      expect([low?.due, low?.sent, review?.due, review?.sent, reminder?.due, reminder?.sent]).toEqual(['low due', 'low sent', 'review due', 'review sent', 'reminder due', 'reminder sent'].map((name) => times.get(name)));
      expect(low?.body).toBe('$450.00 left of $2,350.00 this pay period.');
      expect(review?.body).toBe('2 things are waiting for you to sort.');
      expect(reminder?.body).toBe('Statement balance $450.00, minimum $35.00. Due Sat, Oct 10.');
    } finally {
      await alerts.stop();
      life.done();
    }
  });

  it('example 11 and example 12, the evening on both sides of Nov 1, and the server down over 8:00 PM', async () => {
    const times = new Map([...timesOf(11), ...[...timesOf(12)].map(([k, v]): [string, string] => [`down ${k}`, v])]);
    const life = await lifeInAFile();
    setUpThroughTheDesk(life);
    life.h.fake.addPosted({ id: 'shop', account: E, amount: checksOf(12).get('shop') ?? 0, date: '2026-10-30', description: 'MADE UP SHOP' });
    life.now = new Date('2026-10-31T16:00:00Z');
    let s = served(life);
    // Both timers: the bank is read every 12 hours (the setting), so it is never a day old (10.7).
    expect(life.keeper.changeSyncEvery(720)).toEqual({ ok: true });
    const idle = async (): Promise<void> => {
      await s.timer.idle();
      await s.alerts.idle();
    };
    try {
      s.alerts.start();
      s.timer.start();
      await idle();
      // To Mon Nov 2, 7:59 PM EST; down until 9:30 PM.
      await s.clock.advance(Date.parse('2026-11-03T00:59:00Z') - life.now.getTime(), idle);
      await s.timer.stop();
      await s.alerts.stop();
      const shownBefore = s.phone.ids();
      life.now = new Date('2026-11-03T02:30:00Z');
      life.restart();
      s = served(life);
      s.alerts.start();
      s.timer.start();
      await idle();
      await s.clock.advance(2 * H, idle);
      const k = kept(life);
      const oct31 = k.get('daily-review 2026-10-31');
      const nov1 = k.get('daily-review 2026-11-01');
      const nov2 = k.get('daily-review 2026-11-02');
      expect([oct31?.due, oct31?.sent, nov1?.due, nov1?.sent, nov2?.due, nov2?.sent]).toEqual(['oct 31 due', 'oct 31 sent', 'nov 1 due', 'nov 1 sent', 'down due', 'down sent'].map((name) => times.get(name)));
      expect(nov2?.body).toBe('1 thing is waiting for you to sort.');
      const rows = readOutbox(life.h.db, 100).rows;
      const due = (key: string): number => Date.parse(rows.find((r) => r.key === key)?.dueAt ?? '');
      expect((due('daily-review 2026-11-01') - due('daily-review 2026-10-31')) / 36_000).toBe(checksOf(11).get('hours between the evenings'));
      // Each went once: the two before the stop, the missed one after it.
      expect(shownBefore).toEqual(['daily-review 2026-10-31', 'daily-review 2026-11-01']);
      expect(s.phone.ids()).toEqual(['daily-review 2026-11-02']);
      expect(s.phone.repeats).toBe(0);
    } finally {
      await s.timer.stop();
      await s.alerts.stop();
      life.done();
    }
  });

  it('example 13, quiet hours: a take-back at 9:55 PM the phone could not get, and a login wanted at 3:10 AM, both at 7:00 AM, each saying when it was due, with no amount on the lock screen', async () => {
    const checks = checksOf(13);
    const times = timesOf(13);
    const life = await lifeInAFile();
    setUpThroughTheDesk(life);
    // Fri Oct 2, 9:54 PM EDT.
    life.now = new Date('2026-10-03T01:54:00Z');
    const s = served(life);
    const settle = (): Promise<void> => s.alerts.idle();
    const to = (iso: string): Promise<void> => s.clock.advance(Date.parse(iso) - life.now.getTime(), settle);
    try {
      s.alerts.start();
      life.h.fake.addPosted({ id: 'cafe', account: E, amount: checks.get('cafe') ?? 0, date: '2026-10-02', description: 'MADE UP CAFE' });
      await syncNow(life);
      await settle();
      await to('2026-10-03T01:55:00Z');
      s.phone.failing = 'the phone cannot be reached';
      life.h.fake.removePosted('cafe', { keepBalance: false });
      await syncNow(life);
      await settle();
      await to('2026-10-03T03:00:00Z');
      expect(s.phone.tries * 100).toBe(checks.get('tries before quiet hours'));
      s.phone.failing = null;
      // Sat Oct 3, 3:10 AM.
      await to('2026-10-03T07:10:00Z');
      life.h.fake.needsLogin = true;
      await syncNow(life);
      await settle();
      await to('2026-10-03T10:59:59.999Z');
      expect(s.phone.shown).toEqual([]);
      await to('2026-10-03T11:00:00Z');
      const k = kept(life);
      const cafe = k.get('bank-took-back cafe');
      const login = k.get('bank-login 1');
      expect([cafe?.due, cafe?.sent, login?.due, login?.sent]).toEqual(['cafe due', 'cafe sent', 'login due', 'login sent'].map((name) => times.get(name)));
      expect(s.phone.shown.map((a) => [a.id, a.title, a.body, a.due])).toEqual([
        ['bank-took-back cafe', 'The bank took something back', 'MADE UP CAFE, taken back Fri, Oct 2. It is undone in your buckets too.', 'Was due Fri, Oct 2, 9:55 PM.'],
        ['bank-login 1', 'Log in to your bank again', 'The bank wants you to log in again before the app can read it.', 'Was due 3:10 AM.'],
      ]);
      expect(cafe?.body).toBe('MADE UP CAFE, $11.50, taken back Fri, Oct 2. It is undone in your buckets too.');
      expect(s.phone.tries * 100).toBe(checks.get('tries in all'));
      expect(s.phone.repeats).toBe(0);
    } finally {
      await s.alerts.stop();
      life.done();
    }
  });

  it('example 14, back after three evenings down: one daily review (the newest), one reminder for the card, and the bank not read for 24 hours, each saying when it was due', async () => {
    const checks = checksOf(14);
    const times = timesOf(14);
    const life = await lifeInAFile();
    setUpThroughTheDesk(life);
    life.h.fake.setStatement(E, {
      is_overdue: false,
      last_payment_amount: null,
      last_payment_date: null,
      last_statement_issue_date: '2026-10-03',
      last_statement_balance: (checks.get('statement balance') ?? 0) / 100,
      minimum_payment_amount: (checks.get('minimum') ?? 0) / 100,
      next_payment_due_date: '2026-10-10',
    });
    // Sat Oct 3, noon EDT.
    life.now = new Date('2026-10-03T16:00:00Z');
    let s = served(life);
    try {
      s.alerts.start();
      await syncNow(life);
      await s.alerts.idle();
      // 6:00 PM: the last good read.
      await s.clock.advance(6 * H, () => s.alerts.idle());
      life.h.fake.addPosted({ id: 'shop', account: E, amount: checks.get('shop') ?? 0, date: '2026-10-03', description: 'MADE UP SHOP' });
      await syncNow(life);
      await s.alerts.idle();
      // 7:30 PM: it stops, until Tue Oct 6, 7:30 AM.
      await s.clock.advance(H + 30 * 60_000, () => s.alerts.idle());
      await s.alerts.stop();
      expect(s.phone.shown).toEqual([]);
      life.now = new Date('2026-10-06T11:30:00Z');
      life.restart();
      s = served(life);
      s.alerts.start();
      await s.alerts.idle();
      const k = kept(life);
      expect([...k.keys()].toSorted()).toEqual(['bank-not-read 1', 'card-reminder everyday-card due 2026-10-10 7 days before', 'daily-review 2026-10-05']);
      expect(k.size * 100).toBe(checks.get('alerts sent'));
      const review = k.get('daily-review 2026-10-05');
      const reminder = k.get('card-reminder everyday-card due 2026-10-10 7 days before');
      const notRead = k.get('bank-not-read 1');
      expect([review?.due, review?.sent, reminder?.due, reminder?.sent, notRead?.due, notRead?.sent]).toEqual(
        ['review due', 'review sent', 'reminder due', 'reminder sent', 'not read due', 'not read sent'].map((name) => times.get(name)),
      );
      expect(s.phone.shown.map((a) => [a.title, a.body, a.due]).toSorted()).toEqual(
        [
          ['Time to review', '1 thing is waiting for you to sort.', 'Was due Mon, Oct 5, 8:00 PM.'],
          // Sent Tue Oct 6: 4 days to Oct 10, counted from the day it is sent (his answer, Oct 11).
          ['Everyday card payment due in 4 days', 'Due Sat, Oct 10.', 'Was due Sat, Oct 3, 8:00 PM.'],
          ['The bank has not been read for 24 hours', 'Last read Sat, Oct 3 at 6:00 PM. Your numbers may be out of date until it is read again.', 'Was due Sun, Oct 4, 6:00 PM.'],
        ].toSorted(),
      );
      expect(reminder?.body).toBe('Statement balance $450.00, minimum $35.00. Due Sat, Oct 10.');
      const daysLeft = Number(/due in (\d+) days/.exec(s.phone.shown.find((a) => a.id === 'card-reminder everyday-card due 2026-10-10 7 days before')?.title ?? '')?.[1]);
      expect(daysLeft * 100).toBe(checks.get('reminder days left when sent'));
      // 8:00 AM: read again; the not-read alert is cleared.
      await s.clock.advance(30 * 60_000, () => s.alerts.idle());
      await syncNow(life);
      await s.alerts.idle();
      const last = readHistory(life.h.db).flatMap((e) => (e.event.kind === 'alerts' ? [e.event.alerts] : [])).at(-1);
      expect(last?.cleared).toEqual(['bank-not-read']);
    } finally {
      await s.alerts.stop();
      life.done();
    }
  });

  // Five days of the timer's once-a-minute looks: 1.7 s on his PC, 11 s on
  // CI's Windows runner (2 cores), past the 5-second default.
  it('example 15, the phone cut off for five days: of what waited, only the newest daily review and the newest reminder go when it is back; the rest "Not sent: a newer one went." (10.9, A40)', async () => {
    const checks = checksOf(15);
    const times = timesOf(15);
    const life = await lifeInAFile();
    setUpThroughTheDesk(life);
    life.h.fake.setStatement(E, {
      is_overdue: false,
      last_payment_amount: null,
      last_payment_date: null,
      last_statement_issue_date: '2026-10-01',
      last_statement_balance: (checks.get('statement balance') ?? 0) / 100,
      minimum_payment_amount: (checks.get('minimum') ?? 0) / 100,
      next_payment_due_date: '2026-10-10',
    });
    // Sat Oct 3, noon EDT.
    life.now = new Date('2026-10-03T16:00:00Z');
    const s = served(life);
    try {
      s.alerts.start();
      life.h.fake.addPosted({ id: 'shop', account: E, amount: checks.get('shop') ?? 0, date: '2026-10-03', description: 'MADE UP SHOP' });
      await syncNow(life);
      await s.alerts.idle();
      // 7:00 PM: the phone cannot be reached, until Thu Oct 8 at 9:00 PM. The bank is read at 7:30 AM and 6:00 PM each day.
      await s.clock.advance(7 * H, () => s.alerts.idle());
      s.phone.failing = 'the phone cannot be reached';
      for (const day of ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) {
        for (const at of [`${day}T11:30:00Z`, `${day}T22:00:00Z`]) {
          await s.clock.advance(Date.parse(at) - life.now.getTime(), () => s.alerts.idle());
          await syncNow(life);
          await s.alerts.idle();
        }
      }
      await s.clock.advance(Date.parse('2026-10-09T01:00:00Z') - life.now.getTime(), () => s.alerts.idle());
      expect(s.phone.shown).toEqual([]);
      s.phone.failing = null;
      await s.clock.advance(H, () => s.alerts.idle());
      const k = kept(life);
      expect(k.size * 100).toBe(checks.get('alerts kept'));
      expect(s.phone.shown.length * 100).toBe(checks.get('alerts sent'));
      const review = k.get('daily-review 2026-10-08');
      const reminder = k.get('card-reminder everyday-card due 2026-10-10 2 days before');
      expect([review?.due, review?.sent, reminder?.due, reminder?.sent]).toEqual(['review due', 'review sent', 'reminder due', 'reminder sent'].map((name) => times.get(name)));
      expect(s.phone.shown.map((a) => [a.title, a.body, a.due]).toSorted()).toEqual(
        [
          ['Time to review', '1 thing is waiting for you to sort.', 'Was due 8:00 PM.'],
          ['Everyday card payment due in 2 days', 'Due Sat, Oct 10.', 'Was due 8:00 PM.'],
        ].toSorted(),
      );
      const daysLeft = Number(/due in (\d+) days/.exec(s.phone.shown.find((a) => a.id === 'card-reminder everyday-card due 2026-10-10 2 days before')?.title ?? '')?.[1]);
      expect(daysLeft * 100).toBe(checks.get('reminder days left when sent'));
      const view = life.keeper.alertsView();
      const notSent = view.state === 'tracking' ? view.alerts.filter((a) => a.notSent !== null).map((a) => [a.key, a.notSent]) : [];
      expect(notSent.toSorted()).toEqual(
        ['daily-review 2026-10-03', 'daily-review 2026-10-04', 'daily-review 2026-10-05', 'daily-review 2026-10-06', 'daily-review 2026-10-07', 'card-reminder everyday-card due 2026-10-10 7 days before'].map((key) => [key, 'newer']).toSorted(),
      );
      expect(life.keeper.settings().alerts).toEqual({ total: 8, sent: 2, notSent: 0 });
    } finally {
      await s.alerts.stop();
      life.done();
    }
  }, 60_000);
});

describe('worked examples: the bank side (Phase 7)', () => {
  it('example 16, the bank side from the available balance (12.1, A47)', async () => {
    const checks = checksOf(16);
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life);
      life.now = noonInNewYork('2026-10-02');
      const fake = life.h.fake;
      fake.addPosted({ id: 'grocer', account: ACCOUNT_IDS.checking, amount: 4_210, date: '2026-10-02', description: 'MADE UP GROCER' });
      fake.notInCurrentYet(ACCOUNT_IDS.checking, 4_210);
      fake.addPending({ id: 'cafe', account: ACCOUNT_IDS.checking, amount: 650, date: '2026-10-02', description: 'MADE UP CAFE' });
      fake.addPending({ id: 'to-sav', account: ACCOUNT_IDS.checking, amount: 50_000, date: '2026-10-02', description: 'Online transfer to SAV 2222' });
      await life.sync();
      const checking = readAccounts(life.h.db).find((a) => a.role === 'checking');
      expect(checking?.raw.balances.current).toBe(3000);
      const view = bankView(readAccounts(life.h.db), readItems(life.h.db));
      if (!view.ok) throw new Error(view.why);
      expect(parseDollars(String(checking?.raw.balances.available?.toFixed(2)))).toBe(checks.get('available'));
      expect(view.view.withPending.checking).toBe(checks.get('checking side'));
      expect(view.view.posted.checking - 650).toBe(checks.get('old way'));
    } finally {
      life.done();
    }
  });
});

describe('worked examples: card statements (Phase 7)', () => {
  it('example 17, 9.8 a card statement sent without its statement date: the due date less the days he entered, and which payments count (9.3, B28)', () => {
    const checks = checksOf(17);
    const dates = datesOf(17);
    const minimum = checks.get('minimum') ?? 0;
    const read = cardStatement('old-card', { account_id: ACCOUNT_IDS.old, is_overdue: false, last_payment_amount: null, last_payment_date: null, last_statement_issue_date: null, last_statement_balance: 1_500, minimum_payment_amount: minimum / 100, next_payment_due_date: '2026-11-24' }, 25);
    if (!read.ok) throw new Error(read.why);
    expect(read.statement.closingDate).toBe(dates.get('statement date'));
    const first = dates.get('first reminder') ?? '';
    const second = dates.get('second reminder') ?? '';
    const paid: CardPayment[] = [
      { date: '2026-10-30', amount: 2_000 },
      { date: '2026-10-31', amount: 2_500 },
    ];
    // What is counted, read off where the reminders stop: one cent short of the rest still reminds, the rest exactly does not.
    const toPay = checks.get('still to pay') ?? 0;
    expect(minimum - (checks.get('counted at the first reminder') ?? 0)).toBe(toPay);
    expect(cardNotices(first, read.statement, paid, DEFAULT_SETTINGS)).toEqual([{ kind: 'reminder', card: 'old-card', daysBefore: 7, dueDate: '2026-11-24', minimumPayment: minimum }]);
    expect(cardNotices(first, read.statement, [...paid, { date: first, amount: toPay - 1 }], DEFAULT_SETTINGS)).toHaveLength(1);
    expect(cardNotices(first, read.statement, [...paid, { date: first, amount: toPay }], DEFAULT_SETTINGS)).toEqual([]);
    expect(cardDue(first, read.statement, paid, DEFAULT_SETTINGS)).toMatchObject({ kind: 'due', daysLeft: 7 });
    const later = [...paid, { date: '2026-11-18', amount: 2_000 }];
    // Counted exactly: a minimum one cent above it would still remind, one equal to it does not.
    const counted = checks.get('counted at the second reminder') ?? 0;
    expect(cardNotices(second, { ...read.statement, minimumPayment: counted + 1 }, later, DEFAULT_SETTINGS)).toHaveLength(1);
    expect(cardNotices(second, { ...read.statement, minimumPayment: counted }, later, DEFAULT_SETTINGS)).toEqual([]);
    expect(cardNotices(second, read.statement, later, DEFAULT_SETTINGS)).toEqual([]);
    expect(cardDue(second, read.statement, later, DEFAULT_SETTINGS)).toBeNull();
  });
});
