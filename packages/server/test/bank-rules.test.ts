import type { AccountId, Cents, IsoDate } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { RECENT_DAYS, bankLinesOf, changeBankRules, matchesOf, suggestBankRules, type BankLine, type BankRuleSpec } from '../src/bank-rules.js';
import { checkBankRules, type BankRule } from '../src/bank/reading.js';
import type { StoredAccount } from '../src/bank/stored-account.js';
import type { PlaidAccount, PlaidTransaction } from '../src/plaid/types.js';
import type { StoredItem } from '../src/sync/plan.js';
import { loadRecording } from './replay.js';

// Bank rules (rulebook section 2, 20a, 24c): suggested from the bank's own
// labels, what a rule would match, and changing them. The logic works on the
// bank items handed to it; nothing here reads a database. Every name and
// number is made up, except the saved answers of Plaid's test bank, which
// are made-up data too.

const TODAY: IsoDate = '2026-10-09';
let n = 0;
function line(account: AccountId, amount: Cents, description: string, label: string | null = null, date: IsoDate = '2026-10-01', more: Partial<BankLine> = {}): BankLine {
  n += 1;
  return { id: `l${n}`, account, amount, date, description, pending: false, label: label === null ? null : { primary: label.split('_').slice(0, 2).join('_'), detailed: label }, ...more };
}

// What Plaid's test bank really sent for made-up accounts like his, with its
// labels (live/labels.live.ts, Oct 9), as the bank connection keeps it.
function testBankLines(): BankLine[] {
  const recording = loadRecording('test-bank-labels.json');
  const stage = recording.stages[0];
  if (stage === undefined) throw new Error('no stage');
  const masks: Record<string, AccountId> = { '1111': 'checking', '2222': 'savings', '3333': 'everyday-card', '4444': 'old-card' };
  const accounts: StoredAccount[] = (stage.accounts as { accounts: PlaidAccount[] }).accounts.map((raw) => ({ plaidAccountId: raw.account_id, role: masks[raw.mask ?? ''] ?? null, raw, rawText: JSON.stringify(raw) }));
  const added = (stage.sync['null'] as { added: PlaidTransaction[] }).added;
  const items = new Map<string, StoredItem>(
    added.map((raw) => [
      raw.transaction_id,
      { transactionId: raw.transaction_id, accountId: raw.account_id, raw, pending: raw.pending, amountCents: Math.round(raw.amount * 100), removed: false, status: 'history', kind: null, bookId: null, replacedBy: null, firstSync: 1, lastSync: 1 },
    ]),
  );
  return bankLinesOf({ accounts, items });
}

const spec = (s: BankRuleSpec): BankRuleSpec => s;
const shape = (s: { account: AccountId; contains: string; means: string; other?: AccountId | null; label: string }) => [s.account, s.contains, s.means, s.other ?? null, s.label];

