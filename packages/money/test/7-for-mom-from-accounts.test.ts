import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Book } from '../src/index.js';
import { TestBank, codeOf, openTestBook, posted, purchase, refund, takenBack, withdrawal } from './helpers.js';

// Rule 7.9 (QUESTIONS.md A66): money leaving checking or savings that the app
// read as a purchase or a withdrawal, once it has posted, can be marked "for
// mom": a payment to mom the bank worded so that no bank rule read it as a
// payment to a person. It counts like 7.6's "for mom": out of the mom reserve
// and toward the month (8.1 to 8.3), and it can be sorted again later.

const DAY = '2026-11-02';
const MONTH = '2026-11';
const TO_MOM = 'MADE UP ZELLE PAYMENT TO MOM CONF# AB12CD';

function book(momReserve = 300_000): Book {
  return openTestBook({ pots: { savings: 500_000, needs: 100_000, wants: 50_000, momReserve } });
}

function picks(b: Book, id: string): readonly string[] {
  const d = b.reviewDetails().find((x) => x.item.id === id);
  if (d?.options.type !== 'sort') throw new Error(`${id} has no choices`);
  return d.options.picks.map((p) => p.to);
}

function resortPicks(b: Book, id: string): readonly string[] {
  const d = b.resortDetail(id);
  if (d === null || !d.resortable || d.options.type !== 'sort') throw new Error(`${id} cannot be sorted again: ${JSON.stringify(d)}`);
  return d.options.picks.map((p) => p.to);
}

function check(b: Book, bank: TestBank): boolean {
  return b.selfCheck({ checking: bank.checking, savings: bank.savings, everydayCard: bank.everydayCard }).ok;
}

