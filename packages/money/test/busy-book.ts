import type { Book } from '../src/index.js';
import { MOM_NAME, arrived, cardCharge, deposit, openTestBook, payPerson, paycheck, posted, purchase, refund, sent, transfer, withdrawal } from './helpers.js';

// One book with every kind of item waiting in review: leftover questions,
// deposits of each reason, a refund, purchases (pending, on the card, on the
// debit card), money out of savings, fees, a payment to the old card, payments
// to people, a mom payment bigger than the reserve, a split that came back,
// and a charge pending on setup day that posted at a new amount. Made-up
// names only.
export function busyBook(): Book {
  const b = openTestBook({
    lastPaycheckDate: '2026-09-18',
    pots: { savings: 800_000, needs: 31_250, wants: 18_400, momReserve: 120_000 },
    countedAtSetup: [purchase('setup', '2026-09-30', 1_000, 'GAS HOLD', { account: 'checking', pending: true })],
  });
  // A paycheck on time: leftover questions for needs and wants (3.4).
  b.receive(paycheck('pay', '2026-10-02', 420_000));
  b.receive(posted('setup-posted', 'setup', '2026-10-02', 1_250, 'GAS STATION', 'checking'));
  b.receive(deposit('tax', '2026-10-03', 25_000, 'MADE UP TAX REFUND'));
  b.receive(deposit('tax-savings', '2026-10-03', 9_000, 'MADE UP INTEREST', 'savings'));
  b.receive(deposit('old', '2026-09-20', 25_000, 'MADE UP LATE ARRIVAL'));
  b.receive(paycheck('early', '2026-10-06', 300_000));
  b.receive(purchase('market', '2026-10-06', 2_317, 'ONLINE MARKETPLACE'));
  b.receive(purchase('store', '2026-10-06', 1_150, 'CORNER STORE', { account: 'checking' }));
  b.receive(purchase('pending', '2026-10-07', 625, 'BLUE DOOR COFFEE', { pending: true }));
  b.receive(purchase('pending-debit', '2026-10-07', 900, 'HARBOR DINER', { account: 'checking', pending: true }));
  b.receive(refund('refund', '2026-10-08', 2_317, undefined, 'everyday-card'));
  b.receive(refund('refund-checking', '2026-10-08', 100, undefined, 'checking'));
  b.receive(withdrawal('bill', '2026-10-08', 6_410, 'BILL PAY WATER'));
  b.receive(withdrawal('bill-pending', '2026-10-09', 1_000, 'BILL PAY GAS', { pending: true }));
  b.receive(cardCharge('fee', '2026-10-09', 3_500, 'fee'));
  b.receive(cardCharge('interest', '2026-10-09', 1_842, 'interest'));
  b.receive(transfer('old-pay', '2026-10-09', 20_000, 'savings', 'old-card'));
  b.receive(sent('old-sent', '2026-10-09', 5_000, 'savings', 'old-card'));
  b.receive(purchase('old-buy', '2026-10-09', 8_000, 'FURNITURE', { account: 'old-card' }));
  b.receive(payPerson('friend', '2026-10-10', 4_000, 'ALPHA FRIEND'));
  b.receive(payPerson('friend-savings', '2026-10-10', 4_000, 'BRAVO FRIEND', 'savings'));
  b.receive(payPerson('friend-refunded', '2026-10-10', 4_000, 'CHARLIE FRIEND'));
  b.receive(refund('friend-part', '2026-10-11', 1_000, 'friend-refunded', 'checking'));
  b.receive(payPerson('mom-big', '2026-10-11', 2_500_000, MOM_NAME));
  // A split purchase, partly refunded, so it comes back to be split again (A1).
  b.receive(purchase('hardware', '2026-10-05', 9_000, 'HARDWARE', { account: 'checking' }));
  b.sort('hardware', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 3_000 }] }, '2026-10-05');
  b.receive(refund('hardware-part', '2026-10-12', 1_000, 'hardware', 'checking'));
  // What is left of a purchase the bank took back, and of a pending charge it dropped, after a part was refunded (4.10, A2).
  b.receive(purchase('taken', '2026-10-02', 10_000, 'MADE UP SHOP', { account: 'checking' }));
  b.receive(refund('taken-part', '2026-10-03', 4_000, 'taken', 'checking'));
  b.receive({ kind: 'taken-back', id: 'taken-back', takenId: 'taken', date: '2026-10-04', description: 'CORRECTION' });
  b.receive(purchase('hold', '2026-10-02', 10_000, 'MADE UP HOLD', { account: 'checking', pending: true }));
  b.receive(refund('hold-part', '2026-10-03', 4_000, 'hold', 'checking'));
  b.receive({ kind: 'pending-dropped', id: 'hold-dropped', pendingId: 'hold', date: '2026-10-04', description: 'HOLD RELEASED' });
  // Tiny amounts.
  b.receive(purchase('one-cent', '2026-10-12', 1, 'TINY'));
  b.receive(purchase('two-cents', '2026-10-12', 2, 'TINY'));
  b.receive(arrived('half', '2026-10-12', 5_000, 'checking', 'savings'));
  return b;
}

