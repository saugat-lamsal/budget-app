// Second opinion, rulebook section 13 (changing things on the fly).
// Starting pots: savings 5,000.00, needs 1,000.00, wants 500.00, reserve 0.

import { describe, expect, it } from 'vitest';
import { type SortingRule } from '../src/index.js';
import { Life } from './helpers.js';

describe('13.1 a change to the split or the reserve applies from the next paycheck', () => {
  it('13.1 split changed mid-period: nothing moves now; next paycheck uses it', () => {
    const life = new Life();
    life.book.changeSettings({ split: { savings: 60, needs: 25, wants: 15 } }, '2026-01-07');
    expect(life.book.pots()).toMatchObject({ savings: 500000, needs: 100000, wants: 50000 });
    // 2,000.00: reserve 1,500; rest 500 -> savings 60% 300, needs 25% 125, wants 15% 75
    life.paycheck(200000, '2026-01-16');
    expect(life.book.pots()).toMatchObject({ savings: 530000, needs: 112500, wants: 57500, momReserve: 150000 });
    life.expectBalanced();
  });

  it('13.1 reserve per paycheck changed: next paycheck takes the new amount', () => {
    // reserve 1,000.00; rest 1,000.00 -> savings 500, needs 300, wants 200
    const life = new Life();
    life.book.changeSettings({ momReservePerPaycheck: 100000 }, '2026-01-07');
    life.paycheck(200000, '2026-01-16');
    expect(life.book.pots()).toMatchObject({ savings: 550000, needs: 130000, wants: 70000, momReserve: 100000 });
    life.expectBalanced();
  });
});

describe('13.2 a new or changed rule applies to new and unsorted transactions only', () => {
  it('13.2 adding a rule sorts waiting items but leaves sorted ones', () => {
    const rules: SortingRule[] = [{ id: 'r-cinema', for: 'purchase', contains: 'CINEMA', bucket: 'wants' }];
    const life = new Life({ rules });
    life.buy(2000, '2026-01-06', 'CINEMA SNACKS'); // wants 480.00 (sorted)
    life.buy(3000, '2026-01-06', 'SNACKS MART'); // unsorted 30.00
    // new rule: anything with SNACKS -> needs
    life.book.addRule({ id: 'r-snacks', for: 'purchase', contains: 'SNACKS', bucket: 'needs' }, '2026-01-07');
    // CINEMA SNACKS stays in wants (already sorted); SNACKS MART -> needs 970.00
    expect(life.book.pots()).toMatchObject({ wants: 48000, needs: 97000, unsortedOut: 0 });
    // a new SNACKS MART follows the new rule: needs 970 - 10 = 960.00
    life.buy(1000, '2026-01-08', 'SNACKS MART');
    expect(life.book.pots().needs).toBe(96000);
    life.expectBalanced();
  });

  it('13.2 changing a rule leaves already-sorted purchases where they are', () => {
    const rules: SortingRule[] = [{ id: 'r1', for: 'purchase', contains: 'GROCER', bucket: 'needs' }];
    const life = new Life({ rules });
    life.buy(4000, '2026-01-06', 'CITY GROCER'); // needs 960.00
    life.book.changeRule({ id: 'r1', for: 'purchase', contains: 'GROCER', bucket: 'wants' }, '2026-01-07');
    expect(life.book.pots()).toMatchObject({ needs: 96000, wants: 50000 });
    life.buy(1000, '2026-01-08', 'CITY GROCER'); // new: wants 490.00
    expect(life.book.pots()).toMatchObject({ needs: 96000, wants: 49000 });
  });
});

describe('13.3 money can be moved between buckets by hand', () => {
  it('13.3 needs -> wants 50.00', () => {
    const life = new Life();
    expect(life.book.moveMoney({ from: 'needs', to: 'wants', amount: 5000 }, '2026-01-07')).toEqual({ moved: true });
    expect(life.book.pots()).toMatchObject({ needs: 95000, wants: 55000 });
    life.expectBalanced();
  });
});

describe('13.4 moves out of savings or the reserve, or below zero, ask to confirm', () => {
  it('13.4 out of savings asks first; nothing moves until confirmed', () => {
    const life = new Life();
    const r = life.book.moveMoney({ from: 'savings', to: 'wants', amount: 10000 }, '2026-01-07');
    expect(r).toMatchObject({ moved: false, needsConfirmation: true });
    expect(r.moved === false && r.reasons).toEqual(['out-of-savings']);
    expect(life.book.pots()).toMatchObject({ savings: 500000, wants: 50000 });
    expect(life.book.moveMoney({ from: 'savings', to: 'wants', amount: 10000, confirmed: true }, '2026-01-07')).toEqual({ moved: true });
    expect(life.book.pots()).toMatchObject({ savings: 490000, wants: 60000 });
  });

  it('13.4 out of the reserve asks first', () => {
    const life = new Life({ pots: { momReserve: 50000 }, bank: { checking: 350000 } });
    const r = life.book.moveMoney({ from: 'momReserve', to: 'needs', amount: 100 }, '2026-01-07');
    expect(r.moved === false && r.reasons).toEqual(['out-of-mom-reserve']);
    expect(life.book.pots().momReserve).toBe(50000);
  });

  it('13.4 taking a bucket exactly to zero does not ask', () => {
    const life = new Life();
    expect(life.book.moveMoney({ from: 'wants', to: 'needs', amount: 50000 }, '2026-01-07')).toEqual({ moved: true });
    expect(life.book.pots().wants).toBe(0);
  });

  it('13.4 one cent below zero asks', () => {
    const life = new Life();
    const r = life.book.moveMoney({ from: 'wants', to: 'needs', amount: 50001 }, '2026-01-07');
    expect(r.moved === false && r.reasons).toEqual(['below-zero']);
    expect(life.book.pots().wants).toBe(50000);
  });

  it('13.4 out of savings and below zero gives both reasons', () => {
    const life = new Life();
    const r = life.book.moveMoney({ from: 'savings', to: 'needs', amount: 500001 }, '2026-01-07');
    expect(r.moved === false && [...r.reasons].sort()).toEqual(['below-zero', 'out-of-savings']);
  });

  it('13.4 into savings from needs does not ask', () => {
    const life = new Life();
    expect(life.book.moveMoney({ from: 'needs', to: 'savings', amount: 100 }, '2026-01-07')).toEqual({ moved: true });
  });
});

