import { describe, expect, it } from 'vitest';
import { type Book } from '../src/index.js';
import { MOM_NAME, arrived, cardCharge, deposit, dropped, openTestBook, payPerson, paycheck, posted, purchase, refund, sent, takenBack, transfer, withdrawal } from './helpers.js';

// Sorting something again from the list of what went in and out of a bucket
// (rule 4.7, QUESTIONS.md B100): which items can be, and the choices the
// rulebook gives for each kind. The same choices as in review, for the same
// kind of item.

const RULES = [
  { id: 'grocery', for: 'purchase', contains: 'GROCERY', bucket: 'needs' },
  { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
] as const;
const START = { savings: 100_000, needs: 50_000, wants: 20_000, momReserve: 120_000, heldForOthers: 0 } as const;

function openBook(): Book {
  return openTestBook({ pots: START, rules: RULES });
}

describe('B100 a purchase can be sorted again, to where the rulebook allows', () => {
  it('4.7 4.2 4.4 B100 a purchase on a card: needs or wants, or a split; no transfer, since it did not leave checking or savings', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    expect(b.resortDetail('g1')).toMatchObject({
      resortable: true,
      id: 'g1',
      type: 'spending',
      description: 'MADE UP GROCERY',
      date: '2026-10-02',
      amount: 3_250,
      account: 'everyday-card',
      pending: false,
      now: { to: 'needs' },
      options: {
        type: 'sort',
        picks: [{ to: 'needs', final: false }, { to: 'wants', final: false }],
        split: ['needs', 'wants'],
        transfer: [],
        always: ['needs', 'wants'],
        unavailable: [],
        match: [],
      },
      likelyPurchases: [],
      paycheckPreview: null,
    });
  });

  it('4.7 5.6 B100 a purchase on the debit card can also be marked a transfer between your accounts', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY', { account: 'checking' }));
    expect(b.resortDetail('g1')).toMatchObject({ options: { transfer: ['savings', 'everyday-card', 'old-card'], transferOutcome: { savings: 'no-bucket-change', 'old-card': 'out-of-needs' } } });
  });

  it('5.6 B74 a pending purchase cannot be marked a transfer yet, and the choices say why', () => {
    const b = openBook();
    b.receive(purchase('c1', '2026-10-02', 1_000, 'MADE UP CAFE', { account: 'checking', pending: true }));
    const d = b.resortDetail('c1');
    expect(d).toMatchObject({ resortable: true, pending: true, now: { to: 'wants' }, options: { transfer: [], unavailable: [{ what: 'transfer' }] } });
  });

  it('4.4 4.5 B100 a purchase split across buckets says how, and what is left after a partial refund is what is counted', () => {
    const b = openBook();
    b.receive(purchase('h1', '2026-10-02', 9_000, 'MADE UP HARDWARE', { account: 'checking' }));
    b.sort('h1', { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 3_000 }] }, '2026-10-03');
    expect(b.resortDetail('h1')).toMatchObject({ amount: 9_000, now: { split: [{ bucket: 'needs', amount: 6_000 }, { bucket: 'wants', amount: 3_000 }] } });
    // A partial refund sends it back to review to be split again (4.5): it is waiting, not sorted.
    b.receive(refund('r1', '2026-10-04', 1_000, 'h1', 'checking'));
    expect(b.resortDetail('h1')).toMatchObject({ resortable: false });
  });

  it('4.5 B100 a purchase that was partly refunded counts what is left of it, and cannot be marked a transfer', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY', { account: 'checking' }));
    b.receive(refund('r1', '2026-10-04', 1_000, 'g1', 'checking'));
    expect(b.resortDetail('g1')).toMatchObject({ amount: 2_250, options: { transfer: [], unavailable: [{ what: 'transfer' }] } });
  });

  it('4.6 4.7 B100 the posted version of a pending charge is the same item, whichever of its two ids is asked about', () => {
    const b = openBook();
    b.receive(purchase('c1', '2026-10-02', 1_000, 'MADE UP CAFE', { pending: true }));
    b.receive(posted('c1-posted', 'c1', '2026-10-03', 1_200, 'MADE UP CAFE'));
    expect(b.resortDetail('c1-posted')).toEqual(b.resortDetail('c1'));
    expect(b.resortDetail('c1')).toMatchObject({ id: 'c1', amount: 1_200, pending: false });
  });

  it('4.8 B100 a card fee sorted to needs can go to wants or be split, but no rule can be made for it', () => {
    const b = openBook();
    b.receive(cardCharge('f1', '2026-10-03', 3_500, 'fee'));
    b.sort('f1', { to: 'needs' }, '2026-10-04');
    expect(b.resortDetail('f1')).toMatchObject({ now: { to: 'needs' }, options: { picks: [{ to: 'needs' }, { to: 'wants' }], split: ['needs', 'wants'], always: [] } });
  });

  it('4.9 B100 money that left savings, sorted to wants, can be sorted again, but no rule can be made for it', () => {
    const b = openBook();
    b.receive(withdrawal('w1', '2026-10-03', 6_410, 'MADE UP BILL PAY'));
    b.sort('w1', { to: 'wants' }, '2026-10-04');
    expect(b.resortDetail('w1')).toMatchObject({ account: 'savings', now: { to: 'wants' }, options: { picks: [{ to: 'needs' }, { to: 'wants' }], always: [] } });
  });

  it('5.2 B100 a payment to the old card from checking always comes out of needs, so it cannot be sorted again', () => {
    const b = openBook();
    b.receive(transfer('o1', '2026-10-03', 20_000, 'checking', 'old-card'));
    expect(b.resortDetail('o1')).toMatchObject({ resortable: false, id: 'o1', why: expect.stringContaining('Needs') });
    b.receive(sent('o2', '2026-10-04', 10_000, 'checking', 'old-card'));
    expect(b.resortDetail('o2')).toMatchObject({ resortable: false });
  });

  it('5.2 A4 B100 a payment to the old card from savings, once confirmed, can still be moved between savings and needs', () => {
    const b = openBook();
    b.receive(transfer('o1', '2026-10-03', 20_000, 'savings', 'old-card'));
    b.sort('o1', { to: 'savings' }, '2026-10-04');
    expect(b.resortDetail('o1')).toMatchObject({ resortable: true, now: { to: 'savings' }, options: { picks: [{ to: 'savings' }, { to: 'needs' }], split: null, transfer: [], always: [] } });
  });
});

