import { MoneyError, type StartingPots } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { checkBankRules } from '../src/bank/reading.js';
import { loadBook, readItems } from '../src/db/store.js';
import { madeUpHistory, type MadeUpBank } from '../src/demo/made-up-bank.js';
import { bankHistoryOf, halvesInTransit, setUpTracking, setupPreview } from '../src/setup-day.js';
import { bankRuleOf, halvesInTransitIn, notReadyWhy, planSetup, setupPreviewOf, type BankHistory, type SetupChoices } from '../src/setup-history.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { SETTINGS, SETUP_DAY, SORTING_RULES, connected, dump } from './harness.js';

// Rulebook section 14: setup day works on the bank history handed to it, so
// the demo (no database) and the real server (a thin wrapper that reads the
// database and saves what setting up does) use exactly the same logic. Every
// name and number is made up.

const RULES = checkBankRules([
  { id: 'card-paid', account: 'checking', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' },
  { id: 'card-got', account: 'everyday-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
  { id: 'to-sav', account: 'checking', contains: 'transfer to SAV 2222', means: 'transfer', other: 'savings' },
  { id: 'from-chk', account: 'savings', contains: 'transfer from CHK 1111', means: 'transfer', other: 'checking' },
  { id: 'old-paid', account: 'checking', contains: 'payment to CRD 4444', means: 'transfer', other: 'old-card' },
]);

// Checking 3,000.00, savings 5,000.00, everyday card owes 450.00, old card 2,980.00.
const BANK: MadeUpBank = {
  balances: { checking: 300_000, savings: 500_000, 'everyday-card': 45_000, 'old-card': 298_000 },
  rules: RULES,
  items: [
    { id: 'p-chk', account: 'checking', amount: 2_500, date: '2026-09-30', description: 'GROCERY STORE', pending: true },
    { id: 'p-card', account: 'everyday-card', amount: 1_000, date: '2026-09-30', description: 'COFFEE', pending: true },
    { id: 'p-old', account: 'old-card', amount: 900, date: '2026-09-30', description: 'HARDWARE', pending: true },
    // Pending money in counts once it posts (B36).
    { id: 'p-in', account: 'checking', amount: -7_000, date: '2026-09-30', description: 'STORE REFUND', pending: true },
    // A card payment that left checking and has not landed (B48).
    { id: 'left', account: 'checking', amount: 20_000, date: '2026-09-29', description: 'Online payment to CRD 3333' },
    // Money that landed in savings before checking shows it leaving.
    { id: 'landed', account: 'savings', amount: -10_000, date: '2026-09-30', description: 'Online Banking transfer from CHK 1111' },
    // Both halves of an older transfer: not on its way.
    { id: 'out', account: 'checking', amount: 50_000, date: '2026-09-20', description: 'Online Banking transfer to SAV 2222' },
    { id: 'in', account: 'savings', amount: -50_000, date: '2026-09-20', description: 'Online Banking transfer from CHK 1111' },
    { id: 'pay', account: 'checking', amount: -250_000, date: '2026-09-25', description: 'MADEUP CORP PAYROLL' },
  ],
};

const ASSIGNMENT = (needs: number): StartingPots => ({ savings: 400_000, needs, wants: 20_000, momReserve: 100_000, heldForOthers: 0 });
const choices = (over: Partial<SetupChoices> = {}): SetupChoices => ({
  today: SETUP_DAY,
  assignment: ASSIGNMENT(0),
  lastPaycheckDate: '2026-09-25',
  settings: SETTINGS,
  rules: SORTING_RULES,
  inTransit: [],
  ...over,
});

describe('14 setup day on the history handed to it, with no database', () => {
  it('14.1 14.2 the balances, the pending charges, and the starting money', () => {
    const preview = setupPreviewOf(madeUpHistory(BANK), []);
    expect(preview.posted).toEqual({ checking: 300_000, savings: 500_000, everydayCard: 45_000 });
    expect(preview.pendingCharges.map((c) => [c.id, c.account, c.amount])).toEqual([
      ['p-chk', 'checking', 2_500],
      ['p-card', 'everyday-card', 1_000],
      ['p-old', 'old-card', 900],
    ]);
    // (3,000.00 - 25.00) + 5,000.00 - (450.00 + 10.00) = 7,515.00
    expect(preview.startingMoney).toBe(751_500);
    expect(preview.oldCardBalance).toBe(298_000);
  });

  it('B48 B64 the halves with no other half, for him to confirm; the paired ones are not asked about', () => {
    const halves = halvesInTransitIn(madeUpHistory(BANK), SETUP_DAY, 10);
    expect(halves.map((h) => [h.id, h.kind, h.from, h.to, h.amount])).toEqual([
      ['left', 'transfer-sent', 'checking', 'everyday-card', 20_000],
      ['landed', 'transfer-arrived', 'checking', 'savings', 10_000],
    ]);
  });

  it('B48 the starting money follows his answers: what left is added, what landed first is taken off', () => {
    const history = madeUpHistory(BANK);
    expect(setupPreviewOf(history, ['left']).startingMoney).toBe(751_500 + 20_000);
    expect(setupPreviewOf(history, ['landed']).startingMoney).toBe(751_500 - 10_000);
    expect(setupPreviewOf(history, ['left', 'landed']).startingMoney).toBe(751_500 + 20_000 - 10_000);
  });

  it('section 2 the bank rule that read each half is named; an item no rule read has none', () => {
    const history = madeUpHistory(BANK);
    expect(bankRuleOf(history, 'left')?.id).toBe('card-paid');
    expect(bankRuleOf(history, 'landed')?.id).toBe('from-chk');
    expect(bankRuleOf(history, 'p-chk')).toBeNull();
    expect(bankRuleOf(history, 'no-such-item')).toBeNull();
  });

  it('14.3 the plan: refused unless it adds up to the cent, and it changes nothing', () => {
    const history = madeUpHistory(BANK);
    const before = JSON.stringify([...history.items.values()]);
    expect(planSetup(history, choices({ assignment: ASSIGNMENT(231_499) }))).toEqual({ ok: false, startingMoney: 751_500, assigned: 751_499, difference: 1 });
    expect(planSetup(history, choices({ assignment: ASSIGNMENT(231_501) }))).toEqual({ ok: false, startingMoney: 751_500, assigned: 751_501, difference: -1 });
    const plan = planSetup(history, choices({ assignment: ASSIGNMENT(231_500) }));
    if (!plan.ok) throw new Error('did not add up');
    expect(plan.book.pots()).toEqual({ ...ASSIGNMENT(231_500), unsortedIn: 0, unsortedOut: 0 });
    expect(plan.book.selfCheck(plan.bank)).toMatchObject({ ok: true, difference: 0 });
    // The old card's pending charge is debt, not starting money (12.4, A10).
    expect(plan.book.oldCardDebt()).toBe(298_900);
    // The pending charges go to the book; pending money in waits until it posts.
    expect(plan.items.map((i) => [i.transactionId, i.status])).toEqual(
      expect.arrayContaining([
        ['p-chk', 'sent'],
        ['p-card', 'sent'],
        ['p-old', 'sent'],
        ['p-in', 'waiting'],
      ]),
    );
    expect(JSON.stringify([...history.items.values()])).toBe(before);
  });

  it('14.3 with halves on their way: the self-check passes with them in transit (12.5)', () => {
    const plan = planSetup(madeUpHistory(BANK), choices({ inTransit: ['left', 'landed'], assignment: ASSIGNMENT(231_500 + 10_000) }));
    if (!plan.ok) throw new Error('did not add up');
    expect(plan.book.selfCheck(plan.bank)).toMatchObject({ ok: true, inTransit: 10_000 });
  });

  it('B42 a last paycheck after setup day is refused, and nothing is planned', () => {
    expect(() => planSetup(madeUpHistory(BANK), choices({ assignment: ASSIGNMENT(231_500), lastPaycheckDate: '2026-10-02' }))).toThrow(MoneyError);
  });

  it('14 not ready: no bank yet, the history still coming, accounts missing, or done already', () => {
    const ready = madeUpHistory(BANK);
    expect(notReadyWhy(ready)).toBeNull();
    expect(notReadyWhy({ ...ready, connection: null })).toMatch(/no bank connection/);
    expect(notReadyWhy({ ...ready, connection: { historyComplete: false } })).toMatch(/history/);
    expect(notReadyWhy({ ...ready, accounts: ready.accounts.filter((a) => a.role !== 'savings') })).toMatch(/savings/);
    expect(notReadyWhy({ ...ready, setUp: true })).toMatch(/done already/);
    expect(() => planSetup({ ...ready, setUp: true }, choices({ assignment: ASSIGNMENT(231_500) }))).toThrow(/done already/);
  });
});

describe('14 the database is a thin wrapper around the same logic', () => {
  async function bank(): Promise<Awaited<ReturnType<typeof connected>>> {
    return connected({
      history: (fake) => {
        fake.addPending({ id: 'p-chk', account: ACCOUNT_IDS.checking, amount: 2_500, date: '2026-09-30', description: 'GROCERY STORE' });
        fake.addPending({ id: 'p-in', account: ACCOUNT_IDS.checking, amount: -7_000, date: '2026-09-30', description: 'STORE REFUND' });
        fake.addPosted({ id: 'left', account: ACCOUNT_IDS.checking, amount: 20_000, date: '2026-09-30', description: 'Online payment to CRD 3333' });
      },
    });
  }

  it('14 what the database holds, read as history, gives the same preview and halves', async () => {
    const h = await bank();
    const history: BankHistory = bankHistoryOf(h.db);
    expect(setupPreviewOf(history, ['left'])).toEqual(setupPreview(h.db, ['left']));
    expect(halvesInTransitIn(history, SETUP_DAY, 10)).toEqual(halvesInTransit(h.db, SETUP_DAY, 10));
  });

  it('14 the plan on the history is the book the database keeps after setup day', async () => {
    const h = await bank();
    const money = setupPreview(h.db, ['left']).startingMoney;
    const c = choices({ inTransit: ['left'], assignment: ASSIGNMENT(money - 520_000) });
    const plan = planSetup(bankHistoryOf(h.db), c);
    if (!plan.ok) throw new Error('did not add up');
    const untouched = dump(h.db);
    expect(dump(h.db)).toEqual(untouched);
    expect(setUpTracking(h.db, c)).toEqual({ ok: true, startingMoney: plan.startingMoney });
    expect(loadBook(h.db)?.pots()).toEqual(plan.book.pots());
    const saved = readItems(h.db);
    for (const item of plan.items) expect(saved.get(item.transactionId)).toEqual(item);
  });

  it('14 once set up, the history says so, and setting up again is refused', async () => {
    const h = await bank();
    const money = setupPreview(h.db, []).startingMoney;
    expect(setUpTracking(h.db, choices({ assignment: ASSIGNMENT(money - 520_000) })).ok).toBe(true);
    expect(bankHistoryOf(h.db).setUp).toBe(true);
    expect(notReadyWhy(bankHistoryOf(h.db))).toMatch(/done already/);
  });
});
