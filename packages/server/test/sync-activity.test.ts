import { describe, expect, it } from 'vitest';
import { readItems } from '../src/db/store.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { book, status, tracking, type Harness } from './harness.js';

// Bank activity after setup day, from the made-up test bank to the book, one
// sync at a time. After every sync the self-check must pass against the
// bank's balances (12.3). Every name and number is made up.
const C = ACCOUNT_IDS.checking;
const S = ACCOUNT_IDS.savings;
const E = ACCOUNT_IDS.everyday;
const O = ACCOUNT_IDS.old;

async function syncAndCheck(h: Harness, today: string): Promise<void> {
  await h.sync(today);
  expect(status(h).selfCheck, `self-check on ${today}`).toMatchObject({ ok: true, difference: 0 });
}

describe('4 spending, from the bank', () => {
  it('4.1 and 4.2 a purchase comes out of the bucket its rule picks', async () => {
    const h = await tracking();
    const before = book(h).pots();
    h.fake.addPosted({ id: 'coffee', account: C, amount: 450, date: '2026-10-02', description: 'COFFEE SHOP 12' });
    h.fake.addPosted({ id: 'food', account: E, amount: 6_789, date: '2026-10-02', description: 'GROCERY OUTLET' });
    await syncAndCheck(h, '2026-10-02');
    const after = book(h).pots();
    expect(after.wants).toBe(before.wants - 450);
    expect(after.needs).toBe(before.needs - 6_789);
  });

  it('4.3 a purchase no rule picks waits in review, held back from safe to spend', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'mystery', account: C, amount: 1_999, date: '2026-10-02', description: 'SOMEWHERE NEW' });
    await syncAndCheck(h, '2026-10-02');
    const b = book(h);
    expect(b.pots().unsortedOut).toBe(1_999);
    expect(b.reviewItems().map((r) => r.id)).toEqual(['mystery']);
  });

  it('4.1 a purchase comes out on the day it was made, not the day it posted', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'late', account: E, amount: 1_000, date: '2026-10-04', authorizedDate: '2026-10-02', description: 'COFFEE' });
    await syncAndCheck(h, '2026-10-04');
    expect(book(h).purchases().find((p) => p.id === 'late')?.date).toBe('2026-10-02');
  });

  it('4.6 a pending charge counts once, and the posted one replaces it, even at a new amount (a tip)', async () => {
    const h = await tracking();
    const wants = book(h).pots().wants;
    h.fake.addPending({ id: 'dinner', account: E, amount: 4_000, date: '2026-10-02', description: 'COFFEE BAR' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).pots().wants).toBe(wants - 4_000);
    h.fake.postPending('dinner', { id: 'dinner-posted', date: '2026-10-04', amount: 4_800 });
    await syncAndCheck(h, '2026-10-04');
    const b = book(h);
    expect(b.pots().wants).toBe(wants - 4_800);
    expect(b.purchases().filter((p) => p.description.includes('COFFEE BAR'))).toHaveLength(1);
    expect(b.purchases().find((p) => p.id === 'dinner')).toMatchObject({ pending: false, amount: 4_800, date: '2026-10-02' });
    expect(readItems(h.db).get('dinner')).toMatchObject({ removed: true, replacedBy: 'dinner-posted' });
  });

  it('4.6 the posting and its removal can come in either order across pages', async () => {
    const h = await tracking();
    h.fake.addPending({ id: 'p', account: C, amount: 1_500, date: '2026-10-02', description: 'GROCERY' });
    await syncAndCheck(h, '2026-10-02');
    h.fake.postPending('p', { id: 'p-posted', date: '2026-10-03' });
    // One change per page, so the removal and the posting are on different pages.
    await h.sync('2026-10-03', { pageSize: 1 });
    expect(status(h).selfCheck?.ok).toBe(true);
    expect(book(h).purchases().filter((x) => x.id === 'p')).toHaveLength(1);
  });

  it('4.6 a pending charge that posts under its own id', async () => {
    const h = await tracking();
    const needs = book(h).pots().needs;
    h.fake.addPending({ id: 'gas', account: C, amount: 3_000, date: '2026-10-02', description: 'GAS STATION 7' });
    await syncAndCheck(h, '2026-10-02');
    h.fake.postInPlace('gas', { date: '2026-10-03', amount: 3_456 });
    await syncAndCheck(h, '2026-10-03');
    expect(book(h).pots().needs).toBe(needs - 3_456);
    expect(book(h).purchases().find((p) => p.id === 'gas')).toMatchObject({ pending: false, amount: 3_456 });
  });

  it('4.6 a posted charge whose pending one was never seen is simply a purchase', async () => {
    const h = await tracking();
    h.fake.addPending({ id: 'quick', account: C, amount: 800, date: '2026-10-02', description: 'COFFEE' });
    h.fake.postPending('quick', { id: 'quick-posted', date: '2026-10-02' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).purchases().map((p) => p.id)).toEqual(['quick-posted']);
  });

  it('A2 a pending charge the bank drops without posting gives its money back', async () => {
    const h = await tracking();
    const needs = book(h).pots().needs;
    h.fake.addPending({ id: 'hold', account: E, amount: 10_000, date: '2026-10-02', description: 'GAS STATION HOLD' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).pots().needs).toBe(needs - 10_000);
    h.fake.dropPending('hold');
    await syncAndCheck(h, '2026-10-03');
    expect(book(h).pots().needs).toBe(needs);
    expect(book(h).reviewItems()).toEqual([]);
  });

  it('A2 a dropped charge whose posted version shows up later is a new purchase then', async () => {
    const h = await tracking();
    h.fake.addPending({ id: 'hotel', account: E, amount: 20_000, date: '2026-10-02', description: 'GROCERY HOTEL' });
    await syncAndCheck(h, '2026-10-02');
    // The bank drops the hold in one update, and posts the real charge,
    // linked to it, only in a later one.
    h.fake.dropPending('hotel');
    await syncAndCheck(h, '2026-10-03');
    h.fake.addPosted({ id: 'hotel-final', account: E, amount: 18_000, date: '2026-10-05', description: 'GROCERY HOTEL' });
    await syncAndCheck(h, '2026-10-05');
    expect(book(h).purchases().find((p) => p.id === 'hotel-final')).toMatchObject({ amount: 18_000, pending: false });
  });

  it('4.5 money back on a card waits in review, since the bank does not say which purchase it was for', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'return', account: E, amount: -2_500, date: '2026-10-02', description: 'STORE RETURN' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).reviewItems()).toMatchObject([{ type: 'money-in', id: 'return', amount: 2_500, reason: 'refund' }]);
  });

  it('4.8 interest on the everyday card waits in review, needs suggested', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'int', account: E, amount: 1_234, date: '2026-10-02', description: 'INTEREST CHARGE ON PURCHASES' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).reviewItems()).toMatchObject([{ type: 'spending', id: 'int', reason: 'card-interest', suggestion: 'needs' }]);
  });

  it('5.4 a new purchase on the old card is flagged and raises the debt, and no bucket', async () => {
    const h = await tracking();
    const before = book(h);
    h.fake.addPosted({ id: 'oops', account: O, amount: 2_500, date: '2026-10-02', description: 'HARDWARE STORE' });
    await syncAndCheck(h, '2026-10-02');
    const after = book(h);
    expect(after.pots()).toEqual(before.pots());
    expect(after.oldCardDebt()).toBe(before.oldCardDebt() + 2_500);
    expect(after.reviewItems()).toMatchObject([{ type: 'old-card-purchase', id: 'oops' }]);
    expect(status(h).oldCard?.difference).toBe(0);
  });

  it('5.5 interest on the old card raises the debt, and no bucket', async () => {
    const h = await tracking();
    const before = book(h);
    h.fake.addPosted({ id: 'oint', account: O, amount: 4_321, date: '2026-10-02', description: 'INTEREST CHARGE ON PURCHASES' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).pots()).toEqual(before.pots());
    expect(book(h).oldCardDebt()).toBe(before.oldCardDebt() + 4_321);
    expect(status(h).oldCard?.difference).toBe(0);
  });
});