describe('B100 a payment to a person can be sorted again, but not one the mom rule matched', () => {
  it('7.4 7.6 B100 a payment sorted to needs: needs, wants, not mine, or for mom, or split three ways', () => {
    const b = openBook();
    b.receive(payPerson('z1', '2026-10-03', 4_000, 'MADE UP FRIEND'));
    b.sort('z1', { to: 'needs' }, '2026-10-04');
    expect(b.resortDetail('z1')).toMatchObject({
      now: { to: 'needs' },
      options: { picks: [{ to: 'needs' }, { to: 'wants' }, { to: 'not-mine' }, { to: 'mom' }], split: ['needs', 'wants', 'not-mine'], always: ['needs', 'wants', 'not-mine', 'mom'] },
    });
  });

  it('8.1 B100 a payment the mom rule matched always comes out of the mom reserve, so it cannot be sorted again', () => {
    const b = openBook();
    b.receive(payPerson('m1', '2026-10-03', 50_000, MOM_NAME));
    expect(b.resortDetail('m1')).toMatchObject({ resortable: false, why: expect.stringContaining('mom reserve') });
  });

  it('7.6 B73 B100 a payment you marked for mom can be sorted again, but then no rule and no transfer', () => {
    const b = openBook();
    b.receive(payPerson('z1', '2026-10-03', 4_000, 'MADE UP FRIEND'));
    b.sort('z1', { to: 'mom' }, '2026-10-04');
    expect(b.resortDetail('z1')).toMatchObject({
      resortable: true,
      now: { to: 'mom' },
      options: { picks: [{ to: 'needs' }, { to: 'wants' }, { to: 'not-mine' }, { to: 'mom' }], split: ['needs', 'wants', 'not-mine'], transfer: [], always: [] },
    });
  });

  it('8.3 B100 the difference on a mom payment, once sorted, goes to needs or wants and cannot be split', () => {
    const b = openTestBook({ pots: { ...START, momReserve: 10_000 }, rules: RULES });
    b.receive(payPerson('m1', '2026-10-03', 25_000, MOM_NAME));
    b.sort('m1:difference', { to: 'needs' }, '2026-10-04');
    expect(b.resortDetail('m1:difference')).toMatchObject({ amount: 15_000, now: { to: 'needs' }, options: { picks: [{ to: 'needs' }, { to: 'wants' }], split: null, always: [] } });
  });
});

