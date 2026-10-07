// Every example in worked-examples.txt is also a test. The expected numbers
// come from the "Check:" line in the text file itself, so the file you
// check by hand and the test can never drift apart.
import { describe, expect, it } from 'vitest';
import { parseDollars, payoffCountdown, startTracking, withPendingCharges, type Book, type Cents } from '../src/index.js';
import text from '../worked-examples.txt?raw';
import { MOM_NAME, TEST_SETTINGS, appSide, arrived, cardCharge, deposit, dropped, openTestBook, payPerson, paycheck, posted, purchase, refund, sent, transfer } from './helpers.js';

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
  6: () => {
    const book = openTestBook({
      pots: { savings: parseDollars('1,000.00'), needs: parseDollars('900.00'), momReserve: parseDollars('500.00') },
      oldCardDebt: parseDollars('3,000.00'),
    });
    book.receive(transfer('pay-card', '2026-10-05', parseDollars('450.00'), 'checking', 'everyday-card'));
    book.receive(transfer('to-savings', '2026-10-05', parseDollars('600.00'), 'checking', 'savings'));
    book.receive(transfer('pay-old', '2026-10-06', parseDollars('200.00'), 'checking', 'old-card'));
    book.receive(cardCharge('interest', '2026-10-07', parseDollars('35.50'), 'interest', 'old-card'));
    book.receive(purchase('subscription', '2026-10-08', parseDollars('12.99'), 'MADE UP STREAMING', { account: 'old-card' }));
    return {
      ...buckets(book),
      'old card debt': book.oldCardDebt(),
      'still to move': book.savingsTransfer(parseDollars('900.00') + parseDollars('600.00')).stillToMove,
    };
  },
  7: () => {
    const book = openTestBook({ pots: { momReserve: parseDollars('2,800.00') } });
    book.receive(deposit('tax', '2026-10-05', parseDollars('2,000.01'), 'MADE UP TAX REFUND'));
    book.sort('tax', { to: 'other-income' }, '2026-10-05');
    book.receive(deposit('friend', '2026-10-06', parseDollars('25.00'), 'MADE UP FRIEND'));
    book.sort('friend', { to: 'wants' }, '2026-10-06');
    book.receive(deposit('roommate', '2026-10-07', parseDollars('60.00'), 'MADE UP ROOMMATE'));
    book.sort('roommate', { to: 'not-mine' }, '2026-10-07');
    return buckets(book);
  },
  8: () => {
    const book = openTestBook({ pots: { wants: parseDollars('200.00') } });
    book.receive(deposit('roommate', '2026-10-05', parseDollars('90.00'), 'MADE UP ROOMMATE'));
    book.sort('roommate', { to: 'not-mine' }, '2026-10-05');
    book.receive(payPerson('landlord', '2026-10-06', parseDollars('90.00'), 'MADE UP LANDLORD'));
    book.sort('landlord', { to: 'not-mine' }, '2026-10-06');
    book.receive(payPerson('ticket', '2026-10-07', parseDollars('45.00'), 'MADE UP TICKETS'));
    book.sort('ticket', { to: 'wants' }, '2026-10-07');
    book.receive(deposit('payback', '2026-10-08', parseDollars('45.00'), 'MADE UP FRIEND'));
    book.sort('payback', { to: 'wants' }, '2026-10-08');
    book.receive(payPerson('package', '2026-10-09', parseDollars('30.00'), 'MADE UP COURIER'));
    book.sort('package', { to: 'not-mine' }, '2026-10-09');
    return buckets(book);
  },
  9: () => {
    const book = openTestBook({
      pots: { momReserve: parseDollars('1,500.00'), needs: parseDollars('600.00') },
      settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } },
    });
    book.receive(payPerson('mom1', '2026-10-03', parseDollars('1,000.00'), MOM_NAME));
    book.receive(paycheck('pay', '2026-10-09', parseDollars('4,000.00')));
    book.receive(payPerson('mom2', '2026-10-20', parseDollars('2,500.00'), MOM_NAME));
    book.sort('mom2:difference', { to: 'needs' }, '2026-10-20');
    return { ...buckets(book), 'sent this month': book.momSentInMonth('2026-10').sent };
  },
  10: () => {
    const book = openTestBook({
      lastPaycheckDate: '2026-10-09',
      pots: {
        savings: parseDollars('2,000.00'),
        needs: parseDollars('500.00'),
        wants: parseDollars('300.00'),
        momReserve: parseDollars('1,500.00'),
        heldForOthers: parseDollars('60.00'),
      },
    });
    book.receive(purchase('hardware', '2026-10-12', parseDollars('45.00'), 'MADE UP HARDWARE'));
    book.receive(deposit('gift', '2026-10-13', parseDollars('200.00'), 'MADE UP GIFT'));
    const safe = book.safeToSpend('2026-10-14');
    if (safe.daysToPayday !== 9 || safe.nextPayday !== '2026-10-23') throw new Error(`days to payday: ${JSON.stringify(safe)}`);
    return { ...buckets(book), 'safe to spend': safe.amount };
  },
  11: () => {
    const book = openTestBook({
      lastPaycheckDate: '2026-10-09',
      oldCardDebt: parseDollars('2,900.00'),
      pots: {
        savings: parseDollars('2,000.00'),
        needs: parseDollars('500.00'),
        wants: parseDollars('300.00'),
        momReserve: parseDollars('1,500.00'),
        heldForOthers: parseDollars('60.00'),
      },
    });
    book.receive(purchase('hardware', '2026-10-12', parseDollars('45.00'), 'MADE UP HARDWARE', { pending: true }));
    book.receive(deposit('gift', '2026-10-13', parseDollars('200.00'), 'MADE UP GIFT'));
    const posted = { checking: parseDollars('1,200.00'), savings: parseDollars('3,500.00'), everydayCard: parseDollars('140.00') };
    const bank = withPendingCharges(posted, [{ account: 'everyday-card', amount: parseDollars('45.00') }]);
    const check = book.selfCheck(bank);
    const afterFee = book.checkedSafeToSpend('2026-10-15', { ...bank, checking: parseDollars('1,190.00') });
    if (afterFee.ok) throw new Error('safe to spend should not be shown when the totals do not match');
    return { 'app side': check.appSide, 'bank side': check.bankSide, difference: check.difference, 'difference after the fee': afterFee.difference };
  },
  12: () => {
    const book = openTestBook({
      pots: { savings: parseDollars('1,000.00'), needs: parseDollars('400.00'), wants: parseDollars('250.00') },
      settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } },
    });
    book.changeSettings({ split: { savings: 60, needs: 25, wants: 15 } }, '2026-10-12');
    book.moveMoney({ from: 'wants', to: 'needs', amount: parseDollars('100.00') }, '2026-10-13');
    const asked = book.moveMoney({ from: 'savings', to: 'wants', amount: parseDollars('200.00') }, '2026-10-14');
    if (asked.moved) throw new Error('moving out of savings should ask first');
    book.moveMoney({ from: 'savings', to: 'wants', amount: parseDollars('200.00'), confirmed: true }, '2026-10-14');
    book.receive(paycheck('pay', '2026-10-23', parseDollars('3,000.00')));
    if (book.changeLog().length !== 3) throw new Error(`change log: ${JSON.stringify(book.changeLog())}`);
    return buckets(book);
  },
  13: () => {
    const bankBalances = { checking: parseDollars('2,500.00'), savings: parseDollars('4,000.00'), everydayCard: parseDollars('300.00') };
    const pendingCharges = [purchase('dinner', '2026-10-05', parseDollars('45.00'), 'MADE UP CAFE', { pending: true })];
    const input = {
      date: '2026-10-06',
      bankBalances,
      pendingCharges,
      oldCardBalance: parseDollars('2,900.00'),
      lastPaycheckDate: '2026-09-25',
      settings: TEST_SETTINGS,
    };
    const assignment = {
      savings: parseDollars('4,000.00'),
      needs: parseDollars('1,000.00'),
      wants: parseDollars('500.00'),
      momReserve: parseDollars('600.00'),
      heldForOthers: parseDollars('50.00'),
    };
    const first = startTracking({ ...input, assignment });
    if (first.ok) throw new Error('the first try should not start');
    const second = startTracking({ ...input, assignment: { ...assignment, heldForOthers: parseDollars('55.00') } });
    if (!second.ok) throw new Error('the second try should start');
    const book = second.book;
    book.receive(posted('dinner-posted', 'dinner', '2026-10-07', parseDollars('52.00'), 'MADE UP CAFE'));
    book.sort('dinner', { to: 'wants' }, '2026-10-07');
    return { ...buckets(book), 'old card debt': book.oldCardDebt(), 'left to assign on the first try': first.difference };
  },
  14: () => {
    const book = openTestBook({
      oldCardDebt: parseDollars('2,000.00'),
      pots: { savings: parseDollars('2,000.00'), needs: parseDollars('500.00'), wants: parseDollars('300.00'), momReserve: parseDollars('1,500.00') },
    });
    book.receive(sent('card', '2026-10-12', parseDollars('600.00'), 'checking', 'everyday-card'));
    book.receive(sent('old', '2026-10-12', parseDollars('150.00'), 'checking', 'old-card'));
    const onItsWay = { checking: parseDollars('1,050.00'), savings: parseDollars('3,500.00'), everydayCard: parseDollars('1,000.00') };
    const whileOnItsWay = book.selfCheck(onItsWay);
    const shown = book.checkedSafeToSpend('2026-10-12', onItsWay);
    if (!shown.ok) throw new Error('safe to spend should be shown while the payment is on its way');
    book.receive(arrived('card-landed', '2026-10-14', parseDollars('600.00'), 'checking', 'everyday-card', 'card'));
    book.receive(arrived('old-landed', '2026-10-14', parseDollars('150.00'), 'checking', 'old-card', 'old'));
    const afterItLands = book.selfCheck({ ...onItsWay, everydayCard: parseDollars('400.00') });
    return {
      ...buckets(book),
      'in transit while on its way': whileOnItsWay.inTransit,
      'difference while on its way': whileOnItsWay.difference,
      'difference after it lands': afterItLands.difference,
      'old card debt': book.oldCardDebt(),
      'safe to spend': shown.safeToSpend.amount,
    };
  },
  15: () => {
    const book = openTestBook({
      lastPaycheckDate: '2026-09-25',
      pots: { savings: parseDollars('500.00'), needs: parseDollars('200.00'), wants: parseDollars('100.00'), momReserve: parseDollars('1,000.00') },
    });
    book.receive(deposit('new-job', '2026-10-02', parseDollars('2,000.00'), 'MADE UP NEW EMPLOYER'));
    book.sort('new-job', { to: 'paycheck' }, '2026-10-02');
    if (book.safeToSpend('2026-10-02').nextPayday !== '2026-10-16') throw new Error('the pay schedule should count from Oct 2');
    book.answerLeftover('leftover:new-job:needs', 'roll-over', '2026-10-02');
    book.answerLeftover('leftover:new-job:wants', 'move-to-savings', '2026-10-02');
    if (book.receive(paycheck('bonus', '2026-10-06', parseDollars('300.00'))).outcome !== 'review') throw new Error('4 days after a paycheck goes to review');
    book.sort('bonus', { to: 'other-income' }, '2026-10-06');
    if (book.safeToSpend('2026-10-06').nextPayday !== '2026-10-16') throw new Error('other income does not move the pay schedule');
    return buckets(book);
  },
  16: () => {
    const book = openTestBook({
      pots: { needs: parseDollars('50.00'), wants: parseDollars('-20.00') },
      settings: { leftoverAtPayday: { needs: 'roll-over', wants: 'roll-over' } },
      rules: [
        { id: 'needs', for: 'purchase', contains: 'GROCER', bucket: 'needs' },
        { id: 'wants', for: 'purchase', contains: 'FUN', bucket: 'wants' },
      ],
    });
    const found: Record<string, Cents> = {};
    const take = (): void => {
      const bankBalances = { checking: appSide(book.pots()), savings: 0, everydayCard: 0 };
      for (const alert of book.takeAlerts({ bankConnection: 'ok', bankBalances })) {
        if (alert.kind === 'low-bucket' || alert.kind === 'empty-bucket') {
          const name = `${alert.bucket} ${alert.kind === 'low-bucket' ? 'low' : 'empty'} alert at`;
          if (name in found) throw new Error(`${name} came twice`);
          found[name] = alert.amount;
        }
      }
    };
    book.receive(paycheck('pay', '2026-10-09', parseDollars('4,000.00')));
    const started = book.startedPeriodWith();
    take();
    for (const [id, amount, what] of [
      ['groceries', '640.00', 'MADE UP GROCER'],
      ['charge', '0.01', 'MADE UP GROCER'],
      ['concert', '385.00', 'MADE UP FUN'],
      ['dinner', '95.00', 'MADE UP FUN'],
    ] as const) {
      book.receive(purchase(id, '2026-10-10', parseDollars(amount), what));
      take();
    }
    return { ...buckets(book), 'needs started with': started.needs, 'wants started with': started.wants, ...found };
  },
  17: () => {
    // The test book's last paycheck is Sep 25.
    const book = openTestBook({ oldCardDebt: parseDollars('3,000.00'), settings: { oldCardPromoEndDate: '2027-01-10' } });
    const first = payoffCountdown(book, '2026-10-06');
    book.changeSettings({ oldCardPromoEndDate: '2027-01-01' }, '2026-10-06');
    const onPayday = payoffCountdown(book, '2026-10-06');
    const ended = payoffCountdown(book, '2027-01-02');
    if (!first.on || !onPayday.on || !ended.on) throw new Error('the countdown should be on');
    return {
      'per payday': first.perPayday,
      'last payment': first.owed - (first.paydaysLeft - 1) * first.perPayday,
      'with the end on a payday': onPayday.perPayday,
      'with no paydays left': ended.perPayday,
    };
  },
  18: () => {
    const book = openTestBook({ pots: { needs: parseDollars('500.00') }, rules: [{ id: 'gas', for: 'purchase', contains: 'MADE UP GAS', bucket: 'needs' }] });
    book.receive(purchase('hold', '2026-10-05', parseDollars('100.00'), 'MADE UP GAS', { pending: true }));
    book.receive(dropped('drop', 'hold', '2026-10-07'));
    book.receive(purchase('gas', '2026-10-07', parseDollars('42.17'), 'MADE UP GAS'));
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