describe('5 and 12.5 transfers and card payments, from the bank', () => {
  it('5.3 checking to savings changes no bucket; both halves on one day leave nothing in transit', async () => {
    const h = await tracking();
    const pots = book(h).pots();
    h.fake.addPosted({ id: 'out', account: C, amount: 50_000, date: '2026-10-02', description: 'Online Banking transfer to SAV 2222 Conf# 1' });
    h.fake.addPosted({ id: 'in', account: S, amount: -50_000, date: '2026-10-02', description: 'Online Banking transfer from CHK 1111 Conf# 1' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).pots()).toEqual(pots);
    expect(status(h).inTransit?.items).toEqual([]);
  });

  it('5.3 savings to checking changes no bucket either', async () => {
    const h = await tracking();
    const pots = book(h).pots();
    h.fake.addPosted({ id: 'in', account: C, amount: -30_000, date: '2026-10-02', description: 'Online Banking transfer from SAV 2222' });
    h.fake.addPosted({ id: 'out', account: S, amount: 30_000, date: '2026-10-02', description: 'Online Banking transfer to CHK 1111' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).pots()).toEqual(pots);
    expect(status(h).inTransit?.items).toEqual([]);
  });

  it('5.1 and 12.5 a card payment leaves checking one day and lands the next: in transit between, no bucket changes', async () => {
    const h = await tracking();
    const pots = book(h).pots();
    h.fake.addPosted({ id: 'pay', account: C, amount: 30_000, date: '2026-10-02', description: 'Online payment to CRD 3333' });
    await syncAndCheck(h, '2026-10-02');
    expect(status(h).inTransit?.total).toBe(30_000);
    h.fake.addPosted({ id: 'paid', account: E, amount: -30_000, date: '2026-10-03', description: 'PAYMENT - THANK YOU' });
    await syncAndCheck(h, '2026-10-03');
    expect(status(h).inTransit).toEqual({ total: 0, items: [] });
    expect(book(h).pots()).toEqual(pots);
    expect(book(h).cardPayments('everyday-card')).toEqual([{ date: '2026-10-02', amount: 30_000, landedOn: '2026-10-03' }]);
  });

  it('12.5 a payment seen landing before it shows leaving is in transit as a negative until then', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'paid', account: E, amount: -12_000, date: '2026-10-02', description: 'PAYMENT - THANK YOU' });
    await syncAndCheck(h, '2026-10-02');
    expect(status(h).inTransit?.total).toBe(-12_000);
    h.fake.addPosted({ id: 'pay', account: C, amount: 12_000, date: '2026-10-02', description: 'Online payment to CRD 3333' });
    await syncAndCheck(h, '2026-10-03');
    expect(status(h).inTransit).toEqual({ total: 0, items: [] });
  });

  it('12.5 a card payment from savings pairs, though the card does not say where it came from', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'pay', account: S, amount: 15_000, date: '2026-10-02', description: 'Online payment to CRD 3333' });
    await syncAndCheck(h, '2026-10-02');
    h.fake.addPosted({ id: 'paid', account: E, amount: -15_000, date: '2026-10-03', description: 'PAYMENT - THANK YOU' });
    await syncAndCheck(h, '2026-10-03');
    expect(status(h).inTransit).toEqual({ total: 0, items: [] });
  });

  it('12.5 both halves in one sync, the landing listed first, still pair', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'paid', account: E, amount: -15_000, date: '2026-10-02', description: 'PAYMENT - THANK YOU' });
    h.fake.addPosted({ id: 'pay', account: S, amount: 15_000, date: '2026-10-02', description: 'Online payment to CRD 3333' });
    await syncAndCheck(h, '2026-10-02');
    expect(status(h).inTransit).toEqual({ total: 0, items: [] });
  });

  it('5.2 paying the old card comes out of needs when it leaves checking; the debt goes down when it lands', async () => {
    const h = await tracking();
    const start = book(h);
    h.fake.addPosted({ id: 'pay-old', account: C, amount: 10_000, date: '2026-10-02', description: 'Online payment to CRD 4444' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).pots().needs).toBe(start.pots().needs - 10_000);
    expect(book(h).oldCardDebt()).toBe(start.oldCardDebt());
    h.fake.addPosted({ id: 'old-paid', account: O, amount: -10_000, date: '2026-10-03', description: 'PAYMENT - THANK YOU' });
    await syncAndCheck(h, '2026-10-03');
    expect(book(h).oldCardDebt()).toBe(start.oldCardDebt() - 10_000);
    expect(status(h).oldCard?.difference).toBe(0);
  });

  it('A4 paying the old card from savings waits in review with savings suggested', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'sav-old', account: S, amount: 10_000, date: '2026-10-02', description: 'Online payment to CRD 4444' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).reviewItems()).toMatchObject([{ type: 'spending', id: 'sav-old', reason: 'old-card-from-savings', suggestion: 'savings' }]);
  });
});

