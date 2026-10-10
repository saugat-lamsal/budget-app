import { DEFAULT_SETTINGS, type SortingRule } from '../../src/index.js';
import type { LifePlan } from './life.js';

// Phase 4's finish line: one full pay period, lived by the simulator as
// planned, so that it has in it everything the screens must get right, and
// played through the real server and the screens (packages/web,
// test/browser/pay-period). Setup day on Thursday Oct 1, 2026; the last
// paycheck before it on Sep 18; a paycheck on Oct 2, and the next one on
// Oct 16, the last day. Every name and number is made up.
//
// What happens, day by day (the simulator works out every bucket from the
// rulebook, and checks its own book against it every day):
// Oct 1  setup day: a grocer charge pending on the everyday card, a cafe
//        charge pending on checking, and a $200.00 card payment on its way.
//        That evening: the paycheck rule, the mom rule, three sorting rules.
// Oct 2  the paycheck (3.1 to 3.3); the card payment lands.
// Oct 3  the cafe charge from setup day posts with a tip: only the
//        difference waits (14.2); the payday questions (3.4).
// Oct 3  a restaurant charge, pending; it posts on Oct 5 with a tip (4.6).
// Oct 4  a big box purchase, split (4.4); gas.
// Oct 5  an online order; a payment to mom (8.1).
// Oct 6  the pharmacy; a cinema charge left in review until Oct 7, when it
//        posts at a new amount (on the screens: a tap refused, 13.7).
// Oct 7  a hand move from wants to needs (13.3).
// Oct 8  part of the online order refunded on the everyday card, matched by
//        hand (4.5); gas charged twice.
// Oct 9  a friend pays him back (7.5); a payment to the old card, on its way
//        (5.2, 12.5); a new split for the next paycheck (13.1).
// Oct 10 the copy of the gas charge taken back (4.10); an online order on
//        the debit card; a new sorting rule, moved up (13.2).
// Oct 11 the online order of Oct 5 sorted again (4.7).
// Oct 12 a refund on the old card (B13); an everyday card payment on its way.
// Oct 13 the debit card order refunded in full, as money in to checking,
//        matched to it (A29).
// Oct 16 the next paycheck, with the new split, the mom reserve at its cap
//        (3.2); the payday questions.

const rule = (id: string, contains: string, bucket: 'needs' | 'wants'): SortingRule => ({ id, for: 'purchase', contains, bucket });

