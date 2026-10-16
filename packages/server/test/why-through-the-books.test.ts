import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { BankAtRead } from '../src/bank/why.js';
import type { WhyLine } from '../src/views/home.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { lifeInAFile, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// Rule 12.6 (QUESTIONS.md A57) through the real books and the made-up bank:
// each read keeps the bank as it was and whether the check matched, and when
// the totals do not match, Home's check sheet and Buckets say why, in lines
// that add up to the difference. Every name and number is made up.

const C = ACCOUNT_IDS.checking;
const S = ACCOUNT_IDS.savings;
const E = ACCOUNT_IDS.everyday;

function homeWhy(life: Life): { readonly difference: number; readonly why: readonly WhyLine[] } | null {
  const home = life.keeper.home();
  if (home.state !== 'tracking') throw new Error('not tracking');
  const s = home.safeToSpend;
  if (s.shown || s.why !== 'totals-do-not-match') return null;
  return { difference: s.check.difference, why: s.detail?.why ?? [] };
}

function bucketsWhy(life: Life): readonly WhyLine[] | null {
  const view = life.keeper.buckets();
  if (view.state !== 'tracking') throw new Error('not tracking');
  return view.check.state === 'does-not-match' ? view.check.why : null;
}

const sum = (lines: readonly WhyLine[]): number => lines.reduce((total, line) => total + line.amount, 0);

interface ReadRow {
  readonly sync: number | null;
  readonly bank: BankAtRead | null;
  readonly difference: number | null;
}

function reads(life: Life): ReadRow[] {
  return (life.h.db.prepare('SELECT sync, bank, difference FROM bank_reads ORDER BY id').all() as { sync: number | null; bank: string | null; difference: number | null }[]).map((r) => ({
    sync: r.sync,
    bank: r.bank === null ? null : (JSON.parse(r.bank) as BankAtRead),
    difference: r.difference,
  }));
}

// The made-up bank read once before setup day (so a read is kept, as on the
// real server), then setup day.
async function setUp(): Promise<Life> {
  const life = await lifeInAFile();
  await life.sync();
  setUpThroughTheDesk(life);
  return life;
}

