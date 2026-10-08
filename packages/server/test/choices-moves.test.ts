import type { Book } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { START_DATE, openTestBook, purchase } from '../../money/test/helpers.js';
import { ChoiceDesk, parseChoiceRequest, parseMoveRequest, parseRequest } from '../src/choices.js';
import type { MoveRequest, MoveResponse } from '../src/views/choice.js';

// Moving money between buckets by hand (rules 13.3, 13.4, 13.5; QUESTIONS.md
// B103). The tap reaches the books the same way a tap in Review does: the
// money math decides, a repeat changes nothing, a refusal changes nothing and
// says why. The only things that ask first are the ones the rulebook says
// ask: money out of savings or the mom reserve, and a move that would leave
// the bucket it comes out of below zero.

const TODAY = '2026-10-20';

function setup(): { book: Book; desk: ChoiceDesk } {
  const book = openTestBook({ pots: { savings: 100_000, needs: 50_000, wants: 30_000, momReserve: 150_000, heldForOthers: 2_000 } });
  return { book, desk: new ChoiceDesk(book, () => TODAY) };
}

let counter = 0;
function move(from: MoveRequest['move']['from'], to: MoveRequest['move']['to'], amount: number, over: Partial<MoveRequest> = {}): MoveRequest {
  counter += 1;
  return { id: `move-${String(counter).padStart(8, '0')}`, move: { from, to, amount }, ...over };
}

function snapshot(b: Book): string {
  return JSON.stringify({ pots: b.pots(), review: b.reviewItems(), log: b.changeLog(), purchases: b.purchases(), rules: b.rules(), period: b.period(), transit: b.inTransit() });
}

function moved(response: MoveResponse) {
  if (!response.ok) throw new Error(`refused: ${response.code}: ${response.why}`);
  return response;
}

function refused(response: MoveResponse) {
  if (response.ok) throw new Error('expected a refusal');
  return response;
}

describe('13.3 a hand move is what the book does', () => {
  it('13.3 wants to needs: it moves, with no question asked', () => {
    const a = setup();
    const b = setup();
    const r = moved(a.desk.move(move('wants', 'needs', 5_000)));
    b.book.moveMoney({ from: 'wants', to: 'needs', amount: 5_000 }, TODAY);
    expect(snapshot(a.book)).toBe(snapshot(b.book));
    expect(a.book.pots()).toMatchObject({ needs: 55_000, wants: 25_000 });
    expect(r).toEqual({ ok: true, replayed: false, moved: { from: 'wants', to: 'needs', amount: 5_000 } });
  });

  it('13.5 it is logged with the day it was made', () => {
    const { book, desk } = setup();
    moved(desk.move(move('needs', 'wants', 1_234)));
    expect(book.changeLog()).toEqual([{ date: TODAY, kind: 'money-moved', from: 'needs', to: 'wants', amount: 1_234 }]);
  });

  it('13.3 every bucket can be moved between, held for others included', () => {
    const { book, desk } = setup();
    moved(desk.move(move('heldForOthers', 'needs', 2_000)));
    moved(desk.move(move('needs', 'savings', 1)));
    moved(desk.move(move('needs', 'momReserve', 1)));
    expect(book.pots()).toMatchObject({ heldForOthers: 0, needs: 51_998, savings: 100_001, momReserve: 150_001 });
  });

  it('13.3 the lists show a move in both buckets, as they should', () => {
    const { book, desk } = setup();
    moved(desk.move(move('wants', 'needs', 5_000)));
    expect(book.activity('needs').rows).toMatchObject([{ what: 'move', amount: 5_000, other: 'wants' }]);
    expect(book.activity('wants').rows).toMatchObject([{ what: 'move', amount: -5_000, other: 'needs' }]);
  });

  it('13.3 one cent, and everything a bucket holds', () => {
    const { book, desk } = setup();
    moved(desk.move(move('wants', 'needs', 1)));
    moved(desk.move(move('wants', 'needs', 29_999)));
    expect(book.pots()).toMatchObject({ wants: 0, needs: 80_000 });
  });
});