export const PAY_PERIOD: LifePlan = {
  start: '2026-10-01',
  lastPaycheck: '2026-09-18',
  days: 16,
  pay: 320_000,
  posted: { checking: 241_236, savings: 615_000, everydayCard: 41_827, oldCard: 287_455 },
  pendingAtSetup: [
    { label: 'grocer-at-setup', date: '2026-09-30', account: 'everyday-card', amount: 5_840, store: 'MADE UP GROCER', postsOn: '2026-10-02' },
    { label: 'cafe-at-setup', date: '2026-10-01', account: 'checking', amount: 625, store: 'MADE UP CAFE', postsOn: '2026-10-03', postsAt: 775 },
  ],
  onTheirWayAtSetup: [{ date: '2026-09-30', from: 'checking', card: 'everyday-card', amount: 20_000, landsOn: '2026-10-02' }],
  momReserve: 100_000,
  settings: DEFAULT_SETTINGS,
  rules: [],
  bank: {
    '2026-10-02': [
      { kind: 'paycheck', amount: 320_000 },
      { kind: 'shop', label: 'cafe-1', store: 'MADE UP CAFE', account: 'checking', amount: 485, pending: { postsOn: '2026-10-03' } },
    ],
    '2026-10-03': [{ kind: 'shop', label: 'restaurant-1', store: 'MADE UP RESTAURANT', account: 'everyday-card', amount: 4_620, pending: { postsOn: '2026-10-05', postsAt: 5_544 } }],
    '2026-10-04': [
      { kind: 'shop', label: 'big-box-1', store: 'MADE UP BIG BOX', account: 'checking', amount: 14_280 },
      { kind: 'shop', label: 'gas-1', store: 'MADE UP GAS', account: 'everyday-card', amount: 4_110 },
    ],
    '2026-10-05': [
      { kind: 'shop', label: 'online-1', store: 'MADE UP ONLINE SHOP', account: 'everyday-card', amount: 8_999 },
      { kind: 'mom', amount: 60_000, from: 'checking' },
    ],
    '2026-10-06': [
      { kind: 'shop', label: 'pharmacy-1', store: 'MADE UP PHARMACY', account: 'checking', amount: 2_347 },
      { kind: 'shop', label: 'cinema-1', store: 'MADE UP CINEMA', account: 'everyday-card', amount: 1_800, pending: { postsOn: '2026-10-07', postsAt: 2_150 }, sortOn: '2026-10-07' },
    ],
    '2026-10-07': [{ kind: 'shop', label: 'grocer-1', store: 'MADE UP GROCER', account: 'checking', amount: 7_215, pending: { postsOn: '2026-10-08' } }],
    '2026-10-08': [
      { kind: 'refund', of: 'online-1', amount: 3_000 },
      { kind: 'charge-twice', of: 'gas-1', takenBackOn: '2026-10-10' },
    ],
    '2026-10-09': [
      { kind: 'deposit', account: 'checking', amount: 2_500, description: 'ZELLE FROM MADE UP FRIEND', choice: 'wants' },
      { kind: 'card-payment', card: 'old-card', from: 'checking', amount: 15_000, landsOn: '2026-10-12' },
    ],
    '2026-10-10': [{ kind: 'shop', label: 'online-2', store: 'MADE UP ONLINE SHOP', account: 'checking', amount: 6_400 }],
    '2026-10-11': [{ kind: 'shop', label: 'cafe-2', store: 'MADE UP CAFE', account: 'checking', amount: 540 }],
    '2026-10-12': [
      { kind: 'old-card-refund', amount: 1_260 },
      { kind: 'card-payment', card: 'everyday-card', from: 'checking', amount: 35_000, landsOn: '2026-10-14' },
    ],
    '2026-10-13': [{ kind: 'refund', of: 'online-2', amount: 6_400 }],
    '2026-10-14': [{ kind: 'shop', label: 'grocer-2', store: 'MADE UP GROCER', account: 'everyday-card', amount: 9_630 }],
    '2026-10-15': [{ kind: 'shop', label: 'restaurant-2', store: 'MADE UP RESTAURANT', account: 'checking', amount: 3_800, pending: { postsOn: '2026-10-17' } }],
    '2026-10-16': [{ kind: 'paycheck', amount: 320_000 }],
  },
  answers: {
    '2026-10-01': [
      { kind: 'settings', patch: { paycheckRule: { contains: 'ACME PAYROLL' } } },
      { kind: 'settings', patch: { momRule: { contains: 'Made Up Mom' } } },
      { kind: 'add-rule', rule: rule('grocer', 'GROCER', 'needs') },
      { kind: 'add-rule', rule: rule('cafe', 'CAFE', 'wants') },
      { kind: 'add-rule', rule: rule('gas', 'MADE UP GAS', 'needs') },
    ],
    '2026-10-03': [
      { kind: 'leftover', bucket: 'needs', answer: 'roll-over', afterReview: true },
      { kind: 'leftover', bucket: 'wants', answer: 'move-to-savings', afterReview: true },
    ],
    '2026-10-07': [{ kind: 'move', from: 'wants', to: 'needs', amount: 4_000, afterReview: true }],
    '2026-10-09': [{ kind: 'settings', patch: { split: { savings: 45, needs: 35, wants: 20 } }, afterReview: true }],
    '2026-10-10': [
      { kind: 'add-rule', rule: rule('pharmacy', 'PHARMACY', 'needs'), afterReview: true },
      { kind: 'move-rule', id: 'pharmacy', direction: 'up', afterReview: true },
    ],
    '2026-10-11': [{ kind: 'resort', of: 'online-1', afterReview: true }],
    '2026-10-16': [
      { kind: 'leftover', bucket: 'needs', answer: 'move-to-savings', afterReview: true },
      { kind: 'leftover', bucket: 'wants', answer: 'roll-over', afterReview: true },
    ],
  },
};

// The seed for what the simulator still picks at random in it: which bucket
// an online order goes to, the parts of the split, and when the money is
// moved to savings after a paycheck.
export const PAY_PERIOD_SEED = 1;
