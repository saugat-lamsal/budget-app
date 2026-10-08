import type { Book } from '../src/index.js';
import { MOM_NAME, arrived, cardCharge, deposit, dropped, openTestBook, payPerson, paycheck, posted, purchase, refund, sent, takenBack, transfer, withdrawal } from './helpers.js';

// One book with every kind of item that has been sorted already (not waiting
// in review): purchases of each sort, fees, money out of savings, payments to
// people (including mom), money in of each sort, and the things that cannot be
// sorted again. For checking that the choices offered for sorting an item again
// (rule 4.7) are the ones the book accepts. Made-up names only.
//
// The ids of what is on it, by what they are.
export const SORTED = {
  // Spending
  card: 'card-buy',
  pending: 'pending-buy',
  checking: 'checking-buy',
  split: 'split-buy',
  partRefunded: 'part-refunded-buy',
  fee: 'fee',
  interest: 'interest',
  fromSavings: 'bill',
  oldCardFromSavings: 'old-from-savings',
  oldCardFromChecking: 'old-from-checking',
  oldCardHalf: 'old-half',
  // Payments to people
  friendNeeds: 'friend-needs',
  friendNotMine: 'friend-not-mine',
  friendMomByHand: 'friend-mom',
  momRule: 'mom-rule',
  momDifference: 'mom-big:difference',
  // Money in
  otherIncome: 'income',
  paybackWants: 'payback',
  notMine: 'roommate',
  lateArrival: 'late',
  inSavings: 'interest-in-savings',
  refundPayback: 'refund-payback',
  // Things that cannot be sorted again
  paycheck: 'pay',
  matchedRefund: 'matched-refund',
  answeredLeftover: 'leftover:pay:needs',
  handMove: 'move:1',
  takenBack: 'taken',
  dropped: 'hold',
  markedTransferOldCard: 'marked-old-card',
  markedTransferDeposit: 'marked-deposit',
  halfArrived: 'half',
  // Waiting in review
  waiting: 'waiting',
} as const;

