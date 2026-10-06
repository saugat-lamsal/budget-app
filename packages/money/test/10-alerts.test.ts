import { describe, expect, it } from 'vitest';
import { alertsNow } from '../src/index.js';
import { openTestBook, paycheck, purchase, type TestBookOptions } from './helpers.js';

// 10.1 (low bucket) is not built: what "20% left" is measured against is an
// open question (QUESTIONS.md A8). 10.4 (totals do not match the bank) is
// tested with the self-check in 12-self-check.test.ts.

function book(options: TestBookOptions = {}) {
  return openTestBook({ pots: { savings: 0, needs: 10_000, wants: 10_000, momReserve: 0, heldForOthers: 0 }, ...options });
}

const OK = { bankConnection: 'ok' } as const;

describe('10.2 empty bucket: needs or wants reaches zero or below', () => {
  it('10.2 a bucket at exactly zero is empty', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-05', 10_000, 'MADE UP STORE'));
    b.sort('e1', { to: 'needs' }, '2026-10-05');
    expect(alertsNow(b, OK)).toEqual([{ kind: 'empty-bucket', bucket: 'needs', amount: 0 }]);
  });

  it('10.2 below zero is empty too', () => {
    const b = book({ pots: { needs: 10_000, wants: -1 } });
    expect(alertsNow(b, OK)).toEqual([{ kind: 'empty-bucket', bucket: 'wants', amount: -1 }]);
  });

  it('10.2 one cent left is not empty', () => {
    const b = book({ pots: { needs: 1, wants: 1 } });
    expect(alertsNow(b, OK)).toEqual([]);
  });

  it('10.2 only needs and wants: savings and the mom reserve at zero are not alerts', () => {
    const b = book({ pots: { savings: 0, momReserve: -5, needs: 10_000, wants: 10_000 } });
    expect(alertsNow(b, OK)).toEqual([]);
  });

  it('10.2 both buckets empty gives two alerts', () => {
    const b = book({ pots: { needs: 0, wants: 0 } });
    expect(alertsNow(b, OK)).toEqual([
      { kind: 'empty-bucket', bucket: 'needs', amount: 0 },
      { kind: 'empty-bucket', bucket: 'wants', amount: 0 },
    ]);
  });
});

describe('10.3 daily review: at the review time, only if something is unsorted', () => {
  it('10.3 nothing waiting means no daily review alert', () => {
    expect(alertsNow(book(), OK)).toEqual([]);
  });

  it('10.3 something waiting in review: the alert, at the review time, with how many', () => {
    const b = book();
    b.receive(purchase('e1', '2026-10-05', 100, 'MADE UP STORE'));
    b.receive(purchase('e2', '2026-10-05', 100, 'MADE UP STORE'));
    expect(alertsNow(b, OK)).toEqual([{ kind: 'daily-review', at: '20:00', waiting: 2 }]);
  });

  it('10.3 a leftover question and an old card flag count as waiting too', () => {
    const b = book({ pots: { needs: 10_000, wants: 10_000 } });
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.receive(purchase('o1', '2026-10-10', 100, 'MADE UP STORE', { account: 'old-card' }));
    expect(alertsNow(b, OK)).toEqual([{ kind: 'daily-review', at: '20:00', waiting: 3 }]);
  });

  it('10.3 the review time is a setting', () => {
    const b = book({ settings: { dailyReviewTime: '21:15' } });
    b.receive(purchase('e1', '2026-10-05', 100, 'MADE UP STORE'));
    expect(alertsNow(b, OK)).toEqual([{ kind: 'daily-review', at: '21:15', waiting: 1 }]);
  });
});

describe('10.5 the bank connection needs you to log in again', () => {
  it('10.5 the alert shows when the bank connection asks for a new login', () => {
    expect(alertsNow(book(), { bankConnection: 'needs-login' })).toEqual([{ kind: 'bank-login' }]);
  });

  it('10.5 no alert while the connection is fine', () => {
    expect(alertsNow(book(), OK)).toEqual([]);
  });
});
