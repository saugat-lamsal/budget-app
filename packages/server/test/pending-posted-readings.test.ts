import type { Book } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { decision, everything, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// QUESTIONS.md A50b and B226: the bank words some items one way while
// pending and another once posted, so a bank rule can read the two
// differently. Whatever the pending one was read as, the books must end as if
// the bank had sent only the posted item: every bucket, money in transit, the
// self-check, and the history replaying. With the posted item linked to the
// pending one (pending_transaction_id) and without. Every name and number is
// made up.

const C = ACCOUNT_IDS.checking;
const E = ACCOUNT_IDS.everyday;

function book(life: Life): Book {
  const b = life.keeper.book();
  if (b === null) throw new Error('not set up');
  return b;
}

function checks(life: Life): boolean {
  const home = life.keeper.home();
  return home.state === 'tracking' && home.safeToSpend.shown;
}

async function setUp(): Promise<{ life: Life; pots: ReturnType<Book['pots']> }> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-02');
  return { life, pots: book(life).pots() };
}

function replaysTheSame(life: Life): void {
  const again = life.reopen();
  try {
    expect(everything(again.keeper.book()!)).toEqual(everything(book(life)));
  } finally {
    again.close();
  }
}

describe('A50b B226 pending read one way, posted another: the books end as if only the posted item came', () => {
  for (const link of [true, false]) {
    const linked = link ? 'linked to the pending one' : 'not linked';
    it(`A50b 4.6 5.1 a pending item read as a purchase, and sorted, posts as a card payment (${linked}): no spending, nothing left in transit`, async () => {
      const { life, pots } = await setUp();
      try {
        life.h.fake.addPending({ id: 'pay-p', account: C, amount: 10_000, date: '2026-10-02', description: 'ONLINE PMT CARD ENDING 3333 PENDING' });
        await life.sync();
        expect(book(life).reviewItems().map((i) => i.id)).toEqual(['pay-p']);
        expect(life.keeper.choice({ id: decision(), item: 'pay-p', choice: { to: 'wants' } }).ok).toBe(true);
        life.now = noonInNewYork('2026-10-03');
        life.h.fake.postPending('pay-p', { id: 'pay', date: '2026-10-03', description: 'Online payment to CRD 3333' }, { link });
        life.h.fake.addPosted({ id: 'pay-in', account: E, amount: -10_000, date: '2026-10-03', description: 'PAYMENT - THANK YOU' });
        await life.sync();
        expect(book(life).pots()).toEqual(pots);
        expect(book(life).inTransit().total).toBe(0);
        expect(book(life).reviewItems()).toEqual([]);
        expect(checks(life)).toBe(true);
        replaysTheSame(life);
      } finally {
        life.done();
      }
    });

    it(`A50b 4.6 7.4 a pending purchase posts as a payment to a person (${linked}): it waits in review as that`, async () => {
      const { life, pots } = await setUp();
      try {
        life.h.fake.addPending({ id: 'z-p', account: C, amount: 2_500, date: '2026-10-02', description: 'MADE UP PAY SERVICE PENDING' });
        await life.sync();
        expect(life.keeper.choice({ id: decision(), item: 'z-p', choice: { to: 'needs' } }).ok).toBe(true);
        life.now = noonInNewYork('2026-10-03');
        life.h.fake.postPending('z-p', { id: 'z', date: '2026-10-03', description: 'Zelle payment to MADE UP FRIEND' }, { link });
        await life.sync();
        const b = book(life);
        expect(b.pots()).toEqual({ ...pots, unsortedOut: pots.unsortedOut + 2_500 });
        expect(b.reviewItems()).toMatchObject([{ id: 'z', amount: 2_500, description: 'Zelle payment to MADE UP FRIEND' }]);
        expect(checks(life)).toBe(true);
        replaysTheSame(life);
      } finally {
        life.done();
      }
    });

    it(`A50b 4.6 a pending transfer posts as a purchase (${linked}): a purchase waiting in review, nothing in transit`, async () => {
      const { life, pots } = await setUp();
      try {
        life.h.fake.addPending({ id: 't-p', account: C, amount: 4_000, date: '2026-10-02', description: 'Online transfer to SAV 2222' });
        await life.sync();
        expect(book(life).reviewItems()).toEqual([]);
        life.now = noonInNewYork('2026-10-03');
        life.h.fake.postPending('t-p', { id: 't', date: '2026-10-03', description: 'MADE UP STORE 22' }, { link });
        await life.sync();
        const b = book(life);
        expect(b.pots()).toEqual({ ...pots, unsortedOut: pots.unsortedOut + 4_000 });
        expect(b.inTransit().total).toBe(0);
        expect(b.reviewItems().map((i) => i.id)).toEqual(['t']);
        expect(checks(life)).toBe(true);
        replaysTheSame(life);
      } finally {
        life.done();
      }
    });
  }
});