describe('7.9 money leaving checking or savings can be marked for mom', () => {
  it('7.9 money leaving savings is offered for mom, and it comes out of the mom reserve and counts toward the month (8.1, 8.2)', () => {
    const b = book();
    const bank = new TestBank({ savings: 500_000 + 300_000, checking: 150_000 });
    expect(check(b, bank)).toBe(true);
    const sent = withdrawal('w1', DAY, 150_000, TO_MOM);
    b.receive(sent);
    bank.apply(sent);
    expect(picks(b, 'w1')).toEqual(['needs', 'wants', 'not-mine', 'mom']);
    b.sort('w1', { to: 'mom' }, DAY);
    expect(b.pots()).toMatchObject({ savings: 500_000, needs: 100_000, wants: 50_000, momReserve: 150_000, heldForOthers: 0, unsortedOut: 0 });
    expect(b.reviewItems()).toEqual([]);
    expect(b.momSentInMonth(MONTH).sent).toBe(150_000);
    expect(check(b, bank)).toBe(true);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.9 3.8 marked for mom, what savings should hold drops with the account, so nothing more is asked to be moved', () => {
    const b = book();
    // The account holds exactly savings + the mom reserve before the payment.
    expect(b.savingsTransfer(800_000).stillToMove).toBe(0);
    b.receive(withdrawal('w1', DAY, 150_000, TO_MOM));
    b.sort('w1', { to: 'not-mine' }, DAY);
    // Sorted to Other, the reserve keeps its $1,500, so $1,500 more is asked for.
    expect(b.savingsTransfer(650_000).stillToMove).toBe(150_000);
    b.sort('w1', { to: 'mom' }, DAY);
    expect(b.savingsTransfer(650_000).stillToMove).toBe(0);
  });

  it('7.9 money leaving checking read as a purchase is offered it too', () => {
    const b = book();
    b.receive(purchase('p1', DAY, 8_640, 'MADE UP PAYMENT', { account: 'checking' }));
    expect(picks(b, 'p1')).toEqual(['needs', 'wants', 'not-mine', 'mom']);
    b.sort('p1', { to: 'mom' }, DAY);
    expect(b.pots()).toMatchObject({ needs: 100_000, wants: 50_000, momReserve: 291_360, unsortedOut: 0 });
    expect(b.momSentInMonth(MONTH).sent).toBe(8_640);
  });

  it('7.9 a purchase on the everyday card or the old card is not offered it, and the book refuses it, changing nothing', () => {
    const b = book();
    b.receive(purchase('c1', DAY, 2_000, 'MADE UP SHOP', { account: 'everyday-card' }));
    expect(picks(b, 'c1')).toEqual(['needs', 'wants', 'not-mine']);
    b.receive(purchase('o1', DAY, 2_000, 'MADE UP SHOP', { account: 'old-card' }));
    const before = b.pots();
    expect(codeOf(() => b.sort('c1', { to: 'mom' }, DAY))).toBe('bad-choice');
    expect(codeOf(() => b.sort('o1', { to: 'mom' }, DAY))).not.toBeNull();
    expect(b.pots()).toEqual(before);
    expect(b.momSentInMonth(MONTH).sent).toBe(0);
  });

  it('7.9 4.6 not while pending; once the posted one replaces it, at its amount and day', () => {
    const b = book();
    b.receive(withdrawal('w1p', '2026-10-31', 150_000, 'MADE UP ZELLE TRANSFER CONF# AB12CD', { pending: true }));
    expect(picks(b, 'w1p')).toEqual(['needs', 'wants', 'not-mine']);
    const before = b.pots();
    expect(codeOf(() => b.sort('w1p', { to: 'mom' }, DAY))).toBe('bad-choice');
    expect(b.pots()).toEqual(before);
    b.receive(withdrawal('w1', DAY, 150_100, TO_MOM, { pendingId: 'w1p' }));
    expect(picks(b, 'w1p')).toEqual(['needs', 'wants', 'not-mine', 'mom']);
    b.sort('w1', { to: 'mom' }, DAY);
    expect(b.pots()).toMatchObject({ momReserve: 149_900, unsortedOut: 0 });
    // Counted in the month it posted, as the mom rule would have counted it.
    expect(b.momSentInMonth('2026-10').sent).toBe(0);
    expect(b.momSentInMonth(MONTH).sent).toBe(150_100);
    expect(b.recountPots()).toEqual(b.pots());
    // Sorted again, it is the posted one the bank sent, at its amount.
    b.sort('w1', { to: 'needs' }, DAY);
    expect(b.pots()).toMatchObject({ needs: 100_000 - 150_100, momReserve: 300_000, unsortedOut: 0 });
    expect(b.resortDetail('w1')).toMatchObject({ pending: false, amount: 150_100, description: TO_MOM });
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.9 8.3 bigger than the reserve: the reserve covers what it can, and the difference waits in review', () => {
    const b = book(100_000);
    b.receive(withdrawal('w1', DAY, 150_000, TO_MOM));
    b.sort('w1', { to: 'mom' }, DAY);
    expect(b.pots()).toMatchObject({ momReserve: 0, unsortedOut: 50_000, needs: 100_000, wants: 50_000 });
    expect(b.reviewItems()).toMatchObject([{ type: 'spending', id: 'w1:difference', amount: 50_000, reason: 'mom-difference' }]);
    b.sort('w1:difference', { to: 'needs' }, DAY);
    expect(b.pots()).toMatchObject({ momReserve: 0, unsortedOut: 0, needs: 50_000 });
    expect(b.momSentInMonth(MONTH).sent).toBe(150_000);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.9 8.3 exactly the reserve: it goes to $0.00 and nothing waits; one cent more and one cent waits', () => {
    const exact = book(150_000);
    exact.receive(withdrawal('w1', DAY, 150_000, TO_MOM));
    exact.sort('w1', { to: 'mom' }, DAY);
    expect(exact.pots()).toMatchObject({ momReserve: 0, unsortedOut: 0 });
    expect(exact.reviewItems()).toEqual([]);

    const over = book(150_000);
    over.receive(withdrawal('w1', DAY, 150_001, TO_MOM));
    over.sort('w1', { to: 'mom' }, DAY);
    expect(over.pots()).toMatchObject({ momReserve: 0, unsortedOut: 1 });
    expect(over.reviewItems()).toMatchObject([{ id: 'w1:difference', amount: 1 }]);
  });

  it('7.9 8.3 the reserve at zero or below: all of it waits as the difference, and the reserve stays where it was', () => {
    const b = book(-500);
    b.receive(withdrawal('w1', DAY, 1, TO_MOM));
    b.sort('w1', { to: 'mom' }, DAY);
    expect(b.pots()).toMatchObject({ momReserve: -500, unsortedOut: 1 });
    expect(b.reviewItems()).toMatchObject([{ id: 'w1:difference', amount: 1 }]);
    expect(b.momSentInMonth(MONTH).sent).toBe(1);
  });

  it('7.9 one cent comes out of the reserve, to the cent', () => {
    const b = book();
    b.receive(withdrawal('w1', DAY, 1, TO_MOM));
    b.sort('w1', { to: 'mom' }, DAY);
    expect(b.pots()).toMatchObject({ momReserve: 299_999, unsortedOut: 0 });
  });

  it('7.9 4.7 sorted to Other first and then for mom from its list: Other gets its money back and the reserve pays', () => {
    const b = book();
    b.receive(withdrawal('w1', DAY, 150_000, TO_MOM));
    b.sort('w1', { to: 'not-mine' }, DAY);
    expect(b.pots()).toMatchObject({ heldForOthers: -150_000, momReserve: 300_000 });
    expect(resortPicks(b, 'w1')).toEqual(['needs', 'wants', 'not-mine', 'mom']);
    b.sort('w1', { to: 'mom' }, DAY);
    expect(b.pots()).toMatchObject({ heldForOthers: 0, momReserve: 150_000, needs: 100_000, wants: 50_000, unsortedOut: 0 });
    expect(b.activity('heldForOthers').rows.map((r) => r.id)).not.toContain('w1');
    expect(b.activity('momReserve').rows).toMatchObject([{ id: 'w1', what: 'mom', amount: -150_000, account: 'savings', description: TO_MOM }]);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.9 4.7 sorted again later: the reserve gets its money back, the month drops, and it is what the bank sent again', () => {
    const b = book();
    b.receive(withdrawal('w1', DAY, 150_000, TO_MOM));
    b.sort('w1', { to: 'mom' }, DAY);
    const d = b.resortDetail('w1');
    expect(d).toMatchObject({ resortable: true, now: { to: 'mom' }, account: 'savings', amount: 150_000, description: TO_MOM });
    expect(resortPicks(b, 'w1')).toEqual(['needs', 'wants', 'not-mine', 'mom']);
    // The choices money leaving savings has (4.9, 7.7): Wants gets the rest of a
    // split, no rule, and no transfer from here.
    expect(d?.resortable === true && d.options.type === 'sort' ? [d.options.split, d.options.always, d.options.transfer] : null).toEqual([['needs', 'not-mine', 'wants'], [], []]);
    // Already for mom: the same again changes nothing.
    const pots = b.pots();
    b.sort('w1', { to: 'mom' }, DAY);
    expect(b.pots()).toEqual(pots);
    b.sort('w1', { to: 'needs' }, '2026-11-03');
    expect(b.pots()).toMatchObject({ momReserve: 300_000, needs: -50_000, unsortedOut: 0 });
    expect(b.momSentInMonth(MONTH).sent).toBe(0);
    expect(b.resortDetail('w1')).toMatchObject({ resortable: true, now: { to: 'needs' } });
    // It is money leaving savings again on Needs' list, not a payment to a person.
    expect(b.activity('needs').rows).toMatchObject([{ id: 'w1', what: 'purchase', account: 'savings', amount: -150_000 }]);
    b.sort('w1', { to: 'mom' }, '2026-11-03');
    expect(b.pots()).toMatchObject({ momReserve: 150_000, needs: 100_000 });
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.9 8.3 sorted again with a difference: the difference goes away wherever it went', () => {
    const b = book(100_000);
    b.receive(withdrawal('w1', DAY, 150_000, TO_MOM));
    b.sort('w1', { to: 'mom' }, DAY);
    b.sort('w1:difference', { to: 'wants' }, DAY);
    expect(b.pots()).toMatchObject({ momReserve: 0, wants: 0 });
    b.sort('w1', { to: 'not-mine' }, DAY);
    expect(b.pots()).toMatchObject({ momReserve: 100_000, wants: 50_000, heldForOthers: -150_000, unsortedOut: 0 });
    expect(b.reviewItems()).toEqual([]);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.9 4.7 a purchase on checking a rule sorted, marked for mom, then sorted again: only the bucket picked moves', () => {
    const b = openTestBook({ pots: { needs: 100_000, wants: 50_000, momReserve: 300_000 }, rules: [{ id: 'r1', for: 'purchase', contains: 'MADE UP PAYMENT', bucket: 'wants' }] });
    expect(b.receive(purchase('p1', DAY, 5_000, 'MADE UP PAYMENT', { account: 'checking' })).outcome).toBe('sorted');
    b.sort('p1', { to: 'mom' }, DAY);
    expect(b.pots()).toMatchObject({ wants: 50_000, momReserve: 295_000 });
    b.sort('p1', { to: 'needs' }, DAY);
    expect(b.pots()).toMatchObject({ needs: 95_000, wants: 50_000, momReserve: 300_000, unsortedOut: 0 });
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.9 not one partly refunded, and nothing changes', () => {
    const b = book();
    b.receive(purchase('p1', DAY, 10_000, 'MADE UP PAYMENT', { account: 'checking' }));
    b.receive(refund('r1', DAY, 1, 'p1', 'checking'));
    expect(picks(b, 'p1')).toEqual(['needs', 'wants', 'not-mine']);
    const before = b.pots();
    expect(codeOf(() => b.sort('p1', { to: 'mom' }, DAY))).toBe('bad-choice');
    expect(b.pots()).toEqual(before);
  });

  it('7.9 14.2 4.10 not the difference on one counted on setup day, or what is left of one the bank took back', () => {
    const atSetup = openTestBook({ pots: { needs: 100_000, momReserve: 300_000 }, countedAtSetup: [purchase('s1', '2026-09-30', 1_000, 'MADE UP HOLD', { account: 'checking', pending: true })] });
    atSetup.receive(posted('s2', 's1', DAY, 1_250, 'MADE UP GAS', 'checking'));
    expect(picks(atSetup, 's1')).toEqual(['needs', 'wants']);
    expect(codeOf(() => atSetup.sort('s1', { to: 'mom' }, DAY))).toBe('bad-choice');

    const back = book();
    back.receive(purchase('p1', DAY, 10_000, 'MADE UP SHOP', { account: 'checking' }));
    back.receive(refund('r1', DAY, 4_000, 'p1', 'checking'));
    back.receive(takenBack('t1', 'p1', '2026-11-03'));
    expect(picks(back, 'p1')).toEqual(['needs', 'wants']);
    expect(codeOf(() => back.sort('p1', { to: 'mom' }, DAY))).toBe('bad-choice');
  });

  it('7.9 a sorting rule cannot pick it, and sorting it by hand offers no rule (13.6, 13.8)', () => {
    const b = book();
    b.receive(purchase('p1', DAY, 5_000, TO_MOM, { account: 'checking' }));
    expect(codeOf(() => b.sortAlways('p1', { to: 'mom' }, { id: 'r', contains: 'MOM' }, DAY))).toBe('bad-choice');
    expect(b.rules()).toEqual([]);
    expect(b.pots().unsortedOut).toBe(5_000);
    b.receive(purchase('p2', '2026-11-03', 6_000, TO_MOM, { account: 'checking' }));
    b.sort('p1', { to: 'mom' }, DAY);
    b.sort('p2', { to: 'mom' }, '2026-11-03');
    expect(b.ruleOffer('p2')).toBeNull();
    const d = b.resortDetail('p2');
    expect(d?.resortable === true && d.options.type === 'sort' ? d.options.always : null).toEqual([]);
  });

  it('7.9 4.10 the bank taking it back gives the reserve its money back, and the month drops', () => {
    const b = book();
    b.receive(withdrawal('w1p', DAY, 150_000, 'MADE UP ZELLE TRANSFER', { pending: true }));
    b.receive(withdrawal('w1', DAY, 150_000, TO_MOM, { pendingId: 'w1p' }));
    b.sort('w1', { to: 'mom' }, DAY);
    b.receive(takenBack('t1', 'w1', '2026-11-03'));
    expect(b.pots()).toMatchObject({ momReserve: 300_000, unsortedOut: 0, needs: 100_000, wants: 50_000 });
    expect(b.momSentInMonth(MONTH).sent).toBe(0);
    expect(b.resortDetail('w1')).toMatchObject({ resortable: false });
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.9 4.5 a refund of one marked for mom waits in review; the reserve keeps what it paid', () => {
    const b = book();
    b.receive(purchase('p1', DAY, 10_000, 'MADE UP PAYMENT', { account: 'checking' }));
    b.sort('p1', { to: 'mom' }, DAY);
    b.receive(refund('r1', '2026-11-03', 2_000, 'p1', 'checking'));
    expect(b.pots()).toMatchObject({ momReserve: 290_000, unsortedIn: 2_000 });
    expect(b.reviewItems()).toMatchObject([{ type: 'money-in', id: 'r1' }]);
  });

  it('7.9 5.6 one marked as a payment to the old card from checking can be for mom instead: the old card owes what it did', () => {
    const b = book();
    const debt = b.oldCardDebt();
    b.receive(purchase('p1', DAY, 6_000, 'MADE UP PAYMENT', { account: 'checking' }));
    b.sort('p1', { transfer: 'old-card' }, DAY);
    expect(b.pots().needs).toBe(94_000);
    const d = b.resortDetail('p1');
    expect(d?.resortable === true && d.options.type === 'sort' ? d.options.picks.map((p) => p.to) : null).toContain('mom');
    b.sort('p1', { to: 'mom' }, DAY);
    expect(b.pots()).toMatchObject({ needs: 100_000, momReserve: 294_000, unsortedOut: 0 });
    expect(b.oldCardDebt()).toBe(debt);
    expect(b.inTransit().items).toEqual([]);
    expect(b.recountPots()).toEqual(b.pots());
  });

  it('7.9 is not spending: safe to spend and what was spent do not change', () => {
    const b = book();
    const safe = b.safeToSpend(DAY).amount;
    b.receive(withdrawal('w1', DAY, 5_000, TO_MOM));
    expect(b.safeToSpend(DAY).amount).toBe(safe - 5_000);
    b.sort('w1', { to: 'mom' }, DAY);
    expect(b.safeToSpend(DAY).amount).toBe(safe);
    expect(b.spentIn()).toEqual([]);
  });

  it('7.9 very large amounts stay exact', () => {
    const big = Number.MAX_SAFE_INTEGER - 1_000_000;
    const b = openTestBook({ pots: { momReserve: big } });
    b.receive(withdrawal('w1', DAY, big, TO_MOM));
    b.sort('w1', { to: 'mom' }, DAY);
    expect(b.pots()).toMatchObject({ momReserve: 0, unsortedOut: 0 });
    expect(b.momSentInMonth(MONTH).sent).toBe(big);
  });

  it('7.9 random amounts and reserves, either account: no cent is made or lost, the check holds, and sorting it again puts it back', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000_000 }), fc.integer({ min: -1_000_000, max: 100_000_000 }), fc.boolean(), fc.constantFrom('needs', 'wants', 'not-mine'), (amount, reserve, fromSavings, after) => {
        const b = book(reserve);
        const bank = new TestBank({ savings: 500_000 + reserve, checking: 150_000 });
        const out = fromSavings ? withdrawal('w1', DAY, amount, TO_MOM) : purchase('w1', DAY, amount, TO_MOM, { account: 'checking' });
        b.receive(out);
        bank.apply(out);
        b.sort('w1', { to: 'mom' }, DAY);
        const fromReserve = Math.min(amount, Math.max(0, reserve));
        expect(b.pots()).toMatchObject({ needs: 100_000, wants: 50_000, momReserve: reserve - fromReserve, unsortedOut: amount - fromReserve, heldForOthers: 0 });
        expect(b.momSentInMonth(MONTH).sent).toBe(amount);
        expect(check(b, bank)).toBe(true);
        expect(b.recountPots()).toEqual(b.pots());
        b.sort('w1', { to: after }, DAY);
        const pot = after === 'not-mine' ? 'heldForOthers' : after;
        const start = { needs: 100_000, wants: 50_000, heldForOthers: 0 };
        expect(b.pots()).toMatchObject({ ...start, [pot]: start[pot] - amount, momReserve: reserve, unsortedOut: 0 });
        expect(b.momSentInMonth(MONTH).sent).toBe(0);
        expect(check(b, bank)).toBe(true);
        expect(b.recountPots()).toEqual(b.pots());
      }),
    );
  });
});
