// Every example in worked-examples.txt is also a test. The expected numbers
// come from the "Check:" line in the text file itself, so the file you
// check by hand and the test can never drift apart.
import { describe, expect, it } from 'vitest';
import { parseDollars, type Book, type Cents } from '../src/index.js';
import text from '../worked-examples.txt?raw';
import { cardCharge, openTestBook, paycheck, posted, purchase, refund } from './helpers.js';

interface Example {
  number: number;
  title: string;
  checks: Map<string, Cents>;
}

function readExamples(): Example[] {
  const blocks = text.split(/^EXAMPLE /m).slice(1);
  return blocks.map((block) => {
    const header = /^(\d+)\.\s+(.*)$/m.exec(block);
    const checkLines = [...block.matchAll(/^Check: (.*)$/gm)].map((m) => m[1] ?? '');
    if (!header || checkLines.length === 0) throw new Error(`example is missing its number or Check line:\n${block.slice(0, 200)}`);
    const checks = new Map<string, Cents>();
    for (const part of checkLines.join(' | ').split('|')) {
      const m = /^\s*([a-z][a-z ]*?)\s+(-?[\d,]+\.\d{2})\s*$/.exec(part);
      if (!m) throw new Error(`cannot read "${part}" in example ${header[1]}`);
      checks.set(m[1] ?? '', parseDollars(m[2] ?? ''));
    }
    return { number: Number(header[1]), title: header[2] ?? '', checks };
  });
}

function buckets(book: Book): Record<string, Cents> {
  const p = book.pots();
  return {
    savings: p.savings,
    needs: p.needs,
    wants: p.wants,
    'mom reserve': p.momReserve,
    'held for others': p.heldForOthers,
    'unsorted money in': p.unsortedIn,
    'unsorted spending': p.unsortedOut,
  };
}

// Each example, set up in code exactly as the text describes it.
const examples: Record<number, () => Record<string, Cents>> = {
  1: () => {
    const book = openTestBook();
    book.receive(paycheck('pay', '2026-10-09', parseDollars('2,345.67')));
    return buckets(book);
  },
  2: () => {
    const book = openTestBook({ pots: { momReserve: parseDollars('2,600.00') } });
    book.receive(paycheck('pay', '2026-10-09', parseDollars('3,000.00')));
    return buckets(book);
  },
  3: () => {
    const book = openTestBook({ pots: { momReserve: parseDollars('2,000.00') } });
    book.receive(paycheck('pay', '2026-10-09', parseDollars('1,200.00')));
    return buckets(book);
  },
  4: () => {
    const book = openTestBook({
      pots: { needs: parseDollars('85.20'), wants: parseDollars('-12.50'), momReserve: parseDollars('3,000.00') },
    });
    book.receive(paycheck('pay', '2026-10-09', parseDollars('2,800.00')));
    book.answerLeftover('leftover:pay:needs', 'move-to-savings', '2026-10-09');
    return { ...buckets(book), 'still to move': book.savingsTransfer(parseDollars('3,000.00')).stillToMove };
  },
  5: () => {
    const book = openTestBook({
      pots: { needs: parseDollars('750.00'), wants: parseDollars('500.00') },
      rules: [
        { id: 'grocer', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
        { id: 'cafe', for: 'purchase', contains: 'CAFE', bucket: 'wants' },
      ],
    });
    book.receive(purchase('dinner', '2026-10-05', parseDollars('40.00'), 'MADE UP CAFE', { pending: true }));
    book.receive(posted('dinner-posted', 'dinner', '2026-10-07', parseDollars('48.00'), 'MADE UP CAFE'));
    book.receive(purchase('hardware', '2026-10-06', parseDollars('120.00'), 'MADE UP HARDWARE'));
    book.sort('hardware', { split: [{ bucket: 'needs', amount: parseDollars('100.00') }, { bucket: 'wants', amount: parseDollars('20.00') }] }, '2026-10-06');
    book.receive(purchase('lunch', '2026-10-08', parseDollars('35.00'), 'MADE UP CAFE'));
    book.receive(refund('lunch-refund', '2026-10-09', parseDollars('35.00'), 'lunch'));
    book.receive(cardCharge('fee', '2026-10-10', parseDollars('29.00'), 'fee'));
    book.sort('fee', { to: 'needs' }, '2026-10-10');
    return buckets(book);
  },
};

describe('worked examples (worked-examples.txt)', () => {
  const all = readExamples();

  it('every example in the file has a test, and every test has an example', () => {
    expect(all.map((e) => e.number)).toEqual(Object.keys(examples).map(Number));
  });

  for (const example of all) {
    it(`Example ${example.number}: ${example.title}`, () => {
      const run = examples[example.number];
      expect(run, `no test for example ${example.number}`).toBeDefined();
      const actual = run?.() ?? {};
      for (const [name, expected] of example.checks) {
        expect(actual[name], `"${name}" in example ${example.number}`).toBe(expected);
      }
    });
  }
});