export function sortedBook(): Book {
  const b = openTestBook({
    lastPaycheckDate: '2026-09-18',
    pots: { savings: 800_000, needs: 31_250, wants: 18_400, momReserve: 120_000 },
    rules: [
      { id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
      { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
    ],
  });
  b.receive(paycheck('pay', '2026-10-02', 420_000));
  b.answerLeftover('leftover:pay:needs', 'roll-over', '2026-10-02');
  b.answerLeftover('leftover:pay:wants', 'move-to-savings', '2026-10-02');

  // Spending, sorted by a rule or by hand
  b.receive(purchase('card-buy', '2026-10-03', 3_250, 'MADE UP GROCERY'));
  b.receive(purchase('pending-buy', '2026-10-03', 1_000, 'MADE UP CAFE', { pending: true }));
  b.receive(purchase('checking-buy', '2026-10-03', 5_400, 'MADE UP GROCERY', { account: 'checking' }));
  b.receive(purchase('split-buy', '2026-10-03', 9_000, 'MADE UP HARDWARE', { account: 'checking' }));
  b.sort('split-buy', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 3_000 }] }, '2026-10-04');
  b.receive(purchase('part-refunded-buy', '2026-10-03', 4_000, 'MADE UP GROCERY', { account: 'checking' }));
  b.receive(refund('part-refund', '2026-10-05', 1_000, 'part-refunded-buy', 'checking'));
  b.receive(cardCharge('fee', '2026-10-04', 3_500, 'fee'));
  b.sort('fee', { to: 'needs' }, '2026-10-05');
  b.receive(cardCharge('interest', '2026-10-04', 1_842, 'interest'));
  b.sort('interest', { to: 'wants' }, '2026-10-05');
  b.receive(withdrawal('bill', '2026-10-04', 6_410, 'MADE UP BILL PAY'));
  b.sort('bill', { to: 'wants' }, '2026-10-05');
  b.receive(transfer('old-from-savings', '2026-10-04', 20_000, 'savings', 'old-card'));
  b.sort('old-from-savings', { to: 'savings' }, '2026-10-05');
  b.receive(transfer('old-from-checking', '2026-10-04', 15_000, 'checking', 'old-card'));
  b.receive(sent('old-half', '2026-10-04', 5_000, 'checking', 'old-card'));

  // Payments to people
  b.receive(payPerson('friend-needs', '2026-10-05', 4_000, 'ALPHA FRIEND'));
  b.sort('friend-needs', { to: 'needs' }, '2026-10-06');
  b.receive(payPerson('friend-not-mine', '2026-10-05', 3_000, 'BRAVO FRIEND'));
  b.sort('friend-not-mine', { to: 'not-mine' }, '2026-10-06');
  b.receive(payPerson('friend-mom', '2026-10-05', 2_000, 'CHARLIE FRIEND'));
  b.sort('friend-mom', { to: 'mom' }, '2026-10-06');
  b.receive(payPerson('mom-rule', '2026-10-05', 50_000, MOM_NAME));
  b.receive(payPerson('mom-big', '2026-10-05', 2_500_000, MOM_NAME));
  b.sort('mom-big:difference', { to: 'needs' }, '2026-10-06');

  // Money in
  b.receive(deposit('income', '2026-10-06', 25_000, 'MADE UP SIDE JOB'));
  b.sort('income', { to: 'other-income' }, '2026-10-06');
  b.receive(deposit('payback', '2026-10-06', 5_000, 'MADE UP FRIEND PAYBACK'));
  b.sort('payback', { to: 'wants' }, '2026-10-06');
  b.receive(deposit('roommate', '2026-10-06', 12_000, 'MADE UP ROOMMATE'));
  b.sort('roommate', { to: 'not-mine' }, '2026-10-06');
  b.receive(deposit('late', '2026-09-20', 25_000, 'MADE UP LATE ARRIVAL'));
  b.sort('late', { to: 'needs' }, '2026-10-06');
  b.receive(deposit('interest-in-savings', '2026-10-06', 9_000, 'MADE UP INTEREST', 'savings'));
  b.sort('interest-in-savings', { to: 'savings' }, '2026-10-06');
  b.receive(purchase('shop', '2026-10-01', 2_317, 'ONLINE MARKETPLACE'));
  b.sort('shop', { to: 'wants' }, '2026-10-01');
  b.receive(refund('refund-payback', '2026-10-06', 2_317, undefined, 'everyday-card'));
  b.sort('refund-payback', { to: 'wants' }, '2026-10-06');
  b.receive(purchase('matched-buy', '2026-10-02', 800, 'MADE UP GROCERY'));
  b.receive(refund('matched-refund', '2026-10-06', 800, 'matched-buy'));

  // Things that cannot be sorted again
  b.moveMoney({ from: 'wants', to: 'needs', amount: 500 }, '2026-10-07');
  b.receive(purchase('taken', '2026-10-03', 10_000, 'MADE UP SHOP', { account: 'checking' }));
  b.receive(takenBack('taken-back', 'taken', '2026-10-04'));
  b.receive(purchase('hold', '2026-10-03', 10_000, 'MADE UP HOLD', { account: 'checking', pending: true }));
  b.receive(dropped('hold-dropped', 'hold', '2026-10-04'));
  b.receive(purchase('marked-old-card', '2026-10-04', 6_000, 'MADE UP LANDLORD', { account: 'checking' }));
  b.sort('marked-old-card', { transfer: 'old-card' }, '2026-10-05');
  b.receive(deposit('marked-deposit', '2026-10-06', 7_000, 'MADE UP TRANSFER IN'));
  b.sort('marked-deposit', { transfer: 'savings' }, '2026-10-06');
  b.receive(arrived('half', '2026-10-06', 5_000, 'checking', 'savings'));

  // Waiting in review
  b.receive(purchase('waiting', '2026-10-07', 1_150, 'MADE UP CORNER STORE'));

  // A pending charge that posted at a new amount, so it has two ids.
  b.receive(posted('pending-buy-posted', 'pending-buy', '2026-10-05', 1_100, 'MADE UP CAFE'));
  return b;
}
