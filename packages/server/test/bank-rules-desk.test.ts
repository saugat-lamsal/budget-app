import type { AccountId, Cents, IsoDate } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { BankRulesDesk } from '../src/bank-rules-desk.js';
import type { BankLine } from '../src/bank-rules.js';
import { checkBankRules } from '../src/bank/reading.js';
import { parseRequest } from '../src/choices.js';
import type { BankRuleRequest, BankRuleResponse } from '../src/views/bank-rules.js';

// Changes to the bank rules reach them through a desk (rulebook section 2,
// 24c; 13.5), on Setup day and on Settings, with the same promises as every
// other: decision numbers, a repeat changes nothing, a refusal changes
// nothing and says why. Every change asks first, showing what it would have
// matched lately. Every name and number is made up.

const TODAY: IsoDate = '2026-10-09';
let n = 0;
const line = (account: AccountId, amount: Cents, description: string, date: IsoDate = '2026-10-01'): BankLine => ({ id: `l${(n += 1)}`, account, amount, date, description, pending: false, label: null });

function desk(lines: BankLine[] = [], bookLines = 0): { d: BankRulesDesk; lines: BankLine[]; book: { lines: number } } {
  const book = { lines: bookLines };
  const d = new BankRulesDesk({
    rules: checkBankRules([{ id: 'zelle', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' }]),
    lines: () => lines,
    today: () => TODAY,
    bookLines: () => book.lines,
  });
  return { d, lines, book };
}

let k = 0;
const id = (): string => `bank-rule-decision-${(k += 1)}`;
function askThenYes(d: BankRulesDesk, bankRule: BankRuleRequest['bankRule'], decision = id()): BankRuleResponse {
  const asked = d.decide({ id: decision, bankRule });
  if (asked.ok || asked.code !== 'needs-confirmation' || asked.preview === undefined) throw new Error(`expected it to ask first: ${JSON.stringify(asked)}`);
  return d.decide({ id: decision, bankRule, confirmed: true, seen: asked.preview.key });
}

describe('24c every change asks first, with what it would have matched lately', () => {
  it('24c a new rule: it asks, with how many recent items it would have matched and a few of them; nothing changes until the yes', () => {
    const { d } = desk([line('checking', 10_000, 'Online Banking transfer to SAV', '2026-10-01'), line('checking', 5_000, 'Online Banking transfer to SAV', '2026-10-05'), line('checking', 900, 'Online FEE', '2026-10-06')]);
    const asked = d.decide({ id: id(), bankRule: { add: { account: 'checking', contains: 'Online', means: 'transfer', other: 'savings' } } });
    expect(asked).toMatchObject({ ok: false, code: 'needs-confirmation' });
    if (asked.ok) return;
    expect(asked.why).toBe('Check what it would have matched lately before you save it. It reads what the bank sends from now on. Nothing was changed.');
    expect(asked.preview).toMatchObject({ action: 'add', rule: { account: 'checking', contains: 'Online', means: 'transfer', other: 'savings' }, recentDays: 90, matches: { count: 3 } });
    expect(asked.preview?.matches.examples.map((e) => e.date)).toEqual(['2026-10-06', '2026-10-05', '2026-10-01']);
    expect(d.rules().map((r) => r.id)).toEqual(['zelle']);
    expect(d.log()).toEqual([]);
  });

  it('24c 13.5 with his yes to what he saw, it is saved and logged with the date', () => {
    const { d } = desk([], 4);
    const done = askThenYes(d, { add: { account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' } });
    expect(done).toEqual({ ok: true, replayed: false, done: { action: 'added', rule: { id: 'bank-rule-1', account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' } } });
    expect(d.rules().map((r) => r.id)).toEqual(['zelle', 'bank-rule-1']);
    expect(d.log()).toEqual([{ date: TODAY, action: 'added', rule: { id: 'bank-rule-1', account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' }, before: null, afterBookLines: 4 }]);
  });

  it('24c a yes to a preview that is not what it would do any more asks again, with the new one', () => {
    const { d, lines } = desk([line('checking', 4_000, 'Zelle payment to ANNA')]);
    const change = { change: { id: 'zelle', account: 'savings' as const, contains: 'Zelle payment to', means: 'payment-to-person' as const } };
    const decision = id();
    const asked = d.decide({ id: decision, bankRule: change });
    const key = !asked.ok ? asked.preview?.key : undefined;
    lines.push(line('savings', 6_000, 'Zelle payment to BEN', '2026-10-08'));
    const again = d.decide({ id: decision, bankRule: change, confirmed: true, seen: key ?? '' });
    expect(again).toMatchObject({ ok: false, code: 'needs-confirmation', why: 'What it would match has changed since you looked. Check it again. Nothing was changed.', preview: { matches: { count: 1 } } });
    expect(d.rules()[0]?.account).toBe('checking');
    expect(!again.ok && d.decide({ id: decision, bankRule: change, confirmed: true, seen: again.preview?.key ?? '' }).ok).toBe(true);
    expect(d.rules()[0]?.account).toBe('savings');
  });

  it('24c a change keeps its place and the log keeps what it was; a removal asks first, showing what it matched', () => {
    const { d } = desk([line('checking', 4_000, 'Zelle payment to ANNA')]);
    askThenYes(d, { add: { account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' } });
    askThenYes(d, { change: { id: 'zelle', account: 'checking', contains: 'Zelle', means: 'payment-to-person' } });
    expect(d.rules().map((r) => [r.id, r.contains])).toEqual([
      ['zelle', 'Zelle'],
      ['bank-rule-1', 'LATE FEE'],
    ]);
    expect(d.log()[1]).toMatchObject({ action: 'changed', before: { contains: 'Zelle payment to' }, rule: { contains: 'Zelle' } });
    const asked = d.decide({ id: id(), bankRule: { remove: 'zelle' } });
    expect(asked).toMatchObject({ ok: false, code: 'needs-confirmation', preview: { action: 'remove', matches: { count: 1 } } });
    expect(!asked.ok && asked.why).toMatch(/needs your OK first/);
    askThenYes(d, { remove: 'zelle' });
    expect(d.rules().map((r) => r.id)).toEqual(['bank-rule-1']);
    expect(d.log().map((l) => l.action)).toEqual(['added', 'changed', 'removed']);
  });

  it('section 2 an id is never handed out twice, even after the rule with it is removed', () => {
    const { d } = desk();
    askThenYes(d, { add: { account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' } });
    askThenYes(d, { remove: 'bank-rule-1' });
    const again = askThenYes(d, { add: { account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' } });
    expect(again.ok && again.done.rule.id).toBe('bank-rule-2');
  });
});

describe('A27 moving a bank rule asks first, and is logged', () => {
  function withMom(lines: BankLine[] = []): BankRulesDesk {
    return new BankRulesDesk({
      rules: checkBankRules([
        { id: 'zelle', account: 'checking', contains: 'Zelle payment to', means: 'payment-to-person' },
        { id: 'fee', account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' },
        { id: 'mom', account: 'checking', contains: 'Zelle payment to MOM', means: 'transfer', other: 'savings' },
      ]),
      lines: () => lines,
      today: () => TODAY,
      bookLines: () => 2,
    });
  }

  it('A27 a move asks first, saying how many recent items it would read that the rule it passes reads now; nothing moves until the yes', () => {
    const d = withMom([line('checking', 50_000, 'Zelle payment to MOM MADEUP'), line('checking', 4_000, 'Zelle payment to ANNA')]);
    const asked = d.decide({ id: id(), bankRule: { move: { id: 'mom', direction: 'up' } } });
    expect(asked).toMatchObject({
      ok: false,
      code: 'needs-confirmation',
      why: 'Moving a bank rule changes which rule reads what the bank sends from now on. It needs your OK first. Nothing was changed.',
      preview: {
        action: 'move',
        rule: { account: 'checking', contains: 'Zelle payment to MOM', means: 'transfer', other: 'savings' },
        move: { direction: 'up', past: { id: 'zelle' }, switching: 1 },
        matches: { count: 1, readFirstByEarlier: 0 },
      },
    });
    expect(d.rules().map((r) => r.id)).toEqual(['zelle', 'fee', 'mom']);
    expect(d.log()).toEqual([]);
  });

  it('A27 13.5 with his yes it moves one place among the rules on its account, and the move is logged with the date and the rule it passed', () => {
    const d = withMom();
    const done = askThenYes(d, { move: { id: 'mom', direction: 'up' } });
    expect(done).toEqual({ ok: true, replayed: false, done: { action: 'moved-up', rule: { id: 'mom', account: 'checking', contains: 'Zelle payment to MOM', means: 'transfer', other: 'savings' } } });
    expect(d.rules().map((r) => r.id)).toEqual(['mom', 'fee', 'zelle']);
    expect(d.log()).toEqual([{ date: TODAY, action: 'moved-up', rule: d.rules()[0], before: null, past: d.rules()[2], position: 1, afterBookLines: 2 }]);
    const down = askThenYes(d, { move: { id: 'mom', direction: 'down' } });
    expect(down.ok && down.done.action).toBe('moved-down');
    expect(d.rules().map((r) => r.id)).toEqual(['zelle', 'fee', 'mom']);
    expect(d.log().map((l) => [l.action, 'position' in l ? l.position : null])).toEqual([
      ['moved-up', 1],
      ['moved-down', 3],
    ]);
  });

  it('A27 a move that cannot be is refused in words before anything is asked, and nothing changes', () => {
    const d = withMom();
    expect(d.decide({ id: id(), bankRule: { move: { id: 'zelle', direction: 'up' } } })).toEqual({ ok: false, code: 'refused', why: 'It is already the first bank rule on checking. Nothing was changed.' });
    expect(d.decide({ id: id(), bankRule: { move: { id: 'fee', direction: 'down' } } })).toEqual({ ok: false, code: 'refused', why: 'It is already the last bank rule on the everyday card. Nothing was changed.' });
    expect(d.decide({ id: id(), bankRule: { move: { id: 'gone', direction: 'down' } } })).toEqual({ ok: false, code: 'refused', why: 'That rule is not there any more. Nothing was changed.' });
    expect(d.rules().map((r) => r.id)).toEqual(['zelle', 'fee', 'mom']);
    expect(d.log()).toEqual([]);
  });

  it('A27 B92 a lost answer to a move: the same yes sent again is answered the same, and moves it once', () => {
    const d = withMom();
    const decision = id();
    const change = { move: { id: 'mom', direction: 'up' as const } };
    const asked = d.decide({ id: decision, bankRule: change });
    const key = !asked.ok ? (asked.preview?.key ?? '') : '';
    const first = d.decide({ id: decision, bankRule: change, confirmed: true, seen: key });
    const second = d.decide({ id: decision, bankRule: change, confirmed: true, seen: key });
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toEqual({ ...first, replayed: true });
    expect(d.rules().map((r) => r.id)).toEqual(['mom', 'fee', 'zelle']);
    expect(d.log()).toHaveLength(1);
  });
});

describe('B92 decision numbers and refusals', () => {
  it('B92 a decision number used for a different change is refused, and nothing changes', () => {
    const { d } = desk();
    const decision = id();
    askThenYes(d, { add: { account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' } }, decision);
    expect(d.decide({ id: decision, bankRule: { remove: 'zelle' } })).toEqual({ ok: false, code: 'id-reused', why: 'That decision number was already used for a different change. Nothing was changed.' });
    expect(d.rules()).toHaveLength(2);
    expect(d.log()).toHaveLength(1);
  });

  it('B92 a lost answer: the same yes sent again is answered the same, and counts once', () => {
    const { d } = desk();
    const change = { add: { account: 'everyday-card' as const, contains: 'LATE FEE', means: 'card-fee' as const } };
    const decision = id();
    const asked = d.decide({ id: decision, bankRule: change });
    const key = !asked.ok ? (asked.preview?.key ?? '') : '';
    const first = d.decide({ id: decision, bankRule: change, confirmed: true, seen: key });
    const second = d.decide({ id: decision, bankRule: change, confirmed: true, seen: key });
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toEqual({ ...first, replayed: true });
    expect(d.rules()).toHaveLength(2);
    expect(d.log()).toHaveLength(1);
  });

  it('section 2 a rule that cannot be is refused in words before anything is asked, and nothing changes', () => {
    const { d } = desk();
    expect(d.decide({ id: id(), bankRule: { add: { account: 'checking', contains: 'zelle payment TO', means: 'payment-to-person' } } })).toEqual({ ok: false, code: 'refused', why: 'You already have that rule. Nothing was changed.' });
    expect(d.decide({ id: id(), bankRule: { add: { account: 'savings', contains: 'FEE', means: 'card-fee' } } })).toEqual({ ok: false, code: 'refused', why: 'Fees and interest are on a card. Nothing was changed.' });
    expect(d.decide({ id: id(), bankRule: { remove: 'nope' } })).toEqual({ ok: false, code: 'refused', why: 'That rule is not there any more. Nothing was changed.' });
    expect(d.rules().map((r) => r.id)).toEqual(['zelle']);
    expect(d.log()).toEqual([]);
  });
});

describe('section 2 what the phone may send for a bank rule: exactly the right shape, or nothing', () => {
  const good: unknown[] = [
    { id: 'abcdefgh', bankRule: { add: { account: 'checking', contains: 'Zelle', means: 'payment-to-person' } } },
    { id: 'abcdefgh', bankRule: { add: { account: 'checking', contains: 'to SAV', means: 'transfer', other: 'savings' } }, confirmed: true, seen: '0123abcd' },
    { id: 'abcdefgh', bankRule: { change: { id: 'bank-rule-1', account: 'everyday-card', contains: 'LATE FEE', means: 'card-fee' } } },
    { id: 'abcdefgh', bankRule: { remove: 'bank-rule-1' } },
    { id: 'abcdefgh', bankRule: { move: { id: 'bank-rule-1', direction: 'up' } } },
    { id: 'abcdefgh', bankRule: { move: { id: 'bank-rule-1', direction: 'down' } }, confirmed: true, seen: '0123abcd' },
  ];
  it.each(good.map((g) => [JSON.stringify(g), g]))('section 2 read: %s', (_name, value) => {
    expect(parseRequest(value)).toEqual(value);
  });

  const bad: unknown[] = [
    { id: 'short', bankRule: { remove: 'x' } },
    { id: 'abcdefgh', bankRule: {} },
    { id: 'abcdefgh', bankRule: { remove: '' } },
    { id: 'abcdefgh', bankRule: { remove: 'x', add: {} } },
    { id: 'abcdefgh', bankRule: { add: { account: 'brokerage', contains: 'x', means: 'card-fee' } } },
    { id: 'abcdefgh', bankRule: { add: { account: 'checking', contains: 'x', means: 'purchase' } } },
    { id: 'abcdefgh', bankRule: { add: { account: 'checking', contains: 7, means: 'card-fee' } } },
    { id: 'abcdefgh', bankRule: { add: { account: 'checking', contains: 'x', means: 'transfer', other: 'brokerage' } } },
    { id: 'abcdefgh', bankRule: { add: { account: 'checking', contains: 'x', means: 'card-fee', extra: 1 } } },
    { id: 'abcdefgh', bankRule: { change: { account: 'checking', contains: 'x', means: 'card-fee' } } },
    { id: 'abcdefgh', bankRule: { remove: 'x' }, confirmed: 'yes' },
    { id: 'abcdefgh', bankRule: { remove: 'x' }, seen: 'not hex!' },
    { id: 'abcdefgh', bankRule: { remove: 'x' }, more: 1 },
    { id: 'abcdefgh', bankRule: { move: { id: 'x', direction: 'sideways' } } },
    { id: 'abcdefgh', bankRule: { move: { id: '', direction: 'up' } } },
    { id: 'abcdefgh', bankRule: { move: { direction: 'up' } } },
    { id: 'abcdefgh', bankRule: { move: { id: 'x', direction: 'up', by: 2 } } },
    { id: 'abcdefgh', bankRule: { move: 'x' } },
  ];
  it.each(bad.map((b) => [JSON.stringify(b), b]))('section 2 not read: %s', (_name, value) => {
    expect(parseRequest(value)).toBeNull();
  });
});
