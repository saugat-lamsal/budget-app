import { formatDollars, type BankBalances, type Book, type Cents, type IsoDate, type Pot } from '@budget-app/money';
import type { Page } from 'playwright';
import { POT_SLUGS } from '../../../../server/src/views/activity.js';
import { activityOf, numbersOf, readActivity } from '../activity-screens.js';
import { readCents } from '../harness.js';
import { bucketsOf, listed, readBuckets } from '../screens.js';
import { readSettings, settingsOf } from '../settings-screens.js';

// Each screen's numbers read off the page by what they are, and compared
// straight with the simulator's book, worked out with the money math and the
// rulebook here: none of it goes through the code that makes the screens'
// numbers (views) or shows them. (The page against the same screen given the
// simulator's numbers, in pay-period.test.ts, catches everything else on it.)
// Each returns what differs, as "what: screen X, simulator Y".

type Problems = string[];

const cents = async (page: Page, testId: string): Promise<Cents | null> => {
  const el = page.getByTestId(testId);
  // A plus in front of money that came in is read as nothing: the amount is what follows it.
  return (await el.count()) === 0 ? null : readCents((await el.first().innerText()).trim().replace(/^\+/, ''));
};

function same(problems: Problems, what: string, shown: unknown, expected: unknown): void {
  if (JSON.stringify(shown) !== JSON.stringify(expected)) problems.push(`${what}: screen ${JSON.stringify(shown)}, simulator ${JSON.stringify(expected)}`);
}

// A whole-number percent of an amount, rounded down (3.3).
const percentOf = (amount: Cents, percent: number): Cents => {
  const hundredths = amount * percent;
  return (hundredths - (hundredths % 100)) / 100;
};