describe('13.5 every change and every manual move is logged with the date', () => {
  it('13.5 settings change, rule added, money moved', () => {
    const life = new Life();
    life.book.changeSettings({ lowBucketAlertPercent: 25 }, '2026-01-07');
    const rule: SortingRule = { id: 'r1', for: 'purchase', contains: 'GROCER', bucket: 'needs' };
    life.book.addRule(rule, '2026-01-08');
    life.book.moveMoney({ from: 'needs', to: 'wants', amount: 1234 }, '2026-01-09');
    const log = life.book.changeLog();
    expect(log).toContainEqual(expect.objectContaining({ date: '2026-01-07', kind: 'settings-changed' }));
    expect(log).toContainEqual(expect.objectContaining({ date: '2026-01-08', kind: 'rule-added', rule }));
    expect(log).toContainEqual({ date: '2026-01-09', kind: 'money-moved', from: 'needs', to: 'wants', amount: 1234 });
  });

  it('13.5 a refused (unconfirmed) move is not logged as a move', () => {
    const life = new Life();
    life.book.moveMoney({ from: 'savings', to: 'wants', amount: 100 }, '2026-01-09');
    expect(life.book.changeLog().filter((e) => e.kind === 'money-moved')).toEqual([]);
  });
});

describe('13.6 an "always do this" rule goes just ahead of the rule it corrects', () => {
  it('13.6 new rule goes ahead of the first matching rule, and sticks', () => {
    const rules: SortingRule[] = [
      { id: 'A', for: 'purchase', contains: 'COFFEE', bucket: 'wants' },
      { id: 'B', for: 'purchase', contains: 'SHOP', bucket: 'wants' },
    ];
    const life = new Life({ rules });
    const p = life.buy(600, '2026-01-06', 'SHOP COFFEE BAR'); // wants via A
    const r = life.book.sortAlways(p.id, { to: 'needs' }, { id: 'C', contains: 'SHOP COFFEE' }, '2026-01-06');
    expect(r.sticks).toBe(true);
    expect(life.book.rules().map((x) => x.id)).toEqual(['C', 'A', 'B']);
    // that purchase now in needs: needs 994.00, wants 500.00
    expect(life.book.pots()).toMatchObject({ needs: 99400, wants: 50000 });
    // the next one follows the correction: needs 988.00
    life.buy(600, '2026-01-07', 'SHOP COFFEE BAR');
    expect(life.book.pots().needs).toBe(98800);
    life.expectBalanced();
  });

  it('13.6 the corrected rule may be the one that matched the posted description', () => {
    // pending "PND MARKET" matches P (2nd); posted "MARKET ST 22" matches X (1st).
    // First rule in the list matching either is X -> new rule goes ahead of X.
    const rules: SortingRule[] = [
      { id: 'X', for: 'purchase', contains: 'MARKET ST', bucket: 'wants' },
      { id: 'P', for: 'purchase', contains: 'PND', bucket: 'wants' },
    ];
    const life = new Life({ rules });
    const pend = life.buy(2000, '2026-01-06', 'PND MARKET', { pending: true });
    const posted = life.buy(2000, '2026-01-07', 'MARKET ST 22', { pendingId: pend.id });
    life.book.sortAlways(posted.id, { to: 'needs' }, { id: 'C', contains: 'MARKET ST' }, '2026-01-07');
    expect(life.book.rules().map((x) => x.id)).toEqual(['C', 'X', 'P']);
  });

  it('13.6 the corrected rule may be the one that matched the pending description', () => {
    // same item, list order swapped: P is first and matches the pending description
    const rules: SortingRule[] = [
      { id: 'P', for: 'purchase', contains: 'PND', bucket: 'wants' },
      { id: 'X', for: 'purchase', contains: 'MARKET ST', bucket: 'wants' },
    ];
    const life = new Life({ rules });
    const pend = life.buy(2000, '2026-01-06', 'PND MARKET', { pending: true });
    const posted = life.buy(2000, '2026-01-07', 'MARKET ST 22', { pendingId: pend.id });
    life.book.sortAlways(posted.id, { to: 'needs' }, { id: 'C', contains: 'MARKET ST' }, '2026-01-07');
    expect(life.book.rules().map((x) => x.id)).toEqual(['C', 'P', 'X']);
  });

  it('13.6 no rule matched: the new rule goes at the end', () => {
    const rules: SortingRule[] = [{ id: 'A', for: 'purchase', contains: 'COFFEE', bucket: 'wants' }];
    const life = new Life({ rules });
    const p = life.buy(1500, '2026-01-06', 'BOOKSHOP');
    life.book.sortAlways(p.id, { to: 'wants' }, { id: 'C', contains: 'BOOKSHOP' }, '2026-01-06');
    expect(life.book.rules().map((x) => x.id)).toEqual(['A', 'C']);
    expect(life.book.pots()).toMatchObject({ wants: 48500, unsortedOut: 0 });
  });
});