describe('12.6 why it does not match, through the books', () => {
  it('12.6 the case that prompted it: the card posted a charge Plaid still lists as pending, and checking went up with no transaction', async () => {
    const life = await setUp();
    try {
      life.now = new Date('2026-10-02T13:00:00Z');
      life.h.fake.addPending({ id: 'p-coffee', account: E, amount: 2_500, date: '2026-10-02', description: 'COFFEE CART MADE UP' });
      await life.sync();
      expect(homeWhy(life)).toBeNull();
      // The bank posts it, and Plaid still lists it as pending; checking's
      // balance goes up $27.50 with nothing from Plaid yet.
      life.now = new Date('2026-10-02T14:00:00Z');
      life.h.fake.drift(E, 2_500);
      life.h.fake.drift(C, 2_750);
      await life.sync();
      const home = homeWhy(life);
      expect(home).toEqual({
        difference: 250,
        why: [
          { kind: 'balance-moved', account: 'checking', balance: 'available', went: 'up', by: 2_750, amount: 2_750 },
          { kind: 'posted-still-pending', account: 'everyday-card', description: 'COFFEE CART MADE UP', charge: true, amount: -2_500 },
        ],
      });
      expect(bucketsWhy(life)).toEqual(home?.why);
      // Plaid catches up: the posted charge replaces the pending one, and the bank sends the deposit.
      life.now = new Date('2026-10-02T18:00:00Z');
      life.h.fake.drift(E, -2_500);
      life.h.fake.postPending('p-coffee', { id: 'coffee', date: '2026-10-02' });
      life.h.fake.drift(C, -2_750);
      life.h.fake.addPosted({ id: 'refund', account: C, amount: -2_750, date: '2026-10-02', description: 'MADE UP REFUND' });
      await life.sync();
      // The deposit waits in review, counted as unsorted money in: they match.
      expect(homeWhy(life)).toBeNull();
    } finally {
      life.done();
    }
  });

  it('12.6 each read keeps the bank as it was, the sync it saved, and the check after it', async () => {
    const life = await setUp();
    try {
      life.now = new Date('2026-10-02T13:00:00Z');
      await life.sync();
      life.now = new Date('2026-10-02T14:00:00Z');
      life.h.fake.drift(S, -1_000);
      await life.sync();
      const all = reads(life);
      // Before setup day: no check; setup day marks that read as matched (14.3).
      expect(all.map((r) => r.difference)).toEqual([0, 0, -1_000]);
      // The first read after setup day brought nothing new: no sync of its own.
      expect(all[1]?.sync).toBeNull();
      expect(all[2]?.sync).toEqual(expect.any(Number));
      expect(all[2]?.bank?.accounts.savings).toEqual({ posted: 499_000, available: 499_000, counted: 499_000, items: 0 });
      expect(all[2]?.bank?.accounts['everyday-card'].available).toBeNull();
      // What the read kept agrees with what Home says.
      expect(homeWhy(life)?.difference).toBe(-1_000);
    } finally {
      life.done();
    }
  });

  it('12.6 setup day counts as a read that matched: a difference at the first read after it is explained from there', async () => {
    const life = await setUp();
    try {
      life.now = new Date('2026-10-02T13:00:00Z');
      life.h.fake.drift(C, -4_210);
      await life.sync();
      expect(homeWhy(life)).toEqual({ difference: -4_210, why: [{ kind: 'balance-moved', account: 'checking', balance: 'available', went: 'down', by: 4_210, amount: -4_210 }] });
    } finally {
      life.done();
    }
  });

  it('12.6 with no earlier read that matched kept, one line says so, with the whole difference', async () => {
    // Setup day with no read kept before it (the harness's first sync keeps none).
    const life = await lifeInAFile();
    try {
      setUpThroughTheDesk(life);
      life.now = new Date('2026-10-02T13:00:00Z');
      life.h.fake.drift(C, -4_210);
      await life.sync();
      expect(homeWhy(life)).toEqual({ difference: -4_210, why: [{ kind: 'no-match-kept', amount: -4_210 }] });
    } finally {
      life.done();
    }
  });

  it('12.6 a pending charge whose amount Plaid changed while the bank has the old one', async () => {
    const life = await setUp();
    try {
      life.h.fake.addPending({ id: 'p-dinner', account: C, amount: 4_000, date: '2026-10-02', description: 'MADE UP BISTRO' });
      await life.sync();
      expect(homeWhy(life)).toBeNull();
      // Plaid has the tip; the bank's available balance still holds $40.00 (made up: put back by hand).
      life.h.fake.modify('p-dinner', { amount: 4_800 });
      life.h.fake.holdAvailable(C, -800);
      await life.sync();
      expect(homeWhy(life)).toEqual({ difference: 800, why: [{ kind: 'amount-changed', account: 'checking', description: 'MADE UP BISTRO', was: 4_000, now: 4_800, amount: 800 }] });
    } finally {
      life.done();
    }
  });

  it('12.6 a posted item already counted at the read that matched is not taken for one that came since', async () => {
    const life = await setUp();
    try {
      // One read brings a $50.00 deposit, posted, and another $50.00 still pending: they match.
      life.h.fake.addPosted({ id: 'gift', account: C, amount: -5_000, date: '2026-10-02', description: 'MADE UP GIFT' });
      life.h.fake.addPending({ id: 'p-other', account: C, amount: -5_000, date: '2026-10-02', description: 'MADE UP OTHER' });
      await life.sync();
      expect(homeWhy(life)).toBeNull();
      // Then checking's available balance goes down $50.00 with nothing from Plaid: not "posted, and Plaid still lists the pending one too".
      life.h.fake.drift(C, -5_000);
      await life.sync();
      expect(homeWhy(life)).toEqual({ difference: -5_000, why: [{ kind: 'balance-moved', account: 'checking', balance: 'available', went: 'down', by: 5_000, amount: -5_000 }] });
    } finally {
      life.done();
    }
  });

  it('12.6 a deposit that posted while Plaid still lists the pending one too, through the books', async () => {
    const life = await setUp();
    try {
      life.h.fake.addPending({ id: 'p-pay', account: C, amount: -90_000, date: '2026-10-02', description: 'MADE UP PAYROLL' });
      await life.sync();
      expect(homeWhy(life)).toBeNull();
      // It posts, and Plaid keeps the pending one too; the bank's available balance has it once.
      life.h.fake.addPosted({ id: 'pay', account: C, amount: -90_000, date: '2026-10-02', description: 'MADE UP PAYROLL' });
      life.h.fake.holdAvailable(C, 90_000);
      await life.sync();
      expect(homeWhy(life)).toEqual({ difference: -90_000, why: [{ kind: 'posted-and-pending', account: 'checking', description: 'MADE UP PAYROLL', amount: -90_000 }] });
    } finally {
      life.done();
    }
  });

  it('12.6 the bank cannot be read: no lines, since there is no difference to explain', async () => {
    const life = await setUp();
    try {
      life.h.fake.needsLogin = true;
      life.h.fake.drift(C, -100);
      await life.sync();
      const home = life.keeper.home();
      if (home.state !== 'tracking') throw new Error('not tracking');
      expect(home.safeToSpend).toMatchObject({ shown: false, why: 'bank-not-read' });
      const buckets = life.keeper.buckets();
      expect(buckets.state === 'tracking' && buckets.check.state).toBe('bank-not-read');
    } finally {
      life.done();
    }
  });

  it('12.6 for random activity, the bank running ahead of Plaid and Plaid ahead of the bank, every difference is explained by lines that add up to it, with nothing left over that the bank does not account for', async () => {
    type Step =
      | { readonly kind: 'pending-charge'; readonly account: 'c' | 'e'; readonly cents: number }
      | { readonly kind: 'post-oldest'; readonly tip: number }
      | { readonly kind: 'bank-posts-oldest-card-pending' }
      | { readonly kind: 'drift'; readonly account: 'c' | 's' | 'e'; readonly cents: number }
      | { readonly kind: 'deposit'; readonly account: 'c' | 's'; readonly cents: number; readonly heldBack: boolean }
      | { readonly kind: 'send-held-back' }
      | { readonly kind: 'drop-oldest' };
    const step: fc.Arbitrary<Step> = fc.oneof(
      fc.record({ kind: fc.constant('pending-charge' as const), account: fc.constantFrom('c' as const, 'e' as const), cents: fc.integer({ min: 1, max: 50_000 }) }),
      fc.record({ kind: fc.constant('post-oldest' as const), tip: fc.integer({ min: 0, max: 900 }) }),
      fc.record({ kind: fc.constant('bank-posts-oldest-card-pending' as const) }),
      fc.record({ kind: fc.constant('drift' as const), account: fc.constantFrom('c' as const, 's' as const, 'e' as const), cents: fc.integer({ min: -20_000, max: 20_000 }) }),
      fc.record({ kind: fc.constant('deposit' as const), account: fc.constantFrom('c' as const, 's' as const), cents: fc.integer({ min: 1, max: 200_000 }), heldBack: fc.boolean() }),
      fc.record({ kind: fc.constant('send-held-back' as const) }),
      fc.record({ kind: fc.constant('drop-oldest' as const) }),
    );
    const ids = { c: C, s: S, e: E } as const;
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 12 }), async (steps) => {
        const life = await setUp();
        try {
          const pending: { id: string; account: string; cents: number; postedAtBank: boolean }[] = [];
          let n = 0;
          let minutes = 0;
          for (const s of steps) {
            n += 1;
            const id = `x${n}`;
            if (s.kind === 'pending-charge') {
              life.h.fake.addPending({ id, account: ids[s.account], amount: s.cents, date: '2026-10-02', description: `MADE UP SHOP ${n}` });
              pending.push({ id, account: ids[s.account], cents: s.cents, postedAtBank: false });
            } else if (s.kind === 'post-oldest') {
              const p = pending.shift();
              if (p !== undefined) {
                if (p.postedAtBank) life.h.fake.drift(p.account, -p.cents);
                life.h.fake.postPending(p.id, { id: `${p.id}-posted`, date: '2026-10-02', amount: p.cents + s.tip });
              }
            } else if (s.kind === 'bank-posts-oldest-card-pending') {
              const p = pending.find((x) => x.account === E && !x.postedAtBank);
              if (p !== undefined) {
                life.h.fake.drift(E, p.cents);
                p.postedAtBank = true;
              }
            } else if (s.kind === 'drift') life.h.fake.drift(ids[s.account], s.cents);
            else if (s.kind === 'deposit') life.h.fake.addPosted({ id, account: ids[s.account], amount: -s.cents, date: '2026-10-02', description: `MADE UP DEPOSIT ${n}` }, { heldBack: s.heldBack });
            else if (s.kind === 'send-held-back') life.h.fake.sendHeldBack();
            else {
              const p = pending.shift();
              if (p !== undefined) {
                if (p.postedAtBank) life.h.fake.drift(p.account, -p.cents);
                life.h.fake.dropPending(p.id);
              }
            }
            minutes += 30;
            life.now = new Date(Date.parse('2026-10-02T13:00:00Z') + minutes * 60_000);
            await life.sync();
            const home = homeWhy(life);
            if (home === null) continue;
            expect(sum(home.why)).toBe(home.difference);
            expect(home.why.map((l) => l.kind)).not.toContain('rest');
            expect(home.why.map((l) => l.kind)).not.toContain('no-match-kept');
            for (const line of home.why) expect(line.amount).not.toBe(0);
            expect(bucketsWhy(life)).toEqual(home.why);
          }
        } finally {
          life.done();
        }
      }),
      { numRuns: Number(process.env['WHY_SCENARIOS'] ?? 40), ...(process.env['SEED'] === undefined ? {} : { seed: Number(process.env['SEED']) }) },
    );
  }, 120_000);
});