export async function byHand(page: Page, path: string, book: Book, today: IsoDate, bank: BankBalances): Promise<Problems> {
  const problems: Problems = [];
  const pots = book.pots();
  if (path === '/home') {
    // 11.1 and 11.2.
    const safe = book.safeToSpend(today);
    same(problems, '11.1 safe to spend', await cents(page, 'safe-to-spend'), pots.wants - pots.unsortedOut);
    same(problems, '11.1 safe to spend', await cents(page, 'safe-to-spend'), safe.amount);
    const payday = (await page.getByTestId('payday').innerText()).replace(/\s+/g, ' ');
    const days = safe.daysToPayday;
    same(problems, '11.2 days to payday', payday.startsWith(days === 0 ? 'Payday is today' : days > 0 ? `${days} day${days === 1 ? '' : 's'} to payday` : `Paycheck is ${-days} day`), true);
    same(problems, 'the bucket bars: needs and wants left', [await cents(page, 'bucket-needs-left'), await cents(page, 'bucket-wants-left')], [pots.needs, pots.wants]);
    const started = book.startedPeriodWith();
    same(problems, 'the bucket bars: what each started the pay period with', [await cents(page, 'bucket-needs-of'), await cents(page, 'bucket-wants-of')], [started.needs, started.wants]);
    // 3.8 (B80): Home says what is still to move, when there is any.
    const transfer = book.savingsTransfer(bank.savings);
    same(problems, '3.8 still to move to savings', await cents(page, 'move-amount'), transfer.stillToMove > 0 ? transfer.stillToMove : null);
  } else if (path === '/buckets') {
    same(problems, '12.2 the buckets', await readBuckets(page), bucketsOf(book));
    const started = book.startedPeriodWith();
    same(problems, '10.1 what needs and wants started the pay period with', [await cents(page, 'bucket-needs-of'), await cents(page, 'bucket-wants-of')], [started.needs, started.wants]);
    same(problems, '8.2 sent to mom this month', await cents(page, 'mom-sent'), book.momSentInMonth(today.slice(0, 7)).sent);
    same(problems, '12.4 the old card debt', await cents(page, 'old-card-debt'), book.oldCardDebt());
    // 12.5, B44: every transfer with one side showing, the old card's too.
    const transit = book.inTransit().items;
    const shownIds = await page.locator('[data-testid^="transit-"][data-testid$="-amount"]').evaluateAll((els) => els.map((e) => (e.getAttribute('data-testid') ?? '').slice('transit-'.length, -'-amount'.length)));
    same(problems, '12.5 what is on its way', shownIds.sort(), transit.map((i) => i.id).sort());
    for (const item of transit) same(problems, `12.5 ${item.id} on its way`, await cents(page, `transit-${item.id}-amount`), item.amount);
  } else if (path.startsWith('/buckets/')) {
    const pot = POT_SLUGS[path.slice('/buckets/'.length)] as Pot;
    same(problems, `B97 what went in and out of ${pot}`, numbersOf(await readActivity(page)), numbersOf(activityOf(book, pot)));
  } else if (path === '/review') {
    const details = book.reviewDetails();
    same(problems, '10.3 what waits in review', [...(await listed(page))].sort(), details.map((d) => d.item.id).sort());
    if (details.length > 0) same(problems, 'how many wait', await page.getByTestId('review-count').innerText(), String(details.length));
    for (const d of details) same(problems, 'the amount of ' + d.item.id, readCents(await page.getByTestId('item-' + d.item.id).getByTestId('item-amount').innerText()), d.item.amount);
    same(problems, '4.3 held back from safe to spend', await cents(page, 'held-back'), pots.unsortedOut > 0 ? pots.unsortedOut : null);
  } else if (path === '/payday') {
    const report = book.paydayReport();
    const paycheck = report.paycheck;
    if (paycheck !== null) {
      // 3.2 and 3.3, worked out here from the rulebook.
      const taken = Math.min(paycheck.reservePerPaycheck, paycheck.amount);
      const fits = Math.max(0, Math.min(taken, paycheck.reserveCap - paycheck.reserveBefore));
      const rest = paycheck.amount - taken;
      const needs = percentOf(rest, paycheck.percent.needs);
      const wants = percentOf(rest, paycheck.percent.wants);
      same(problems, '3.1 the paycheck', await cents(page, 'paycheck-amount'), paycheck.amount);
      same(problems, '3.2 the mom reserve: before, taken, in, over its cap', [await cents(page, 'reserve-before'), await cents(page, 'reserve-taken'), await cents(page, 'reserve-in'), await cents(page, 'reserve-overflow')], [paycheck.reserveBefore, taken, fits, taken > fits ? taken - fits : null]);
      same(problems, '3.3 the split: the rest, savings, needs, wants', [await cents(page, 'split-rest'), await cents(page, 'split-savings'), await cents(page, 'split-needs'), await cents(page, 'split-wants')], [rest, percentOf(rest, paycheck.percent.savings), needs, wants]);
      const rounding = rest - percentOf(rest, paycheck.percent.savings) - needs - wants;
      same(problems, '3.3 the cents left over go to savings', await cents(page, 'split-rounding'), rounding > 0 ? rounding : null);
      same(problems, '3.3 what each bucket got', [await cents(page, 'got-mom'), await cents(page, 'got-savings'), await cents(page, 'got-needs'), await cents(page, 'got-wants'), await cents(page, 'got-total')], [fits, paycheck.amount - fits - needs - wants, needs, wants, paycheck.amount]);
      same(problems, '3.3 the parts add up to the paycheck', fits + (paycheck.amount - fits - needs - wants) + needs + wants, paycheck.amount);
      const transfer = book.savingsTransfer(bank.savings);
      same(problems, '3.8 move to savings: should be, holds, still to move, extra', [await cents(page, 'savings-should'), await cents(page, 'savings-holds'), await cents(page, 'savings-to-move'), await cents(page, 'savings-extra')], [transfer.shouldBeInSavings, transfer.savingsAccountBalance, transfer.stillToMove, transfer.extraInSavings ?? null]);
      // B46: what is on its way to the savings account, which counts as moved.
      const onItsWay = book.inTransit().items.filter((i) => i.to === 'savings' && i.seen === 'left').reduce((sum, i) => sum + i.amount, 0);
      same(problems, '3.8 B46 on its way to the savings account', await cents(page, 'savings-on-its-way'), onItsWay > 0 ? onItsWay : null);
      for (const leftover of report.leftovers) {
        const card = page.getByTestId(`leftover-${leftover.bucket}`);
        const shown = (await card.count()) === 0 ? null : (await card.innerText()).replace(/\s+/g, ' ');
        if (leftover.outcome === 'nothing-to-ask') continue;
        if (leftover.outcome === 'waiting' && leftover.question !== null) {
          // The open question, as its card on Payday.
          same(problems, `3.4 the ${leftover.bucket} question`, readCents(await page.getByTestId(`item-${leftover.question}`).getByTestId('item-amount').innerText()), leftover.amount);
          continue;
        }
        same(problems, `3.4 the ${leftover.bucket} leftover shows ${formatDollars(leftover.amount)}`, shown?.includes(formatDollars(leftover.amount)) ?? false, true);
      }
      const ended = report.ended;
      if (ended !== null) {
        same(problems, 'B105 the pay period that ended: needs and wants spent, sent to mom, needs and wants left', [await cents(page, 'ended-needs-spent'), await cents(page, 'ended-wants-spent'), await cents(page, 'ended-mom'), await cents(page, 'ended-needs-left'), await cents(page, 'ended-wants-left')], [ended.byKind.needs.spending, ended.byKind.wants.spending, ended.byKind.momReserve.mom, ended.closing.needs, ended.closing.wants]);
      }
    }
  } else if (path === '/settings') {
    const shown = await readSettings(page);
    const expected = settingsOf(book, today);
    // The real server names rules by decision numbers; the place and what each picks are compared.
    const withoutIds = (rules: Record<string, readonly string[]>): Record<string, string[]> => Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, v.map((r) => r.replace(/^(\d+\.) \S+:/, '$1'))]));
    same(problems, '13.1 the split and the mom reserve, this pay period and from the next paycheck', [shown.split, shown.reserve, shown.cap], [expected.split, expected.reserve, expected.cap]);
    same(problems, 'section 2 every other setting', shown.values, expected.values);
    same(problems, '8.2 the mom monthly target', shown.target, expected.target);
    same(problems, '9.5 the payoff countdown', shown.perPayday, expected.perPayday);
    same(problems, '13.2 the sorting rules, in order', withoutIds(shown.rules), withoutIds(expected.rules));
    // The book's own lines of the change log (the bank rules' and the server's are its alone).
    same(problems, '13.5 the change log', shown.log.filter((key) => /^log-\d+-\d+$/.test(key)), expected.log);
  }
  return problems;
}
