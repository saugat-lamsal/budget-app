// Second opinion, rulebook section 5 (transfers and card payments).
// Starting pots: savings 5,000.00, needs 1,000.00, wants 500.00.
// Old card debt 3,000.00.

import { describe, expect, it } from 'vitest';
import { Life } from './helpers.js';

const POTS_AT_START = { savings: 500000, needs: 100000, wants: 50000, momReserve: 0, heldForOthers: 0 };

describe('5.1 checking to everyday card is not spending', () => {
  it('5.1 card payment changes no bucket', () => {
    const life = new Life();
    life.transfer(20000, '2026-01-07', 'checking', 'everyday-card');
    expect(life.book.pots()).toMatchObject({ ...POTS_AT_START, unsortedOut: 0 });
    life.expectBalanced();
  });

  it('5.1 the payment is seen as an everyday card payment', () => {
    const life = new Life();
    life.transfer(20000, '2026-01-07', 'checking', 'everyday-card');
    const pays = life.book.cardPayments('everyday-card');
    expect(pays.map((p) => p.amount)).toEqual([20000]);
    expect(pays[0]!.date).toBe('2026-01-07');
  });
});

describe('5.2 checking to old card is spending from needs, on a debt payoff line', () => {
  it('5.2 payment of 150.00 takes needs to 850.00 and debt to 2,850.00', () => {
    // needs 1,000 - 150 = 850.00; debt 3,000 - 150 = 2,850.00
    const life = new Life();
    life.transfer(15000, '2026-01-07', 'checking', 'old-card');
    expect(life.book.pots()).toMatchObject({ needs: 85000, wants: 50000, savings: 500000 });
    expect(life.book.oldCardDebt()).toBe(285000);
    const line = life.book.purchases().find((p) => p.kind === 'debt-payoff');
    expect(line).toMatchObject({ amount: 15000 });
    life.expectBalanced();
  });

  it('5.2 one-cent payment', () => {
    const life = new Life();
    life.transfer(1, '2026-01-07', 'checking', 'old-card');
    expect(life.book.pots().needs).toBe(99999);
    expect(life.book.oldCardDebt()).toBe(299999);
    life.expectBalanced();
  });

  it('5.2 the payment is seen as an old card payment', () => {
    const life = new Life();
    life.transfer(15000, '2026-01-07', 'checking', 'old-card');
    expect(life.book.cardPayments('old-card').map((p) => p.amount)).toEqual([15000]);
  });
});

describe('5.3 checking <-> savings changes no bucket', () => {
  it('5.3 checking to savings: buckets unchanged, still-to-move drops', () => {
    // shouldBeInSavings = 5,000.00 + 0; account 4,000 -> 1,000 to move
    // after moving 500.00: account 4,500 -> 500.00 to move
    const life = new Life();
    expect(life.book.savingsTransfer(life.bank().savings).stillToMove).toBe(100000);
    life.transfer(50000, '2026-01-07', 'checking', 'savings');
    expect(life.book.pots()).toMatchObject({ ...POTS_AT_START, unsortedIn: 0, unsortedOut: 0 });
    expect(life.book.savingsTransfer(life.bank().savings).stillToMove).toBe(50000);
    life.expectBalanced();
  });

  it('5.3 savings to checking: buckets unchanged', () => {
    const life = new Life();
    life.transfer(123456, '2026-01-07', 'savings', 'checking');
    expect(life.book.pots()).toMatchObject({ ...POTS_AT_START, unsortedIn: 0, unsortedOut: 0 });
    life.expectBalanced();
  });
});

describe('5.4 a new purchase on the old card is flagged and raises the debt', () => {
  it('5.4 old card purchase: review flag, debt +80.00, no bucket change', () => {
    // debt 3,000 + 80 = 3,080.00
    const life = new Life();
    const r = life.buy(8000, '2026-01-07', 'HARDWARE', { account: 'old-card' });
    expect(life.book.reviewItems().find((i) => i.id === r.id)).toMatchObject({ type: 'old-card-purchase', amount: 8000 });
    expect(life.book.oldCardDebt()).toBe(308000);
    expect(life.book.pots()).toMatchObject({ ...POTS_AT_START, unsortedOut: 0 });
    life.expectBalanced();
  });

  it('5.4 it touches needs only when paid', () => {
    // pay 80.00: needs 1,000 - 80 = 920.00; debt 3,080 - 80 = 3,000.00
    const life = new Life();
    life.buy(8000, '2026-01-07', 'HARDWARE', { account: 'old-card' });
    life.transfer(8000, '2026-01-10', 'checking', 'old-card');
    expect(life.book.pots().needs).toBe(92000);
    expect(life.book.oldCardDebt()).toBe(300000);
    life.expectBalanced();
  });
});

describe('5.5 interest or fees on the old card raise the debt only', () => {
  it('5.5 interest 12.34 raises debt to 3,012.34; no bucket changes', () => {
    const life = new Life();
    life.feed({ kind: 'card-charge', id: 'oi1', account: 'old-card', date: '2026-01-07', amount: 1234, description: 'INTEREST', charge: 'interest' });
    expect(life.book.oldCardDebt()).toBe(301234);
    expect(life.book.pots()).toMatchObject({ ...POTS_AT_START, unsortedOut: 0 });
    life.expectBalanced();
  });

  it('5.5 a fee raises debt; no bucket changes', () => {
    const life = new Life();
    life.feed({ kind: 'card-charge', id: 'of1', account: 'old-card', date: '2026-01-07', amount: 3900, description: 'LATE FEE', charge: 'fee' });
    expect(life.book.oldCardDebt()).toBe(303900);
    expect(life.book.pots()).toMatchObject({ ...POTS_AT_START, unsortedOut: 0 });
  });
});
