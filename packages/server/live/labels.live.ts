import { addDays, type AccountId, type IsoDate } from '@budget-app/money';
import { beforeAll, describe, expect, it } from 'vitest';
import { readAccounts, readItems } from '../src/db/store.js';
import type { PlaidTransaction } from '../src/plaid/types.js';
import { connectLive, fact, saveRecording, syncUntilHistory, todayUtc, type LiveBank } from './test-bank.js';

// What the test bank labels each kind of bank item with (Plaid's
// personal_finance_category), before Setup day relies on any label to
// suggest bank rules (rulebook section 2, 20a). Made-up accounts shaped like
// his, with transfers both ways, card payments, payments to people, card
// fees and interest, and a bank fee on checking. Every name and number is
// made up. LIVE_RECORD=<path> saves what it answered.
const today = todayUtc();
const MASKS: Record<string, AccountId> = { '1111': 'checking', '2222': 'savings', '3333': 'everyday-card', '4444': 'old-card' };

function labelUser(on: IsoDate): string {
  const d = (days: number): IsoDate => addDays(on, days);
  const tx = (days: number, amount: number, description: string): Record<string, unknown> => ({ date_transacted: d(days), date_posted: d(days), amount, description, currency: 'USD' });
  const account = (type: string, subtype: string, mask: string, name: string, transactions: Record<string, unknown>[]): Record<string, unknown> => ({
    type,
    subtype,
    starting_balance: 1000,
    meta: { name, mask },
    transactions,
  });
  return JSON.stringify({
    override_accounts: [
      account('depository', 'checking', '1111', 'Made-up Checking', [
        tx(-20, -2500, 'MADEUP CORP PAYROLL'),
        tx(-19, 100, 'Online Banking transfer to SAV 2222'),
        tx(-18, -50, 'Online Banking transfer from SAV 2222'),
        tx(-17, 150, 'Online payment to CRD 3333'),
        tx(-16, 75, 'Online payment to CRD 4444'),
        tx(-15, 40, 'Zelle payment to FRIEND MADEUP'),
        tx(-14, -25, 'Zelle payment from FRIEND MADEUP'),
        tx(-13, 12, 'MONTHLY MAINTENANCE FEE'),
        tx(-12, 30, 'Venmo payment to PAL MADEUP'),
        tx(-11, 45.67, 'GROCERY OUTLET 12'),
      ]),
      account('depository', 'savings', '2222', 'Made-up Savings', [
        tx(-19, -100, 'Online Banking transfer from CHK 1111'),
        tx(-18, 50, 'Online Banking transfer to CHK 1111'),
        tx(-10, 200, 'Zelle payment to MOM MADEUP'),
        tx(-9, -1.23, 'INTEREST EARNED'),
        tx(-8, 64.1, 'BILL PAY WATER UTILITY'),
      ]),
      account('credit', 'credit card', '3333', 'Made-up Everyday Card', [
        tx(-16, -150, 'PAYMENT - THANK YOU'),
        tx(-7, 29, 'LATE FEE'),
        tx(-6, 18.42, 'INTEREST CHARGE ON PURCHASES'),
        tx(-5, 3.1, 'FOREIGN TRANSACTION FEE'),
        tx(-4, 12.34, 'COFFEE SHOP 5'),
        tx(-3, -9.99, 'STORE RETURN'),
      ]),
      account('credit', 'credit card', '4444', 'Made-up Old Card', [
        tx(-15, -75, 'PAYMENT - THANK YOU'),
        tx(-6, 41.07, 'INTEREST CHARGE ON PURCHASES'),
        tx(-5, 39, 'LATE FEE'),
      ]),
    ],
  });
}

let bank: LiveBank;

describe('what the test bank labels each kind of item with', () => {
  beforeAll(async () => {
    bank = await connectLive({ username: 'user_custom', password: labelUser(today), today });
    await syncUntilHistory(bank, today);
  });

  it('every item carries a personal_finance_category with a primary and a detailed label', () => {
    const roles = new Map(readAccounts(bank.db).map((a) => [a.plaidAccountId, MASKS[a.raw.mask ?? ''] ?? '?']));
    const items = [...readItems(bank.db).values()].map((i) => i.raw as PlaidTransaction & Record<string, unknown>);
    for (const t of items) {
      const pfc = t.personal_finance_category as Record<string, unknown> | null | undefined;
      fact(
        `${String(roles.get(t.account_id)).padEnd(13)} ${String(t.amount).padStart(8)} ${(t.original_description ?? t.name).padEnd(40)} ${String(pfc?.['primary'])} / ${String(pfc?.['detailed'])} (${String(pfc?.['confidence_level'])}); category ${JSON.stringify(t['category'])}; channel ${String(t['payment_channel'])}; counterparties ${JSON.stringify(t['counterparties'])}`,
      );
    }
    saveRecording('labels', bank.recorded);
    expect(items.length).toBe(24);
    for (const t of items) {
      expect(typeof t.personal_finance_category?.primary).toBe('string');
      expect(typeof t.personal_finance_category?.detailed).toBe('string');
    }
  });
});