describe('3, 6, 7 and 8 money in and payments to people, from the bank', () => {
  it('3.1 a deposit that matches the paycheck rule starts a pay period and is split', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'pay', account: C, amount: -250_000, date: '2026-10-09', description: 'MADEUP CORP PAYROLL DIRECT DEP' });
    await syncAndCheck(h, '2026-10-09');
    const b = book(h);
    expect(b.paychecks().map((p) => [p.id, p.amount])).toEqual([['pay', 250_000]]);
    expect(b.period()).toMatchObject({ number: 1, startDate: '2026-10-09' });
  });

  it('3.7 a paycheck-looking deposit less than 10 days after the last one waits in review', async () => {
    const h = await tracking();
    // The last paycheck before setup day was on Sep 25.
    h.fake.addPosted({ id: 'early', account: C, amount: -250_000, date: '2026-10-02', description: 'MADEUP CORP PAYROLL' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).reviewItems()).toMatchObject([{ type: 'money-in', id: 'early', reason: 'early-paycheck' }]);
  });

  it('6.1 any other deposit waits in review', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'cash', account: S, amount: -5_000, date: '2026-10-02', description: 'MOBILE DEPOSIT' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).reviewItems()).toMatchObject([{ type: 'money-in', id: 'cash', amount: 5_000, reason: 'deposit' }]);
  });

  it('8.1 a payment that matches the mom rule comes out of the mom reserve', async () => {
    const h = await tracking();
    const reserve = book(h).pots().momReserve;
    h.fake.addPosted({ id: 'mom', account: C, amount: 40_000, date: '2026-10-02', description: 'Zelle payment to MOM MADEUP Conf# 9' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).pots().momReserve).toBe(reserve - 40_000);
    expect(book(h).momSentInMonth('2026-10').sent).toBe(40_000);
  });

  it('7.4 a payment to anyone else waits in review', async () => {
    const h = await tracking();
    h.fake.addPosted({ id: 'friend', account: C, amount: 3_000, date: '2026-10-02', description: 'Zelle payment to FRIEND MADEUP' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).reviewItems()).toMatchObject([{ type: 'spending', id: 'friend', reason: 'person-payment' }]);
  });

  it('B36 a pending deposit counts once it posts, in the book and the bank side alike', async () => {
    const h = await tracking();
    const before = status(h).selfCheck;
    h.fake.addPending({ id: 'dep', account: C, amount: -9_900, date: '2026-10-02', description: 'MOBILE DEPOSIT' });
    await syncAndCheck(h, '2026-10-02');
    expect(status(h).selfCheck?.appSide).toBe(before?.appSide);
    expect(readItems(h.db).get('dep')?.status).toBe('waiting');
    h.fake.postPending('dep', { id: 'dep-posted', date: '2026-10-03' });
    await syncAndCheck(h, '2026-10-03');
    expect(status(h).selfCheck?.appSide).toBe((before?.appSide ?? 0) + 9_900);
  });

  it('B36 a pending payment to a person waits until it posts', async () => {
    const h = await tracking();
    h.fake.addPending({ id: 'zp', account: C, amount: 40_000, date: '2026-10-02', description: 'Zelle payment to MOM MADEUP' });
    await syncAndCheck(h, '2026-10-02');
    expect(book(h).momSentInMonth('2026-10').sent).toBe(0);
    h.fake.postInPlace('zp', { date: '2026-10-03' });
    await syncAndCheck(h, '2026-10-03');
    expect(book(h).momSentInMonth('2026-10').sent).toBe(40_000);
  });
});
