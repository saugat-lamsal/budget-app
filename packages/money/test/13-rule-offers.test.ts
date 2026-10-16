import { describe, expect, it } from 'vitest';
import { commonPlaceWords, placeName } from '../src/index.js';
import { codeOf, deposit, dropped, openTestBook, payPerson, posted, purchase, refund, takenBack, withdrawal, type TestBookOptions } from './helpers.js';

// Rule 13.8 (QUESTIONS.md A55, his OK Oct 16, 2026): the second time he sorts
// something from the same place the same way by hand, the app offers to make
// it a rule ("always do this", 13.6), with the place's name as its text. The
// name is the longest run of words in the description as it first showed up
// with no digits in them and none on most of his items of that kind on that
// account in the 90 days before. Every store, person and number is made up;
// the descriptions are shaped like a bank's (a date and card digits in them).

function book(options: TestBookOptions = {}) {
  return openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 50_000, heldForOthers: 0 }, ...options });
}

const CHECKING = { account: 'checking', pending: true } as const;

// Other purchases on checking, so a place's own words are not on most of them.
function withOtherPurchases(options: TestBookOptions = {}) {
  const b = book(options);
  b.receive(purchase('o1', '2026-10-01', 900, 'PURCHASE 10/01 CORNER BAKERY', CHECKING));
  b.receive(purchase('o2', '2026-10-01', 1_200, 'PURCHASE 10/01 CITY BOOKS', CHECKING));
  b.receive(purchase('o3', '2026-10-01', 700, 'PURCHASE 10/01 TACO TOWN', CHECKING));
  return b;
}

describe('13.8 the name of a place in a description', () => {
  it('13.8 the longest run of words with no digits in them and none of the common words', () => {
    const common = new Set(['purchase']);
    expect(placeName('PURCHASE 10/11 GREEN LEAF MARKET', common)).toBe('GREEN LEAF MARKET');
    expect(placeName('PURCHASE 10/14 10046D TACO TOWN PLAZA 7 RD', common)).toBe('TACO TOWN PLAZA');
    // A word with a digit in it breaks the run: card digits, a store number, a date.
    expect(placeName('MOBILE PURCHASE 1011 GREEN LEAF MARKET SPRINGFIELD ST XXXXX1111XXXXXXXXXX2222', common)).toBe('GREEN LEAF MARKET SPRINGFIELD ST');
    // Marks between its words stay as the bank wrote them; at its ends they are left off.
    expect(placeName('PURCHASE 10/09 PY *SUNNY - CAFE MAIN', common)).toBe('PY *SUNNY - CAFE MAIN');
    expect(placeName('BEST GLASSES # 5587', common)).toBe('BEST GLASSES');
    expect(placeName('- CORNER STORE -', common)).toBe('CORNER STORE');
    // Card descriptions are often just the name.
    expect(placeName('Corner Store', common)).toBe('Corner Store');
  });

  it('13.8 the longest run wins, the first of two as long; none when no word is left', () => {
    expect(placeName('ALPHA 12 BETA GAMMA', new Set())).toBe('BETA GAMMA');
    expect(placeName('ALPHA 12 BETA', new Set())).toBe('ALPHA');
    expect(placeName('PURCHASE 1234', new Set(['purchase']))).toBeNull();
    expect(placeName('PURCHASE MARKET', new Set(['purchase', 'market']))).toBeNull();
    expect(placeName('# - *', new Set())).toBeNull();
    expect(placeName('', new Set())).toBeNull();
  });

  it('13.8 a common word is read without case or marks', () => {
    expect(placeName('Purchase GREEN LEAF', new Set(['purchase']))).toBe('GREEN LEAF');
    expect(placeName('*PURCHASE* GREEN LEAF', new Set(['purchase']))).toBe('GREEN LEAF');
  });

  it('13.8 4.5 common words: those on more than half of the descriptions, each counted once per description; never one with a digit', () => {
    expect([...commonPlaceWords(['PURCHASE A', 'PURCHASE B', 'PURCHASE C', 'D'])]).toEqual(['purchase']);
    // Exactly half is not most.
    expect([...commonPlaceWords(['PURCHASE A', 'PURCHASE B', 'C', 'D'])]).toEqual([]);
    expect([...commonPlaceWords(['PAY PAY PAY A', 'B', 'C'])]).toEqual([]);
    expect([...commonPlaceWords(['10/01 A', '10/01 B', '10/01 C'])].sort()).toEqual([]);
    expect([...commonPlaceWords(['*Sunny Cafe', 'SUNNY bar', 'sunny- deli'])]).toEqual(['sunny']);
    expect([...commonPlaceWords([])]).toEqual([]);
  });
});

