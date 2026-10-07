import { describe, expect, it } from 'vitest';
import { appSide, deposit, openTestBook, purchase } from './helpers.js';

// Rule 12.2, as a number the Buckets screen can show: everything in the
// buckets, which is what the bank side of the self-check must equal.

describe('12.2 the app side is what all the buckets add up to', () => {
  it('12.2 savings + needs + wants + mom reserve + held for others + unsorted money in - unsorted spending', () => {
    const b = openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 150_000, heldForOthers: 7_000 } });
    expect(b.appSide()).toBe(337_000);
    b.receive(deposit('d1', '2026-10-05', 25_000, 'MADE UP TAX REFUND'));
    expect(b.appSide()).toBe(362_000);
    b.receive(purchase('p1', '2026-10-05', 1_150, 'CORNER STORE'));
    expect(b.appSide()).toBe(360_850);
    expect(b.appSide()).toBe(appSide(b.pots()));
  });

  it('12.2 sorting changes where the money sits, never the total', () => {
    const b = openTestBook({ pots: { wants: 30_000 } });
    b.receive(deposit('d1', '2026-10-05', 25_000, 'MADE UP TAX REFUND'));
    b.receive(purchase('p1', '2026-10-05', 1_150, 'CORNER STORE'));
    const before = b.appSide();
    b.sort('d1', { to: 'savings' }, '2026-10-06');
    b.sort('p1', { to: 'needs' }, '2026-10-06');
    expect(b.appSide()).toBe(before);
  });

  it('12.2 it can be below zero when spending is far ahead of the buckets', () => {
    const b = openTestBook();
    b.receive(purchase('p1', '2026-10-05', 1, 'CORNER STORE'));
    expect(b.appSide()).toBe(-1);
  });

  it('12.3 the self-check compares the bank with this same number', () => {
    const b = openTestBook({ pots: { savings: 100_000, wants: 30_000 } });
    b.receive(purchase('p1', '2026-10-05', 1_150, 'CORNER STORE'));
    const check = b.selfCheck({ checking: 130_000 - 1_150 + 1_150, savings: 0, everydayCard: 1_150 });
    expect(check.appSide).toBe(b.appSide());
  });
});