describe('B100 money that came in can be sorted again, to where the rulebook allows', () => {
  it('6.1 B100 other income: my paycheck, other income, payback into any bucket, or not mine, or a transfer', () => {
    const b = openBook();
    b.receive(deposit('d1', '2026-10-03', 10_000, 'MADE UP SIDE JOB'));
    b.sort('d1', { to: 'other-income' }, '2026-10-03');
    const d = b.resortDetail('d1');
    expect(d).toMatchObject({
      resortable: true,
      type: 'money-in',
      amount: 10_000,
      account: 'checking',
      now: { to: 'other-income' },
      options: {
        picks: [{ to: 'paycheck', final: true }, { to: 'other-income' }, { to: 'savings' }, { to: 'needs' }, { to: 'wants' }, { to: 'momReserve' }, { to: 'not-mine' }],
        transfer: ['savings'],
        always: ['other-income', 'savings', 'needs', 'wants', 'momReserve', 'not-mine'],
      },
    });
    // What "this is my paycheck" would give (3.2, 3.3), from the money math.
    expect(d).toMatchObject({ paycheckPreview: { momReserve: 10_000, savings: 0, needs: 0, wants: 0 } });
  });

  it('6.1 B54 B100 a deposit older than the last paycheck cannot be my paycheck, and the choices say why', () => {
    const b = openBook();
    b.receive(deposit('d1', '2026-09-20', 10_000, 'MADE UP LATE ARRIVAL'));
    b.sort('d1', { to: 'wants' }, '2026-10-03');
    const d = b.resortDetail('d1');
    expect(d).toMatchObject({ resortable: true, now: { to: 'wants' }, paycheckPreview: null, options: { unavailable: [{ what: 'paycheck' }] } });
    expect(d && d.resortable ? d.options.picks.some((p) => p.to === 'paycheck') : null).toBe(false);
  });

  it('6.1 B100 a store refund put into a bucket can be put somewhere else, or matched to a purchase, but is never income', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-01', 3_250, 'MADE UP GROCERY'));
    b.receive(refund('r1', '2026-10-03', 3_250));
    b.sort('r1', { to: 'wants' }, '2026-10-03');
    const d = b.resortDetail('r1');
    expect(d).toMatchObject({
      resortable: true,
      type: 'money-in',
      now: { to: 'wants' },
      options: { picks: [{ to: 'savings' }, { to: 'needs' }, { to: 'wants' }, { to: 'momReserve' }, { to: 'not-mine' }], match: ['g1'], always: [] },
      likelyPurchases: [{ id: 'g1' }],
    });
  });

  it('4.5 B100 a refund matched to its purchase counts on the purchase and cannot be sorted again', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-01', 3_250, 'MADE UP GROCERY'));
    b.receive(refund('r1', '2026-10-03', 3_250, 'g1'));
    expect(b.resortDetail('r1')).toMatchObject({ resortable: false, id: 'r1' });
  });

  it('6.1 5.6 B100 a deposit marked a transfer between your accounts is half of one, and not on any list to sort', () => {
    const b = openBook();
    b.receive(deposit('d1', '2026-10-03', 10_000, 'MADE UP SIDE JOB'));
    b.sort('d1', { transfer: 'savings' }, '2026-10-03');
    expect(b.resortDetail('d1')).toMatchObject({ resortable: false });
    b.receive(arrived('a1', '2026-10-04', 5_000, 'checking', 'savings'));
    expect(b.resortDetail('a1')).toMatchObject({ resortable: false });
  });
});