describe('section 2 20a bank rules suggested from the labels the bank sends', () => {
  it('20a from what the test bank really sent: one suggestion for each kind of label it gives transfers, card payments, payments to people, card fees and interest', () => {
    const suggestions = suggestBankRules(testBankLines(), []);
    expect(suggestions.map(shape)).toEqual([
      ['checking', 'Online Banking transfer from SAV 2222', 'transfer', 'savings', 'TRANSFER_IN_ACCOUNT_TRANSFER'],
      ['checking', 'Online Banking transfer to SAV 2222', 'transfer', 'savings', 'TRANSFER_OUT_SAVINGS'],
      ['checking', 'Online payment to CRD 3333', 'transfer', 'everyday-card', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'],
      ['checking', 'Online payment to CRD 4444', 'transfer', 'old-card', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT'],
      ['checking', 'Venmo payment to PAL MADEUP', 'payment-to-person', null, 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS'],
      ['checking', 'Zelle payment to FRIEND MADEUP', 'payment-to-person', null, 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS'],
      ['savings', 'Online Banking transfer from CHK 1111', 'transfer', 'checking', 'TRANSFER_IN_ACCOUNT_TRANSFER'],
      ['savings', 'Online Banking transfer to CHK 1111', 'transfer', 'checking', 'TRANSFER_OUT_ACCOUNT_TRANSFER'],
      ['savings', 'Zelle payment to MOM MADEUP', 'payment-to-person', null, 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS'],
      ['everyday-card', 'PAYMENT - THANK YOU', 'transfer', 'checking', 'TRANSFER_IN_OTHER_TRANSFER_IN'],
      ['everyday-card', 'FOREIGN TRANSACTION FEE', 'card-fee', null, 'BANK_FEES_FOREIGN_TRANSACTION_FEES'],
      ['everyday-card', 'LATE FEE', 'card-fee', null, 'BANK_FEES_LATE_FEES'],
      ['everyday-card', 'INTEREST CHARGE ON PURCHASES', 'card-interest', null, 'BANK_FEES_INTEREST_CHARGE'],
      ['old-card', 'PAYMENT - THANK YOU', 'transfer', 'checking', 'TRANSFER_IN_OTHER_TRANSFER_IN'],
      ['old-card', 'LATE FEE', 'card-fee', null, 'BANK_FEES_LATE_FEES'],
      ['old-card', 'INTEREST CHARGE ON PURCHASES', 'card-interest', null, 'BANK_FEES_INTEREST_CHARGE'],
    ]);
  });

  it('20a a fee on checking, money in from a payment app, paychecks, purchases, and interest earned suggest nothing', () => {
    const suggestions = suggestBankRules(testBankLines(), []);
    for (const text of ['MONTHLY MAINTENANCE FEE', 'Zelle payment from', 'PAYROLL', 'GROCERY', 'INTEREST EARNED', 'BILL PAY WATER', 'COFFEE', 'STORE RETURN']) {
      expect(suggestions.filter((s) => s.contains.includes(text)), text).toEqual([]);
    }
  });

  it('20a each suggestion says how many items in the history it matches, with up to three of them, newest first', () => {
    const lines = [
      line('checking', 4_000, 'Zelle payment to ANNA', 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS', '2026-09-01'),
      line('checking', 5_000, 'Zelle payment to BEN', 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS', '2026-09-20'),
      line('checking', 6_000, 'ZELLE PAYMENT TO CARA', 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS', '2026-09-10'),
      // No label, but the text matches: it is counted too.
      line('checking', 7_000, 'Zelle payment to DAN', null, '2026-10-02'),
      // Money in does not fit a payment to a person.
      line('checking', -1_000, 'Zelle payment to you from EVE', null, '2026-10-03'),
      // Another account.
      line('savings', 2_000, 'Zelle payment to FAY', null, '2026-10-04'),
    ];
    const [zelle] = suggestBankRules(lines, []);
    expect(zelle).toMatchObject({ account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' });
    expect(zelle?.matches.count).toBe(4);
    expect(zelle?.matches.examples.map((e) => e.description)).toEqual(['Zelle payment to DAN', 'Zelle payment to BEN', 'ZELLE PAYMENT TO CARA']);
    expect(zelle?.matches.examples[0]).toMatchObject({ date: '2026-10-02', amount: 7_000, direction: 'out', account: 'checking' });
  });

  it('20a the text is what every description shares, ending at a whole word, ignoring case', () => {
    const fee = 'BANK_FEES_LATE_FEES';
    const [a] = suggestBankRules([line('everyday-card', 100, 'ABC PAYMENT 12', fee), line('everyday-card', 100, 'abc payments 3', fee)], []);
    expect(a?.contains).toBe('ABC');
    const [b] = suggestBankRules([line('everyday-card', 100, 'LATE FEE 0921', fee), line('everyday-card', 100, 'LATE FEE 1021', fee)], []);
    expect(b?.contains).toBe('LATE FEE');
    // Nothing shared: one suggestion for each first word, each with its own shared text.
    const c = suggestBankRules([line('everyday-card', 100, 'LATE FEE', fee), line('everyday-card', 100, 'RETURNED PAYMENT FEE', fee)], []);
    expect(c.map((s) => s.contains)).toEqual(['LATE FEE', 'RETURNED PAYMENT FEE']);
  });

  it('20a nothing is assumed: a transfer whose other side is not in the history leaves the other account for you to pick', () => {
    const [s] = suggestBankRules([line('checking', 30_000, 'Online payment to CRD 3333', 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')], []);
    expect(s).toMatchObject({ means: 'transfer', other: null });
  });

  it('20a one still on its way (no other side yet) takes the other account of one with the same description whose other side shows', () => {
    const into = 'TRANSFER_IN_ACCOUNT_TRANSFER';
    const lines = [
      line('checking', 50_000, 'Online Banking transfer to SAV 2222', null, '2026-09-28'),
      line('savings', -50_000, 'Online Banking transfer from CHK 1111', into, '2026-09-28'),
      line('savings', -15_000, 'ONLINE BANKING TRANSFER FROM CHK 1111', into, '2026-10-07'),
    ];
    expect(suggestBankRules(lines, []).map((s) => [s.account, s.contains, s.other, s.matches.count])).toEqual([['savings', 'Online Banking transfer from CHK 1111', 'checking', 2]]);
  });

  it('20a ones with no other side and different descriptions are a suggestion each, each to pick, never one wider text', () => {
    const pay = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';
    const lines = [line('checking', 30_000, 'Online payment to CRD 3333', pay, '2026-10-06'), line('checking', 20_000, 'Online payment to CRD 4444', pay, '2026-10-05')];
    expect(suggestBankRules(lines, []).map((s) => [s.contains, s.other])).toEqual([
      ['Online payment to CRD 3333', null],
      ['Online payment to CRD 4444', null],
    ]);
  });

  it('20a a card payment pairs with the card that shows it arriving, the nearest day; one to each card gives one suggestion for each', () => {
    const pay = 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT';
    const lines = [
      line('checking', 15_000, 'Online payment to CRD', pay, '2026-09-01'),
      line('checking', 15_000, 'Online payment to CRD', pay, '2026-09-20'),
      line('old-card', -15_000, 'PAYMENT - THANK YOU', null, '2026-09-02'),
      line('everyday-card', -15_000, 'PAYMENT - THANK YOU', null, '2026-09-21'),
    ];
    expect(suggestBankRules(lines, []).filter((s) => s.account === 'checking').map((s) => [s.contains, s.other, s.matches.count])).toEqual([
      ['Online payment to CRD', 'everyday-card', 2],
      ['Online payment to CRD', 'old-card', 2],
    ]);
  });

  it('20a a suggestion your bank rules already read the same way is marked covered; one they read otherwise is not', () => {
    const lines = [line('checking', 4_000, 'Zelle payment to ANNA', 'TRANSFER_OUT_TRANSFER_OUT_FROM_APPS')];
    expect(suggestBankRules(lines, [])[0]?.covered).toBe(false);
    const same = checkBankRules([{ id: 'z', account: 'checking', contains: 'zelle', means: 'payment-to-person' }]);
    expect(suggestBankRules(lines, same)[0]?.covered).toBe(true);
    const otherwise = checkBankRules([{ id: 'z', account: 'checking', contains: 'zelle', means: 'transfer', other: 'savings' }]);
    expect(suggestBankRules(lines, otherwise)[0]?.covered).toBe(false);
  });

  it('20a each suggestion has its own id, the same every time for the same history', () => {
    const first = suggestBankRules(testBankLines(), []).map((s) => s.id);
    expect(new Set(first).size).toBe(first.length);
    expect(suggestBankRules(testBankLines(), []).map((s) => s.id)).toEqual(first);
  });

  it('20a removed items, and accounts that are not one of your four, are not read', () => {
    const lines = testBankLines();
    expect(lines.every((l) => ['checking', 'savings', 'everyday-card', 'old-card'].includes(l.account))).toBe(true);
    expect(lines).toHaveLength(24);
  });
});

describe('section 2 24c what a bank rule would match', () => {
  const lines = [
    line('checking', 10_000, 'Online Banking transfer to SAV', null, '2026-10-01'),
    line('checking', -5_000, 'Online Banking transfer from SAV', null, '2026-10-02'),
    line('savings', -10_000, 'Online Banking transfer from CHK', null, '2026-10-01'),
    line('everyday-card', 2_900, 'LATE FEE', null, '2026-10-03'),
    line('everyday-card', -2_900, 'LATE FEE REVERSED', null, '2026-10-04'),
  ];

  it('section 2 the bank description contains the text, ignoring case, on that account, the way the money went', () => {
    expect(matchesOf(spec({ account: 'checking', contains: 'online banking transfer', means: 'transfer', other: 'savings' }), [], lines, { today: TODAY }).count).toBe(2);
    // A payment to a person is money out only.
    expect(matchesOf(spec({ account: 'checking', contains: 'online banking transfer', means: 'payment-to-person' }), [], lines, { today: TODAY }).count).toBe(1);
    // A fee is money out: the reversal does not fit.
    expect(matchesOf(spec({ account: 'everyday-card', contains: 'late fee', means: 'card-fee' }), [], lines, { today: TODAY }).count).toBe(1);
    expect(matchesOf(spec({ account: 'savings', contains: 'late fee', means: 'payment-to-person' }), [], lines, { today: TODAY }).count).toBe(0);
  });

  it(`24c only recent items: the last ${RECENT_DAYS} days, the day exactly that far back included, the day before it not`, () => {
    const edge = [
      line('checking', 100, 'MADE UP ZELLE TO', null, '2026-07-11'),
      line('checking', 100, 'MADE UP ZELLE TO', null, '2026-07-10'),
    ];
    // Oct 9 less 90 days is Jul 11.
    expect(RECENT_DAYS).toBe(90);
    const m = matchesOf(spec({ account: 'checking', contains: 'ZELLE', means: 'payment-to-person' }), [], edge, { today: TODAY, recentOnly: true });
    expect(m.count).toBe(1);
    expect(m.examples.map((e) => e.date)).toEqual(['2026-07-11']);
  });

  it('A27 the first rule that matches wins: items an earlier rule reads first are counted apart, with that rule', () => {
    const rules = checkBankRules([{ id: 'wide', account: 'checking', contains: 'transfer', means: 'transfer', other: 'savings' }]);
    const m = matchesOf(spec({ account: 'checking', contains: 'transfer to SAV', means: 'payment-to-person' }), rules, lines, { today: TODAY });
    expect(m).toMatchObject({ count: 1, readFirstByEarlier: 1, takenFromLater: 0 });
    expect(m.examples[0]?.readFirstBy).toBe('wide');
  });

  it('A27 a changed rule keeps its place: it takes items from a rule after it, and leaves to a rule before it what that one reads first', () => {
    const own = [
      line('checking', 10_000, 'Online Banking transfer to SAV', null, '2026-10-01'),
      line('checking', 2_500, 'Online bill pay MADE UP WATER', null, '2026-10-02'),
      line('checking', 900, 'Online FEE', null, '2026-10-03'),
    ];
    const rules = checkBankRules([
      { id: 'one', account: 'checking', contains: 'FEE', means: 'payment-to-person' },
      { id: 'two', account: 'checking', contains: 'to SAV', means: 'transfer', other: 'savings' },
      { id: 'three', account: 'checking', contains: 'bill pay', means: 'payment-to-person' },
    ]);
    // "two" changed to every "Online" item: the one "three" read is now its; the fee stays with "one", which comes first.
    const wider = matchesOf(spec({ account: 'checking', contains: 'Online', means: 'transfer', other: 'savings' }), rules, own, { today: TODAY, replacing: 'two' });
    expect(wider).toMatchObject({ count: 3, readFirstByEarlier: 1, takenFromLater: 1 });
    expect(wider.examples.map((e) => [e.description, e.readFirstBy])).toEqual([
      ['Online FEE', 'one'],
      ['Online bill pay MADE UP WATER', null],
      ['Online Banking transfer to SAV', null],
    ]);
    // What it read before and still reads is not "taken".
    expect(matchesOf(spec({ account: 'checking', contains: 'transfer to SAV', means: 'transfer', other: 'savings' }), rules, own, { today: TODAY, replacing: 'two' })).toMatchObject({ count: 1, takenFromLater: 0 });
    // Added at the end instead, it takes nothing: every rule before it reads first.
    expect(matchesOf(spec({ account: 'checking', contains: 'Online', means: 'transfer', other: 'savings' }), rules, own, { today: TODAY })).toMatchObject({ count: 3, readFirstByEarlier: 3, takenFromLater: 0 });
  });

  it('section 2 at most three examples, newest first, each with its day, account, amount, and the way the money went', () => {
    const many = [1, 2, 3, 4, 5].map((d) => line('checking', d * 100, 'MADE UP ZELLE TO X', null, `2026-10-0${d}`));
    const m = matchesOf(spec({ account: 'checking', contains: 'zelle', means: 'payment-to-person' }), [], many, { today: TODAY });
    expect(m.count).toBe(5);
    expect(m.examples.map((e) => [e.date, e.amount, e.direction])).toEqual([
      ['2026-10-05', 500, 'out'],
      ['2026-10-04', 400, 'out'],
      ['2026-10-03', 300, 'out'],
    ]);
  });

  it('section 2 nothing it would match says so with a count of zero and no examples', () => {
    expect(matchesOf(spec({ account: 'old-card', contains: 'nothing like this', means: 'card-fee' }), [], lines, { today: TODAY })).toEqual({ count: 0, examples: [], readFirstByEarlier: 0, takenFromLater: 0 });
  });
});

describe('section 2 24c changing the bank rules', () => {
  const rules: readonly BankRule[] = checkBankRules([
    { id: 'zelle', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' },
    { id: 'fee', account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' },
  ]);

  it('24c a new rule goes to the end, with an id of its own, its text trimmed', () => {
    const done = changeBankRules(rules, { add: { account: 'checking', contains: '  transfer to SAV  ', means: 'transfer', other: 'savings' } });
    expect(done).toMatchObject({ ok: true });
    if (!done.ok) return;
    expect(done.rules.map((r) => r.id)).toEqual(['zelle', 'fee', 'bank-rule-1']);
    expect(done.rule).toEqual({ id: 'bank-rule-1', account: 'checking', contains: 'transfer to SAV', means: 'transfer', other: 'savings' });
    expect(done.action).toBe('added');
    const again = changeBankRules(done.rules, { add: { account: 'savings', contains: 'from CHK', means: 'transfer', other: 'checking' } });
    expect(again.ok && again.rule.id).toBe('bank-rule-2');
  });

  it('24c a changed rule keeps its place; changing it to what it already says is refused', () => {
    const done = changeBankRules(rules, { change: { id: 'zelle', account: 'savings', contains: 'Zelle payment to', means: 'payment-to-person' } });
    expect(done.ok && done.rules.map((r) => [r.id, r.account])).toEqual([
      ['zelle', 'savings'],
      ['fee', 'everyday-card'],
    ]);
    expect(done.ok && done.before).toEqual(rules[0]);
    expect(changeBankRules(rules, { change: { id: 'zelle', account: 'checking', contains: ' Zelle payment to ', means: 'payment-to-person' } })).toEqual({ ok: false, why: 'That is already the rule' });
  });

  it('24c a rule removed is gone; one that is not there is refused', () => {
    const done = changeBankRules(rules, { remove: 'fee' });
    expect(done.ok && done.rules.map((r) => r.id)).toEqual(['zelle']);
    expect(done.ok && done.rule).toEqual(rules[1]);
    expect(changeBankRules(rules, { remove: 'nope' })).toEqual({ ok: false, why: 'That rule is not there any more' });
    expect(changeBankRules(rules, { change: { id: 'nope', account: 'checking', contains: 'x', means: 'payment-to-person' } })).toEqual({ ok: false, why: 'That rule is not there any more' });
  });

  it('24c the same rule twice is refused, ignoring case', () => {
    expect(changeBankRules(rules, { add: { account: 'checking', contains: 'zelle PAYMENT to', means: 'payment-to-person' } })).toEqual({ ok: false, why: 'You already have that rule' });
    expect(changeBankRules(rules, { change: { id: 'fee', account: 'checking', contains: 'zelle payment to', means: 'payment-to-person' } })).toEqual({ ok: false, why: 'You already have that rule' });
  });

  it.each([
    [{ account: 'checking', contains: '   ', means: 'payment-to-person' }, 'Enter the text the bank’s description contains'],
    [{ account: 'checking', contains: 'x'.repeat(201), means: 'payment-to-person' }, 'That text is too long: 200 characters at most'],
    [{ account: 'checking', contains: 'to SAV', means: 'transfer', other: 'checking' }, 'A transfer is between two different accounts'],
    [{ account: 'everyday-card', contains: 'PAYMENT', means: 'transfer', other: 'old-card' }, 'Money reaches a card from checking or savings'],
    [{ account: 'everyday-card', contains: 'ZELLE', means: 'payment-to-person' }, 'Payments to people come out of checking or savings'],
    [{ account: 'savings', contains: 'FEE', means: 'card-fee' }, 'Fees and interest are on a card'],
    [{ account: 'checking', contains: 'INTEREST', means: 'card-interest' }, 'Fees and interest are on a card'],
  ] as const)('section 2 a rule that cannot be: %j is refused in words', (bad, why) => {
    expect(changeBankRules(rules, { add: bad as BankRuleSpec })).toEqual({ ok: false, why });
  });

  it('section 2 exactly 200 characters is allowed', () => {
    expect(changeBankRules(rules, { add: { account: 'checking', contains: 'x'.repeat(200), means: 'payment-to-person' } }).ok).toBe(true);
  });
});