describe('13.4 B103 the moves that ask first, ask first', () => {
  it('13.4 out of savings: it asks, with the reason, and nothing moves', () => {
    const { book, desk } = setup();
    const before = snapshot(book);
    const request = move('savings', 'needs', 7_500);
    const r = refused(desk.move(request));
    expect(r.code).toBe('needs-confirmation');
    expect(r.reasons).toEqual(['out-of-savings']);
    expect(r.why).toBe('Moving $75.00 out of Savings needs your OK first: it takes money out of Savings. Nothing was changed.');
    expect(snapshot(book)).toBe(before);
    // With his yes, the same decision goes through.
    moved(desk.move({ ...request, confirmed: true }));
    expect(book.pots()).toMatchObject({ savings: 92_500, needs: 57_500 });
  });

  it('13.4 out of the mom reserve asks too', () => {
    const { book, desk } = setup();
    const r = refused(desk.move(move('momReserve', 'wants', 10_000)));
    expect(r.reasons).toEqual(['out-of-mom-reserve']);
    expect(r.why).toContain('Mom reserve');
    expect(book.pots().momReserve).toBe(150_000);
  });

  it('13.4 a move that would leave the bucket below zero asks, saying that is usually a typo', () => {
    const { book, desk } = setup();
    const r = refused(desk.move(move('wants', 'needs', 30_001)));
    expect(r.reasons).toEqual(['below-zero']);
    expect(r.why).toBe('Moving $300.01 out of Wants needs your OK first: it would leave Wants below zero, which is usually a typo. Nothing was changed.');
    expect(book.pots().wants).toBe(30_000);
  });

  it('13.4 both reasons are given when both apply, and a move that leaves exactly zero asks nothing', () => {
    const { book, desk } = setup();
    const r = refused(desk.move(move('savings', 'needs', 100_001)));
    expect(r.reasons).toEqual(['out-of-savings', 'below-zero']);
    expect(r.why).toContain('takes money out of Savings and would leave Savings below zero');
    moved(desk.move(move('wants', 'needs', 30_000)));
    expect(book.pots().wants).toBe(0);
  });

  it('13.4 B51 a bucket already below zero asks again before more comes out of it, and moving into it asks nothing', () => {
    const book = openTestBook({ pots: { wants: -500, needs: 10_000 } });
    const desk = new ChoiceDesk(book, () => TODAY);
    expect(refused(desk.move(move('wants', 'needs', 1))).reasons).toEqual(['below-zero']);
    moved(desk.move(move('needs', 'wants', 1)));
    expect(book.pots().wants).toBe(-499);
  });

  it('13.4 moving into savings, or between needs and wants, asks nothing', () => {
    const { book, desk } = setup();
    moved(desk.move(move('needs', 'savings', 100)));
    moved(desk.move(move('wants', 'needs', 100)));
    expect(book.changeLog()).toHaveLength(2);
  });

  it('13.4 a yes where none was needed is just a move', () => {
    const { book, desk } = setup();
    moved(desk.move(move('wants', 'needs', 100, { confirmed: true })));
    expect(book.pots().needs).toBe(50_100);
  });

  it('13.4 asking first is not remembered: the same decision number goes through once he says yes', () => {
    const { book, desk } = setup();
    const request = move('savings', 'needs', 7_500);
    expect(refused(desk.move(request)).code).toBe('needs-confirmation');
    expect(refused(desk.move({ ...request, confirmed: false })).code).toBe('needs-confirmation');
    moved(desk.move({ ...request, confirmed: true }));
    expect(book.changeLog()).toHaveLength(1);
  });
});

describe('B103 sending the same move twice changes nothing the second time', () => {
  it('a retry with the same decision number gets the same answer and moves once', () => {
    const { book, desk } = setup();
    const request = move('wants', 'needs', 5_000);
    const first = moved(desk.move(request));
    const after = snapshot(book);
    const second = moved(desk.move(request));
    expect(second.replayed).toBe(true);
    expect(second.moved).toEqual(first.moved);
    expect(snapshot(book)).toBe(after);
    expect(book.pots().needs).toBe(55_000);
    expect(book.changeLog()).toHaveLength(1);
  });

  it('a retry is the same however the request was written down', () => {
    const { book, desk } = setup();
    moved(desk.move({ id: 'same-decision', move: { from: 'wants', to: 'needs', amount: 5_000 } }));
    const after = snapshot(book);
    expect(moved(desk.move({ move: { amount: 5_000, to: 'needs', from: 'wants' }, id: 'same-decision' })).replayed).toBe(true);
    expect(snapshot(book)).toBe(after);
  });

  it('the same decision number for a different move is refused, and changes nothing', () => {
    const { book, desk } = setup();
    moved(desk.move({ id: 'decision-one', move: { from: 'wants', to: 'needs', amount: 5_000 } }));
    const after = snapshot(book);
    expect(refused(desk.move({ id: 'decision-one', move: { from: 'wants', to: 'needs', amount: 5_001 } })).code).toBe('id-reused');
    expect(refused(desk.move({ id: 'decision-one', move: { from: 'needs', to: 'wants', amount: 5_000 } })).code).toBe('id-reused');
    expect(snapshot(book)).toBe(after);
  });

  it('a decision number used for a choice in Review cannot be used for a move', () => {
    const { book, desk } = setup();
    book.receive(purchase('p1', START_DATE, 1_150, 'CORNER STORE'));
    desk.decide({ id: 'shared-decision', item: 'p1', choice: { to: 'wants' } });
    const after = snapshot(book);
    expect(refused(desk.move({ id: 'shared-decision', move: { from: 'wants', to: 'needs', amount: 100 } })).code).toBe('id-reused');
    expect(snapshot(book)).toBe(after);
  });

  it('two moves with two decision numbers are two moves: moving the same amount twice is something he can mean', () => {
    const { book, desk } = setup();
    moved(desk.move(move('wants', 'needs', 5_000)));
    moved(desk.move(move('wants', 'needs', 5_000)));
    expect(book.pots()).toMatchObject({ wants: 20_000, needs: 60_000 });
  });
});

