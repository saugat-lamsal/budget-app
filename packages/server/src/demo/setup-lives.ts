import { checkBankRules } from '../bank/reading.js';
import type { MadeUpBank } from './made-up-bank.js';

// The made-up banks of the demo's lives that are not set up yet (rulebook
// section 14). Every name, amount, and date is invented. The demo's today is
// Wednesday, Oct 7, 2026.

// How the made-up bank describes his transfers, payments to people, and card
// charges (section 2): in the life "setup-day", bank rules he already has.
// The life "setup-suggest" starts with none, to be suggested from the labels.
const RULES = checkBankRules([
  { id: 'chk-to-sav', account: 'checking', contains: 'transfer to SAV 2222', means: 'transfer', other: 'savings' },
  { id: 'sav-from-chk', account: 'savings', contains: 'transfer from CHK 1111', means: 'transfer', other: 'checking' },
  { id: 'chk-pays-everyday', account: 'checking', contains: 'payment to CRD 3333', means: 'transfer', other: 'everyday-card' },
  { id: 'everyday-paid', account: 'everyday-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
  { id: 'chk-pays-old', account: 'checking', contains: 'payment to CRD 4444', means: 'transfer', other: 'old-card' },
  { id: 'old-paid', account: 'old-card', contains: 'PAYMENT - THANK YOU', means: 'transfer', other: 'checking' },
  { id: 'zelle', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' },
  { id: 'everyday-fee', account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' },
  { id: 'everyday-interest', account: 'everyday-card', contains: 'INTEREST CHARGE', means: 'card-interest' },
]);

// Charges still pending on four accounts, a refund still pending, a card
// payment on its way, money that landed in savings before checking shows it
// leaving, and a payment to the old card on its way (A10, B36, B48).
export const SETUP_PENDING: MadeUpBank = {
  balances: { checking: 321_456, savings: 800_000, 'everyday-card': 61_248, 'old-card': 298_000 },
  rules: RULES,
  items: [
    { id: 'su-pay', account: 'checking', amount: -420_000, date: '2026-10-02', description: 'MADE UP EMPLOYER PAYROLL DIR DEP', label: 'INCOME_SALARY' },
    { id: 'su-grocery', account: 'checking', amount: 6_412, date: '2026-10-03', description: 'GROCERY OUTLET #12', label: 'FOOD_AND_DRINK_GROCERIES' },
    // Both halves of a transfer to savings: not on its way.
    { id: 'su-sav-out', account: 'checking', amount: 50_000, date: '2026-09-28', description: 'Online Banking transfer to SAV 2222', label: 'TRANSFER_OUT_SAVINGS' },
    { id: 'su-sav-in', account: 'savings', amount: -50_000, date: '2026-09-28', description: 'Online Banking transfer from CHK 1111', label: 'TRANSFER_IN_ACCOUNT_TRANSFER' },
    // Still pending.
    { id: 'su-p-grocery', account: 'checking', amount: 8_643, date: '2026-10-06', description: 'GROCERY OUTLET #12', pending: true, label: 'FOOD_AND_DRINK_GROCERIES' },
    { id: 'su-p-gas', account: 'everyday-card', amount: 4_120, date: '2026-10-06', description: 'CORNER GAS STATION', pending: true, label: 'TRANSPORTATION_GAS' },
    { id: 'su-p-coffee', account: 'everyday-card', amount: 625, date: '2026-10-07', description: 'BLUE DOOR COFFEE', pending: true, label: 'FOOD_AND_DRINK_COFFEE' },
    { id: 'su-p-water', account: 'savings', amount: 6_410, date: '2026-10-06', description: 'BILL PAY WATER UTILITY', pending: true, label: 'RENT_AND_UTILITIES_WATER' },
    { id: 'su-p-hardware', account: 'old-card', amount: 1_999, date: '2026-10-05', description: 'MADE UP HARDWARE', pending: true, label: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE' },
    { id: 'su-p-refund', account: 'checking', amount: -2_500, date: '2026-10-06', description: 'MADE UP STORE REFUND', pending: true, label: 'GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE' },
    // One side of a transfer only.
    { id: 'su-card-left', account: 'checking', amount: 30_000, date: '2026-10-06', description: 'Online payment to CRD 3333', label: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' },
    { id: 'su-sav-landed', account: 'savings', amount: -15_000, date: '2026-10-07', description: 'Online Banking transfer from CHK 1111', label: 'TRANSFER_IN_ACCOUNT_TRANSFER' },
    { id: 'su-old-left', account: 'checking', amount: 20_000, date: '2026-10-05', description: 'Online payment to CRD 4444', label: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' },
  ],
};

// The same bank with no bank rules yet: Setup day suggests them from the
// labels (20a). A payment to the everyday card a month ago shows both sides,
// so the one on its way now can be told apart; the one to the old card on
// its way has nothing to tell its card by, so he picks it. Payments to
// people, a late fee, and interest too.
export const SETUP_SUGGEST: MadeUpBank = {
  ...SETUP_PENDING,
  rules: [],
  items: [
    ...SETUP_PENDING.items,
    { id: 'sg-card-paid', account: 'checking', amount: 45_000, date: '2026-09-15', description: 'Online payment to CRD 3333', label: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' },
    { id: 'sg-card-landed', account: 'everyday-card', amount: -45_000, date: '2026-09-16', description: 'PAYMENT - THANK YOU', label: 'TRANSFER_IN_OTHER_TRANSFER_IN' },
    { id: 'sg-friend', account: 'checking', amount: 4_000, date: '2026-09-22', description: 'Zelle payment to MADE UP FRIEND', label: 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS' },
    { id: 'sg-mom', account: 'checking', amount: 25_000, date: '2026-09-30', description: 'Zelle payment to MADE UP MOM', label: 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS' },
    { id: 'sg-late', account: 'everyday-card', amount: 2_900, date: '2026-09-18', description: 'LATE FEE', label: 'BANK_FEES_LATE_FEES' },
    { id: 'sg-interest', account: 'old-card', amount: 4_107, date: '2026-09-25', description: 'INTEREST CHARGE ON PURCHASES', label: 'BANK_FEES_INTEREST_CHARGE' },
  ],
};

// B226: the same, with a payment to the everyday card still pending, worded
// the way the bank words a pending payment ("PAYMENT TO ACCT"), unlike the
// posted ones: no bank rule fits it, so it is read as a purchase, and Setup
// day points it out with a rule for its wording.
export const SETUP_PENDING_PAYMENT: MadeUpBank = {
  ...SETUP_SUGGEST,
  items: [
    ...SETUP_SUGGEST.items,
    { id: 'sp-card-pending', account: 'checking', amount: 6_000, date: '2026-10-08', description: 'PAYMENT TO ACCT #3333 ON 10/08 VIA WEB', pending: true, label: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT' },
  ],
};

// The everyday card owes more than checking and savings hold, so the
// starting money is below zero (B43).
export const SETUP_OWES_MORE: MadeUpBank = {
  balances: { checking: 41_230, savings: 15_000, 'everyday-card': 231_877, 'old-card': 298_000 },
  rules: RULES,
  items: [
    { id: 'so-pay', account: 'checking', amount: -210_000, date: '2026-10-02', description: 'MADE UP EMPLOYER PAYROLL DIR DEP' },
    { id: 'so-rent', account: 'checking', amount: 180_000, date: '2026-10-03', description: 'MADE UP LANDLORD' },
  ],
};