describe('B100 some things cannot be sorted again from here, and the answer says why', () => {
  it('3.1 B52 B100 a paycheck is final', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    expect(b.resortDetail('p1')).toMatchObject({ resortable: false, id: 'p1', why: expect.stringContaining('paycheck') });
  });

  it('3.4 B100 your answer to a payday question is final', () => {
    const b = openBook();
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.answerLeftover('leftover:p1:needs', 'move-to-savings', '2026-10-10');
    expect(b.resortDetail('leftover:p1:needs')).toMatchObject({ resortable: false, why: expect.stringContaining('payday') });
  });

  it('13.3 B100 a hand move is undone by moving the money back', () => {
    const b = openBook();
    b.moveMoney({ from: 'wants', to: 'needs', amount: 500 }, '2026-10-05');
    expect(b.resortDetail('move:1')).toMatchObject({ resortable: false, why: expect.stringContaining('move') });
  });

  it('4.10 B100 something the bank took back has nothing left to sort', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    b.receive(takenBack('t1', 'g1', '2026-10-03'));
    expect(b.resortDetail('g1')).toMatchObject({ resortable: false, why: expect.stringContaining('bank') });
  });

  it('4.6 B100 a pending charge the bank dropped has nothing left to sort', () => {
    const b = openBook();
    b.receive(purchase('c1', '2026-10-02', 1_000, 'MADE UP CAFE', { pending: true }));
    b.receive(dropped('c1-dropped', 'c1', '2026-10-03'));
    expect(b.resortDetail('c1')).toMatchObject({ resortable: false, why: expect.stringContaining('bank') });
  });

  it('B100 something still waiting in review is sorted there', () => {
    const b = openBook();
    b.receive(purchase('x1', '2026-10-02', 1_150, 'MADE UP CORNER STORE'));
    expect(b.resortDetail('x1')).toMatchObject({ resortable: false, why: expect.stringContaining('Review') });
  });

  it('B100 an item that is not in the book is null, not an error', () => {
    const b = openBook();
    expect(b.resortDetail('nothing-like-this')).toBeNull();
    expect(b.resortDetail('')).toBeNull();
  });

  it('B100 asking changes nothing in the book', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    const before = JSON.stringify([b.pots(), b.reviewItems(), b.changeLog(), b.purchases(), b.activity('needs')]);
    b.resortDetail('g1');
    b.resortDetail('nothing');
    expect(JSON.stringify([b.pots(), b.reviewItems(), b.changeLog(), b.purchases(), b.activity('needs')])).toBe(before);
  });

  it('B100 every row of a list carries the same answer that asking about its item gives', () => {
    const b = openBook();
    b.receive(purchase('g1', '2026-10-02', 3_250, 'MADE UP GROCERY'));
    b.receive(paycheck('p1', '2026-10-09', 400_000));
    b.moveMoney({ from: 'wants', to: 'needs', amount: 500 }, '2026-10-10');
    for (const pot of ['needs', 'wants', 'savings', 'momReserve'] as const) {
      for (const row of b.activity(pot).rows) expect(row.resort, `${pot} ${row.id}`).toEqual(b.resortDetail(row.id));
    }
  });
});