describe('B103 a refused move changes nothing and says why', () => {
  it('13.3 the same bucket twice is refused in words', () => {
    const { book, desk } = setup();
    const before = snapshot(book);
    const r = refused(desk.move(move('needs', 'needs', 100)));
    expect(r.code).toBe('refused');
    expect(r.why).toBe('Pick two different buckets to move money between. Nothing was changed.');
    expect(snapshot(book)).toBe(before);
  });

  it('0.1 a move that would make a total too large to keep exact is refused', () => {
    const MAX = Number.MAX_SAFE_INTEGER;
    // Wants is nearly as far below zero as a total can be exact; taking 200 more out of it is too much.
    const book = openTestBook({ pots: { wants: -(MAX - 100) } });
    const desk = new ChoiceDesk(book, () => TODAY);
    const before = snapshot(book);
    const r = refused(desk.move(move('wants', 'needs', 200, { confirmed: true })));
    expect(r.why).toBe('That would make a total too large to keep exact. Nothing was changed.');
    expect(snapshot(book)).toBe(before);
  });

  it('13.5 a refused move is not in the log', () => {
    const { book, desk } = setup();
    refused(desk.move(move('savings', 'needs', 100)));
    refused(desk.move(move('needs', 'needs', 100)));
    expect(book.changeLog()).toEqual([]);
  });
});

describe('what the phone sends: a move', () => {
  const good = { id: 'abcdefgh12345678', move: { from: 'wants', to: 'needs', amount: 5_000 } };

  it('a move is exactly an id, the buckets, and a whole number of cents more than zero', () => {
    expect(parseMoveRequest(good)).toEqual(good);
    expect(parseMoveRequest({ ...good, confirmed: true })).toEqual({ ...good, confirmed: true });
    expect(parseMoveRequest({ ...good, confirmed: false })).toEqual({ ...good, confirmed: false });
    expect(parseRequest(good)).toEqual(good);
  });

  it('anything else is not a request: nothing is guessed or repaired', () => {
    const bad = [
      null,
      'move',
      [],
      { ...good, id: 'short' },
      { ...good, id: 'has spaces in it' },
      { move: good.move },
      { id: good.id },
      { ...good, extra: 1 },
      { ...good, confirmed: 'yes' },
      { ...good, move: { ...good.move, amount: 0 } },
      { ...good, move: { ...good.move, amount: -5 } },
      { ...good, move: { ...good.move, amount: 1.5 } },
      { ...good, move: { ...good.move, amount: '5000' } },
      { ...good, move: { ...good.move, amount: Number.MAX_SAFE_INTEGER + 1 } },
      { ...good, move: { ...good.move, amount: Infinity } },
      { ...good, move: { ...good.move, amount: NaN } },
      { ...good, move: { ...good.move, from: 'unsortedIn' } },
      { ...good, move: { ...good.move, to: 'checking' } },
      { ...good, move: { ...good.move, from: undefined } },
      { ...good, move: { from: 'wants', to: 'needs' } },
      { ...good, move: { ...good.move, extra: true } },
      { ...good, move: ['wants', 'needs', 5_000] },
      { ...good, item: 'p1', choice: { to: 'wants' } },
    ];
    for (const value of bad) {
      expect(parseMoveRequest(value), JSON.stringify(value)).toBeNull();
      expect(parseRequest(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('a choice for an item is still read as before, and a request is one kind or the other', () => {
    const item = { id: 'abcdefgh12345678', item: 'p1', choice: { to: 'wants' } };
    expect(parseRequest(item)).toEqual(item);
    expect(parseChoiceRequest(item)).toEqual(item);
    expect(parseChoiceRequest(good)).toBeNull();
    expect(parseMoveRequest(item)).toBeNull();
  });

  it('every bucket the money math moves between can be named, and no other', () => {
    for (const pot of ['savings', 'needs', 'wants', 'momReserve', 'heldForOthers']) {
      expect(parseMoveRequest({ ...good, move: { from: pot, to: 'needs', amount: 1 } })).not.toBeNull();
      expect(parseMoveRequest({ ...good, move: { from: 'needs', to: pot, amount: 1 } })).not.toBeNull();
    }
    for (const pot of ['unsortedIn', 'unsortedOut', 'oldCardDebt', 'inTransit', 'bucket', '']) {
      expect(parseMoveRequest({ ...good, move: { from: pot, to: 'needs', amount: 1 } }), pot).toBeNull();
    }
  });
});