describe('13.8 a rule offered the second time a place is sorted the same way by hand', () => {
  it('13.8 the first time nothing is offered; the second time the place\'s name, for what he picked', () => {
    const b = withOtherPurchases();
    b.receive(purchase('g1', '2026-10-02', 1_500, 'PURCHASE 10/02 GREEN LEAF MARKET', CHECKING));
    b.sort('g1', { to: 'wants' }, '2026-10-02');
    expect(b.ruleOffer('g1')).toBeNull();
    b.receive(purchase('g2', '2026-10-09', 2_000, 'PURCHASE 10/09 GREEN LEAF MARKET', CHECKING));
    b.sort('g2', { to: 'wants' }, '2026-10-09');
    expect(b.ruleOffer('g2')).toEqual({ for: 'purchase', contains: 'GREEN LEAF MARKET', to: 'wants' });
    // Asking changes nothing.
    expect(b.rules()).toEqual([]);
  });

  it('13.8 sorted another way: nothing; sorted again from the list the same way: offered (4.7 is by hand too)', () => {
    const b = withOtherPurchases();
    b.receive(purchase('g1', '2026-10-02', 1_500, 'PURCHASE 10/02 GREEN LEAF MARKET', CHECKING));
    b.sort('g1', { to: 'wants' }, '2026-10-02');
    b.receive(purchase('g2', '2026-10-09', 2_000, 'PURCHASE 10/09 GREEN LEAF MARKET', CHECKING));
    b.sort('g2', { to: 'needs' }, '2026-10-09');
    expect(b.ruleOffer('g2')).toBeNull();
    b.sort('g2', { to: 'wants' }, '2026-10-10');
    expect(b.ruleOffer('g2')).toMatchObject({ contains: 'GREEN LEAF MARKET', to: 'wants' });
  });

  it('13.8 an earlier one a rule sorted does not count: only ones he sorted by hand', () => {
    const b = withOtherPurchases({ rules: [{ id: 'first-visit', for: 'purchase', contains: 'PURCHASE 10/02 GREEN', bucket: 'wants' }] });
    b.receive(purchase('g1', '2026-10-02', 1_500, 'PURCHASE 10/02 GREEN LEAF MARKET', CHECKING));
    expect(b.purchases().find((p) => p.id === 'g1')?.sortedTo).toEqual({ to: 'wants' });
    b.receive(purchase('g2', '2026-10-09', 2_000, 'PURCHASE 10/09 GREEN LEAF MARKET', CHECKING));
    b.sort('g2', { to: 'wants' }, '2026-10-09');
    expect(b.ruleOffer('g2')).toBeNull();
  });

  it('13.8 a different place, a split, one the bank dropped or took back, and money leaving savings (4.9) are never offered', () => {
    const b = withOtherPurchases();
    b.receive(purchase('g1', '2026-10-02', 1_500, 'PURCHASE 10/02 GREEN LEAF MARKET', CHECKING));
    b.sort('g1', { to: 'wants' }, '2026-10-02');
    b.receive(purchase('h1', '2026-10-03', 1_500, 'PURCHASE 10/03 HILLTOP HARDWARE', CHECKING));
    b.sort('h1', { to: 'wants' }, '2026-10-03');
    expect(b.ruleOffer('h1')).toBeNull();
    // A split is no one way; one split earlier is not the same way either.
    b.receive(purchase('g2', '2026-10-04', 2_000, 'PURCHASE 10/04 GREEN LEAF MARKET', CHECKING));
    b.sort('g2', { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wants', amount: 1_000 }] }, '2026-10-04');
    expect(b.ruleOffer('g2')).toBeNull();
    // Dropped by the bank while pending (A2): it no longer counts.
    b.receive(dropped('x1', 'g1', '2026-10-05'));
    b.receive(purchase('g3', '2026-10-06', 2_000, 'PURCHASE 10/06 GREEN LEAF MARKET', CHECKING));
    b.sort('g3', { to: 'wants' }, '2026-10-06');
    expect(b.ruleOffer('g3')).toBeNull();
    // Taken back after it posted (4.10): it no longer counts either.
    b.receive(purchase('g4', '2026-10-06', 2_000, 'GREEN LEAF MARKET ONLINE', { account: 'checking' }));
    b.sort('g4', { to: 'wants' }, '2026-10-06');
    b.receive(takenBack('t1', 'g4', '2026-10-07'));
    b.receive(purchase('g5', '2026-10-07', 2_000, 'GREEN LEAF MARKET ONLINE', { account: 'checking' }));
    b.sort('g5', { to: 'wants' }, '2026-10-07');
    expect(b.ruleOffer('g5')).toBeNull();
    // No rule can sort money leaving savings.
    b.receive(withdrawal('s1', '2026-10-06', 5_000, 'BILL PAY RIVER WATER CO'));
    b.receive(withdrawal('s2', '2026-10-07', 5_000, 'BILL PAY RIVER WATER CO'));
    b.receive(withdrawal('s3', '2026-10-07', 5_000, 'BILL PAY CITY GAS'));
    b.receive(withdrawal('s4', '2026-10-07', 5_000, 'BILL PAY TOWN TRASH'));
    b.sort('s1', { to: 'needs' }, '2026-10-07');
    b.sort('s2', { to: 'needs' }, '2026-10-07');
    expect(b.ruleOffer('s2')).toBeNull();
    // Something that is not there.
    expect(codeOf(() => b.ruleOffer('nothing-like-it'))).toBe('unknown-item');
  });

  it('13.8 the name is from the description as it first showed up; an earlier one counts by how it showed up or how it posted', () => {
    const b = withOtherPurchases();
    b.receive(purchase('g1', '2026-10-02', 1_500, 'PURCHASE 10/02 GREEN LEAF MARKET', CHECKING));
    b.sort('g1', { to: 'wants' }, '2026-10-02');
    b.receive(posted('g1-posted', 'g1', '2026-10-03', 1_500, 'MOBILE PURCHASE 1002 GREEN LEAF MARKET SPRINGFIELD ST XXXXX1111XXXXXXXXXX2222', 'checking'));
    // This one shows up already posted, in the bank's longer words.
    b.receive(purchase('g2', '2026-10-09', 2_000, 'MOBILE PURCHASE 1009 GREEN LEAF MARKET SPRINGFIELD ST XXXXX1111XXXXXXXXXX3333', { account: 'checking' }));
    b.sort('g2', { to: 'wants' }, '2026-10-09');
    expect(b.ruleOffer('g2')).toEqual({ for: 'purchase', contains: 'GREEN LEAF MARKET SPRINGFIELD ST', to: 'wants' });
    // The posted one is still the same entry, sorted by hand.
    b.receive(purchase('g3', '2026-10-10', 2_000, 'PURCHASE 10/10 GREEN LEAF MARKET', CHECKING));
    b.sort('g3', { to: 'wants' }, '2026-10-10');
    expect(b.ruleOffer('g3')).toEqual({ for: 'purchase', contains: 'GREEN LEAF MARKET', to: 'wants' });
  });

  it('13.8 4.5 a word on most of his purchases on that account is not part of the name', () => {
    const b = book();
    for (const [id, name] of [['o1', 'CORNER BAKERY'], ['o2', 'CITY BOOKS'], ['o3', 'TACO TOWN']] as const) {
      b.receive(purchase(id, '2026-10-01', 900, `PURCHASE 10/01 ${name} SPRINGFIELD ST`, CHECKING));
    }
    b.receive(purchase('g1', '2026-10-02', 1_500, 'PURCHASE 10/02 GREEN LEAF MARKET SPRINGFIELD ST', CHECKING));
    b.sort('g1', { to: 'needs' }, '2026-10-02');
    b.receive(purchase('g2', '2026-10-09', 2_000, 'PURCHASE 10/09 GREEN LEAF MARKET SPRINGFIELD ST', CHECKING));
    b.sort('g2', { to: 'needs' }, '2026-10-09');
    expect(b.ruleOffer('g2')).toMatchObject({ contains: 'GREEN LEAF MARKET' });
    // Only purchases on that account count: the same words on the card change nothing.
    const card = book();
    card.receive(purchase('c1', '2026-10-01', 900, 'GREEN LEAF MARKET'));
    card.receive(purchase('c2', '2026-10-01', 900, 'HILLTOP HARDWARE'));
    card.receive(purchase('c3', '2026-10-01', 900, 'RIVER CINEMA'));
    card.sort('c1', { to: 'wants' }, '2026-10-01');
    card.receive(purchase('c4', '2026-10-02', 900, 'GREEN LEAF MARKET'));
    card.sort('c4', { to: 'wants' }, '2026-10-02');
    expect(card.ruleOffer('c4')).toEqual({ for: 'purchase', contains: 'GREEN LEAF MARKET', to: 'wants' });
  });

  it('13.8 4.5 only his items on that day and in the 90 days before count for the common words', () => {
    const b = book();
    for (const [id, name] of [['o1', 'CORNER BAKERY'], ['o2', 'CITY BOOKS'], ['o3', 'TACO TOWN'], ['o4', 'RIVER CINEMA']] as const) {
      b.receive(purchase(id, '2026-10-01', 900, `${name} SPRINGFIELD`));
    }
    b.receive(purchase('c1', '2027-01-15', 900, 'HILLTOP HARDWARE'));
    b.receive(purchase('c2', '2027-01-15', 900, 'MOON DINER'));
    b.receive(purchase('g1', '2027-01-15', 900, 'GREEN LEAF SPRINGFIELD'));
    b.sort('g1', { to: 'wants' }, '2027-01-15');
    b.receive(purchase('g2', '2027-01-16', 900, 'GREEN LEAF SPRINGFIELD'));
    b.sort('g2', { to: 'wants' }, '2027-01-16');
    // Oct 1 is 107 days before Jan 16: those four are not counted, so the
    // city is on half of the ones that are (c1, c2, g1, g2), not most.
    expect(b.ruleOffer('g2')).toMatchObject({ contains: 'GREEN LEAF SPRINGFIELD' });
  });

  it('13.8 one a rule sorted after he had split it is not one he sorted', () => {
    const b = withOtherPurchases();
    b.receive(purchase('g1', '2026-10-02', 2_000, 'GREEN LEAF MARKET ONLINE', { account: 'checking' }));
    b.sort('g1', { split: [{ bucket: 'needs', amount: 1_000 }, { bucket: 'wants', amount: 1_000 }] }, '2026-10-02');
    // Partly refunded, it goes back to review to be split again (4.5); a new rule then sorts it (13.2).
    b.receive(refund('r1', '2026-10-03', 500, 'g1', 'checking'));
    expect(b.reviewItems().map((i) => i.id)).toContain('g1');
    b.addRule({ id: 'leaf', for: 'purchase', contains: 'GREEN LEAF MARKET ONLINE', bucket: 'wants' }, '2026-10-04');
    expect(b.purchases().find((p) => p.id === 'g1')?.sortedTo).toEqual({ to: 'wants' });
    b.removeRule('leaf', '2026-10-05');
    b.receive(purchase('g2', '2026-10-06', 2_000, 'GREEN LEAF MARKET ONLINE', { account: 'checking' }));
    b.sort('g2', { to: 'wants' }, '2026-10-06');
    expect(b.ruleOffer('g2')).toBeNull();
  });

  it('13.8 an earlier one of another kind does not count, even with the same name', () => {
    const b = withOtherPurchases();
    b.receive(deposit('d1', '2026-10-02', 3_000, 'SIDE GIG LLC'));
    b.receive(deposit('d2', '2026-10-02', 1_000, 'GARAGE SALE CASH'));
    b.receive(deposit('d3', '2026-10-02', 1_000, 'STATE TAX REFUND'));
    b.sort('d1', { to: 'wants' }, '2026-10-02');
    b.receive(purchase('s1', '2026-10-03', 900, 'SIDE GIG LLC', { account: 'checking' }));
    b.sort('s1', { to: 'wants' }, '2026-10-03');
    expect(b.ruleOffer('s1')).toBeNull();
  });

  it('13.8 with too few other items of that kind, the place\'s own words are on most of them: no name, nothing offered', () => {
    const b = book();
    b.receive(purchase('g1', '2026-10-02', 1_500, 'GREEN LEAF MARKET'));
    b.sort('g1', { to: 'wants' }, '2026-10-02');
    b.receive(purchase('g2', '2026-10-03', 1_500, 'GREEN LEAF MARKET'));
    b.sort('g2', { to: 'wants' }, '2026-10-03');
    expect(b.ruleOffer('g2')).toBeNull();
  });

  it('13.8 7.6 a payment to a person, to not mine; for mom, none: once counted for mom it takes no rule (as on its list)', () => {
    const b = book();
    b.receive(payPerson('p1', '2026-10-02', 2_000, 'PAT FRIEND'));
    b.receive(payPerson('p2', '2026-10-03', 2_500, 'PAT FRIEND'));
    b.receive(payPerson('p3', '2026-10-03', 1_000, 'LEE COACH'));
    b.receive(payPerson('p4', '2026-10-03', 1_000, 'KIM NEIGHBOR'));
    b.receive(payPerson('p5', '2026-10-03', 1_000, 'LEE COACH'));
    b.sort('p1', { to: 'not-mine' }, '2026-10-03');
    b.sort('p2', { to: 'not-mine' }, '2026-10-03');
    expect(b.ruleOffer('p2')).toEqual({ for: 'person', contains: 'PAT FRIEND', to: 'not-mine' });
    b.sort('p3', { to: 'mom' }, '2026-10-03');
    b.sort('p5', { to: 'mom' }, '2026-10-03');
    expect(b.ruleOffer('p5')).toBeNull();
    const counted = b.resortDetail('p5');
    expect(counted?.resortable === true ? counted.options.always : null).toEqual([]);
  });

  it('13.8 6.2 money in, paid back into a bucket', () => {
    const b = book();
    b.receive(deposit('d1', '2026-10-02', 3_000, 'SIDE GIG LLC'));
    b.receive(deposit('d2', '2026-10-09', 3_000, 'SIDE GIG LLC'));
    b.receive(deposit('d3', '2026-10-09', 1_000, 'GARAGE SALE CASH'));
    b.receive(deposit('d4', '2026-10-09', 1_000, 'STATE TAX REFUND'));
    b.sort('d1', { to: 'savings' }, '2026-10-09');
    b.sort('d2', { to: 'savings' }, '2026-10-09');
    expect(b.ruleOffer('d2')).toEqual({ for: 'deposit', contains: 'SIDE GIG LLC', to: 'savings' });
  });

  it('13.8 13.6 the rule made from the offer sorts the next one by itself', () => {
    const b = withOtherPurchases();
    b.receive(purchase('g1', '2026-10-02', 1_500, 'PURCHASE 10/02 GREEN LEAF MARKET', CHECKING));
    b.sort('g1', { to: 'wants' }, '2026-10-02');
    b.receive(purchase('g2', '2026-10-09', 2_000, 'PURCHASE 10/09 GREEN LEAF MARKET', CHECKING));
    b.sort('g2', { to: 'wants' }, '2026-10-09');
    const offer = b.ruleOffer('g2');
    if (offer === null) throw new Error('no offer');
    const wantsBefore = b.pots().wants;
    expect(b.sortAlways('g2', { to: offer.to }, { id: 'from-offer', contains: offer.contains }, '2026-10-09')).toEqual({ sticks: true, stillWaiting: [] });
    // Sorting it where it already was changes no bucket.
    expect(b.pots().wants).toBe(wantsBefore);
    b.receive(purchase('g3', '2026-10-16', 2_500, 'PURCHASE 10/16 GREEN LEAF MARKET', CHECKING));
    expect(b.purchases().find((p) => p.id === 'g3')?.sortedTo).toEqual({ to: 'wants' });
    expect(b.reviewItems().map((i) => i.id)).not.toContain('g3');
  });
});

describe('13.8 13.6 "always do this" starts from the place\'s name', () => {
  it('13.8 waiting in review and on a bucket\'s list, the rule text is the name, or the whole description when it has none', () => {
    const b = withOtherPurchases();
    b.receive(purchase('g1', '2026-10-02', 1_500, 'PURCHASE 10/02 GREEN LEAF MARKET', CHECKING));
    b.receive(purchase('n1', '2026-10-02', 1_500, 'PURCHASE 10/02 4455', CHECKING));
    expect(b.ruleText('g1')).toBe('GREEN LEAF MARKET');
    expect(b.ruleText('n1')).toBe('PURCHASE 10/02 4455');
    // Sorted, and posted in the bank's longer words: still the name as it first showed up.
    b.sort('g1', { to: 'wants' }, '2026-10-02');
    b.receive(posted('g1-posted', 'g1', '2026-10-03', 1_500, 'MOBILE PURCHASE 1002 GREEN LEAF MARKET SPRINGFIELD ST XXXXX1111XXXXXXXXXX2222', 'checking'));
    expect(b.ruleText('g1')).toBe('GREEN LEAF MARKET');
    // Money in, and a payment to a person.
    b.receive(deposit('d1', '2026-10-04', 3_000, 'SIDE GIG LLC 0042'));
    // The only deposit: its own words are on most of them, so no name.
    expect(b.ruleText('d1')).toBe('SIDE GIG LLC 0042');
    b.receive(deposit('d2', '2026-10-04', 1_000, 'GARAGE SALE CASH'));
    b.receive(deposit('d3', '2026-10-04', 1_000, 'STATE TAX REFUND'));
    expect(b.ruleText('d1')).toBe('SIDE GIG LLC');
    b.receive(payPerson('p1', '2026-10-04', 2_000, 'PAT FRIEND'));
    b.receive(payPerson('p2', '2026-10-04', 2_000, 'LEE COACH'));
    b.receive(payPerson('p3', '2026-10-04', 2_000, 'KIM NEIGHBOR'));
    expect(b.ruleText('p1')).toBe('PAT FRIEND');
    expect(codeOf(() => b.ruleText('nothing-like-it'))).toBe('unknown-item');
  });

  it('13.8 A20 one he marked a payment to the old card starts from the purchase it was', () => {
    const b = withOtherPurchases();
    b.receive(purchase('m1', '2026-10-02', 5_000, 'PURCHASE 10/02 HILLTOP HARDWARE', { account: 'checking' }));
    b.sort('m1', { transfer: 'old-card' }, '2026-10-02');
    expect(b.ruleText('m1')).toBe('HILLTOP HARDWARE');
  });
});
