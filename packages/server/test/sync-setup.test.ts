import { describe, expect, it } from 'vitest';
import { loadBook, readItems } from '../src/db/store.js';
import { halvesInTransit, setUpTracking, setupPreview } from '../src/setup-day.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { SETTINGS, SETUP_DAY, SORTING_RULES, book, connected, setUp, status } from './harness.js';

// Rulebook section 14, setup day, from what the bank connection synced.
// Every name and number is made up.
describe('14 setup day from the test bank', () => {
  it('14.1 before setup day, everything synced is history, and nothing reaches the book', async () => {
    const h = await connected({
      history: (fake) => {
        fake.addPosted({ id: 'old-1', account: ACCOUNT_IDS.checking, amount: 1_250, date: '2026-09-20', description: 'GROCERY STORE' });
        fake.addPosted({ id: 'old-2', account: ACCOUNT_IDS.checking, amount: -250_000, date: '2026-09-25', description: 'MADEUP CORP PAYROLL' });
      },
    });
    expect(loadBook(h.db)).toBeNull();
    expect([...readItems(h.db).values()].map((i) => i.status)).toEqual(['history', 'history']);
    expect(status(h).tracking).toBe(false);
    expect(status(h).selfCheck).toBeNull();
  });

  it('14.2 the starting money is checking + savings - everyday card, pending charges included', async () => {
    const h = await connected({
      history: (fake) => {
        fake.addPending({ id: 'p-chk', account: ACCOUNT_IDS.checking, amount: 2_500, date: '2026-09-30', description: 'GROCERY STORE' });
        fake.addPending({ id: 'p-card', account: ACCOUNT_IDS.everyday, amount: 1_000, date: '2026-09-30', description: 'COFFEE' });
        // Pending money in does not count until it posts (B36).
        fake.addPending({ id: 'p-in', account: ACCOUNT_IDS.checking, amount: -7_000, date: '2026-09-30', description: 'STORE REFUND' });
        // The old card is not part of it (12.4).
        fake.addPending({ id: 'p-old', account: ACCOUNT_IDS.old, amount: 900, date: '2026-09-30', description: 'HARDWARE' });
      },
    });
    const preview = setupPreview(h.db, []);
    expect(preview.posted).toEqual({ checking: 300_000, savings: 500_000, everydayCard: 45_000 });
    expect(preview.pendingCharges.map((c) => [c.id, c.amount])).toEqual([
      ['p-chk', 2_500],
      ['p-card', 1_000],
      ['p-old', 900],
    ]);
    // (3,000.00 - 25.00) + 5,000.00 - (450.00 + 10.00) = 7,515.00
    expect(preview.startingMoney).toBe(751_500);
    expect(preview.oldCardBalance).toBe(300_000);
  });

  it('14.3 tracking starts only when the assignment adds up exactly, to the cent', async () => {
    const h = await connected();
    const choices = { today: SETUP_DAY, lastPaycheckDate: '2026-09-25', settings: SETTINGS, rules: SORTING_RULES, inTransit: [] };
    const short = setUpTracking(h.db, { ...choices, assignment: { savings: 400_000, needs: 334_999, wants: 20_000, momReserve: 0, heldForOthers: 0 } });
    expect(short).toEqual({ ok: false, startingMoney: 755_000, assigned: 754_999, difference: 1 });
    expect(loadBook(h.db)).toBeNull();
    const ok = setUpTracking(h.db, { ...choices, assignment: { savings: 400_000, needs: 335_000, wants: 20_000, momReserve: 0, heldForOthers: 0 } });
    expect(ok).toEqual({ ok: true, startingMoney: 755_000 });
    expect(status(h).selfCheck).toMatchObject({ ok: true, difference: 0, bankSide: 755_000, appSide: 755_000 });
  });

  it('14.3 the self-check passes right after setup day, with charges pending', async () => {
    const h = await connected({
      history: (fake) => {
        fake.addPending({ id: 'p-chk', account: ACCOUNT_IDS.checking, amount: 2_500, date: '2026-09-30', description: 'GROCERY STORE' });
        fake.addPending({ id: 'p-card', account: ACCOUNT_IDS.everyday, amount: 1_000, date: '2026-09-30', description: 'COFFEE' });
      },
    });
    expect(setUp(h).ok).toBe(true);
    expect(status(h).selfCheck).toMatchObject({ ok: true, difference: 0, bankSide: 751_500 });
    expect(readItems(h.db).get('p-chk')?.status).toBe('sent');
  });

  it('A10 a charge pending on setup day counts once; posted at a new amount, only the difference waits', async () => {
    const h = await connected({
      history: (fake) => fake.addPending({ id: 'p-chk', account: ACCOUNT_IDS.checking, amount: 2_500, date: '2026-09-30', description: 'GROCERY STORE' }),
    });
    setUp(h);
    const needsBefore = book(h).pots().needs;
    h.fake.postPending('p-chk', { id: 'p-chk-final', date: '2026-10-02', amount: 2_750 });
    await h.sync('2026-10-02');
    const b = book(h);
    expect(b.pots().needs).toBe(needsBefore);
    expect(b.pots().unsortedOut).toBe(250);
    expect(b.reviewItems().map((r) => [r.type, r.amount])).toEqual([['spending', 250]]);
    expect(status(h).selfCheck?.ok).toBe(true);
  });

  it('A10 and A2 a charge pending on setup day that is dropped gives its money back', async () => {
    const h = await connected({
      history: (fake) => fake.addPending({ id: 'hold', account: ACCOUNT_IDS.everyday, amount: 10_000, date: '2026-09-30', description: 'GAS STATION HOLD' }),
    });
    setUp(h);
    const appBefore = status(h).selfCheck?.appSide ?? 0;
    h.fake.dropPending('hold');
    await h.sync('2026-10-02');
    expect(status(h).selfCheck).toMatchObject({ ok: true, appSide: appBefore + 10_000 });
  });

  it('B48 money on its way on setup day counts in the starting money, and pairs when it lands', async () => {
    const h = await connected({
      history: (fake) => fake.addPosted({ id: 'left', account: ACCOUNT_IDS.checking, amount: 20_000, date: '2026-09-30', description: 'Online payment to CRD 3333' }),
    });
    const halves = halvesInTransit(h.db, SETUP_DAY, 10);
    expect(halves.map((half) => [half.id, half.kind, half.to, half.amount])).toEqual([['left', 'transfer-sent', 'everyday-card', 20_000]]);
    // 3,000.00 - 200.00 left checking, + 5,000.00 - 450.00 still owed, + 200.00 on its way
    expect(setupPreview(h.db, ['left']).startingMoney).toBe(755_000);
    expect(setUp(h, { inTransit: ['left'] }).ok).toBe(true);
    expect(status(h).selfCheck).toMatchObject({ ok: true, inTransit: 20_000 });
    h.fake.addPosted({ id: 'landed', account: ACCOUNT_IDS.everyday, amount: -20_000, date: '2026-10-02', description: 'PAYMENT - THANK YOU' });
    await h.sync('2026-10-02');
    expect(status(h).selfCheck).toMatchObject({ ok: true, inTransit: 0 });
    expect(book(h).inTransit().items).toEqual([]);
  });

  it('B48 halves that found their other half in the history are not on their way', async () => {
    const h = await connected({
      history: (fake) => {
        fake.addPosted({ id: 'out', account: ACCOUNT_IDS.checking, amount: 50_000, date: '2026-09-28', description: 'Online Banking transfer to SAV 2222' });
        fake.addPosted({ id: 'in', account: ACCOUNT_IDS.savings, amount: -50_000, date: '2026-09-28', description: 'Online Banking transfer from CHK 1111' });
        fake.addPosted({ id: 'long-ago', account: ACCOUNT_IDS.checking, amount: 10_000, date: '2026-08-01', description: 'Online payment to CRD 4444' });
      },
    });
    expect(halvesInTransit(h.db, SETUP_DAY, 10)).toEqual([]);
    expect(halvesInTransit(h.db, SETUP_DAY, 90).map((half) => half.id)).toEqual(['long-ago']);
  });

  it('14 setup day waits for the whole history, needs all four accounts, and happens once', async () => {
    const early = await connected({ history: (fake) => (fake.historyComplete = false) });
    expect(() => setUp(early)).toThrow(/history/);
    early.fake.historyComplete = true;
    await early.sync(SETUP_DAY);
    expect(setUp(early).ok).toBe(true);
    expect(() => setUp(early)).toThrow(/done already/);
  });
});
