import { DEFAULT_SETTINGS, type IsoDate } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import type { BankRuleSpec } from '../src/bank-rules.js';
import { madeUpHistory } from '../src/demo/made-up-bank.js';
import { SETUP_PENDING, SETUP_SUGGEST } from '../src/demo/setup-lives.js';
import { SetupDesk } from '../src/setup-desk.js';
import type { BankRuleRequest } from '../src/views/bank-rules.js';
import type { SetupResponse, SetupStep } from '../src/views/choice.js';
import type { SetupReadyView } from '../src/views/setup.js';

// Bank rules on Setup day (rulebook section 2, 20a, 24c): suggested from the
// labels in the bank's history, before the transfers step, since that step
// depends on them. He adds, changes, or skips each one; nothing is assumed.
// Before tracking starts, the setup steps follow the rules as they are now.
// Every name and number is made up.

const TODAY: IsoDate = '2026-10-07';
const desk = (bank = SETUP_SUGGEST): SetupDesk => new SetupDesk({ bank: madeUpHistory(bank), today: () => TODAY, settings: DEFAULT_SETTINGS, halvesWithinDays: 10, madeUpData: true });

let n = 0;
const id = (): string => `setup-rules-decision-${(n += 1)}`;
const ask = (d: SetupDesk, setup: SetupStep, more: { confirmed?: boolean; seen?: string } = {}): SetupResponse => d.decide({ id: id(), setup, ...more });

function ready(d: SetupDesk): SetupReadyView {
  const view = d.view();
  if (view.state !== 'not-set-up' || !view.ready) throw new Error(`not ready: ${JSON.stringify(view)}`);
  return view;
}

const suggestion = (d: SetupDesk, contains: string, account?: string) => {
  const found = ready(d).suggestions.find((s) => s.contains === contains && (account === undefined || s.account === account));
  if (found === undefined) throw new Error(`no suggestion "${contains}"`);
  return found;
};
const add = (d: SetupDesk, contains: string, account?: string): SetupResponse => ask(d, { suggestion: { id: suggestion(d, contains, account).id, answer: 'add' } });
const halves = (d: SetupDesk): string[] => ready(d).halves.map((h) => h.id);

// A change asked first, then his yes to what he saw.
function changeThenYes(d: SetupDesk, contains: string, rule: BankRuleSpec): SetupResponse {
  const step: SetupStep = { suggestion: { id: suggestion(d, contains).id, answer: 'change', rule } };
  const decision = id();
  const asked = d.decide({ id: decision, setup: step });
  if (asked.ok || asked.code !== 'needs-confirmation' || asked.preview === undefined) throw new Error(`expected it to ask first: ${JSON.stringify(asked)}`);
  return d.decide({ id: decision, setup: step, confirmed: true, seen: asked.preview.key });
}
function bankRuleYes(d: SetupDesk, bankRule: BankRuleRequest['bankRule']): void {
  const decision = id();
  const asked = d.bankRule({ id: decision, bankRule });
  if (asked.ok || asked.preview === undefined) throw new Error(`expected it to ask first: ${JSON.stringify(asked)}`);
  const done = d.bankRule({ id: decision, bankRule, confirmed: true, seen: asked.preview.key });
  if (!done.ok) throw new Error(done.why);
}

describe('20a Setup day suggests bank rules from the labels in the history; nothing is assumed', () => {
  it('20a with no bank rules yet: every suggestion waits for an answer, and nothing in the history is read as a transfer', () => {
    const v = ready(desk());
    expect(v.suggestions.map((s) => [s.account, s.contains, s.means, s.other, s.matches.count, s.status])).toEqual([
      ['checking', 'Online Banking transfer to SAV 2222', 'transfer', 'savings', 1, 'open'],
      ['checking', 'Online payment to CRD 3333', 'transfer', 'everyday-card', 2, 'open'],
      ['checking', 'Online payment to CRD 4444', 'transfer', null, 1, 'open'],
      ['checking', 'Zelle payment to MADE UP', 'payment-to-person', null, 2, 'open'],
      ['savings', 'Online Banking transfer from CHK 1111', 'transfer', 'checking', 2, 'open'],
      ['everyday-card', 'PAYMENT - THANK YOU', 'transfer', 'checking', 1, 'open'],
      ['everyday-card', 'LATE FEE', 'card-fee', null, 1, 'open'],
      ['old-card', 'INTEREST CHARGE ON PURCHASES', 'card-interest', null, 1, 'open'],
    ]);
    expect(v.suggestions[0]?.label).toBe('TRANSFER_OUT_SAVINGS');
    expect(v).toMatchObject({ unansweredSuggestions: 8, halves: [], bankRules: [] });
    expect(v.missing[0]).toBe('suggestions');
  });

  it('20a in a life whose bank rules already read it all, every suggestion is covered, and none is asked', () => {
    const v = ready(desk(SETUP_PENDING));
    expect(v.suggestions.length).toBeGreaterThan(0);
    expect(v.suggestions.every((s) => s.status === 'covered')).toBe(true);
    expect(v.unansweredSuggestions).toBe(0);
    expect(v.missing).not.toContain('suggestions');
  });

  it('24c d. the transfers step follows the rules as they are now: each rule added changes which transfers it asks about', () => {
    const d = desk();
    expect(add(d, 'Online Banking transfer from CHK 1111')).toEqual({ ok: true, replayed: false, done: { step: 'suggestion', id: suggestion(d, 'Online Banking transfer from CHK 1111').id, answer: 'added', ruleId: 'bank-rule-1' } });
    // Savings shows both landing; checking does not show them leaving yet: both are asked about.
    expect(halves(d)).toEqual(['su-sav-in', 'su-sav-landed']);
    add(d, 'Online Banking transfer to SAV 2222');
    // Now the Sep 28 transfer shows both sides.
    expect(halves(d)).toEqual(['su-sav-landed']);
    add(d, 'Online payment to CRD 3333');
    expect(halves(d)).toEqual(['su-card-left', 'su-sav-landed']);
    expect(ready(d).bankRules.map((r) => r.id)).toEqual(['bank-rule-1', 'bank-rule-2', 'bank-rule-3']);
  });

  it('20a one with the other account to pick cannot be added as it is; changed to name it, it asks first with what it would match, then is added', () => {
    const d = desk();
    const s = suggestion(d, 'Online payment to CRD 4444');
    expect(ask(d, { suggestion: { id: s.id, answer: 'add' } })).toEqual({ ok: false, code: 'refused', why: 'Pick the account it is with first: change it. Nothing was changed.' });
    const asked = ask(d, { suggestion: { id: s.id, answer: 'change', rule: { account: 'checking', contains: 'Online payment to CRD 4444', means: 'transfer', other: 'old-card' } } });
    expect(asked).toMatchObject({ ok: false, code: 'needs-confirmation', preview: { action: 'add', matches: { count: 1 } } });
    expect(ready(d).bankRules).toEqual([]);
    const done = changeThenYes(d, 'Online payment to CRD 4444', { account: 'checking', contains: 'Online payment to CRD 4444', means: 'transfer', other: 'old-card' });
    expect(done).toMatchObject({ ok: true, done: { answer: 'changed', ruleId: 'bank-rule-1' } });
    expect(suggestion(d, 'Online payment to CRD 4444')).toMatchObject({ status: 'changed', ruleId: 'bank-rule-1' });
    expect(halves(d)).toEqual(['su-old-left']);
  });

  it('20a skipped: no rule; the same answer again says so; added after all, later', () => {
    const d = desk();
    const s = suggestion(d, 'LATE FEE');
    expect(ask(d, { suggestion: { id: s.id, answer: 'skip' } })).toMatchObject({ ok: true, done: { answer: 'skipped', ruleId: null } });
    expect(suggestion(d, 'LATE FEE').status).toBe('skipped');
    expect(ready(d)).toMatchObject({ bankRules: [], unansweredSuggestions: 7 });
    expect(ask(d, { suggestion: { id: s.id, answer: 'skip' } })).toEqual({ ok: false, code: 'refused', why: 'That is already your answer. Nothing was changed.' });
    expect(add(d, 'LATE FEE')).toMatchObject({ ok: true, done: { answer: 'added' } });
    expect(suggestion(d, 'LATE FEE').status).toBe('added');
  });

  it('20a removing the rule a suggestion added puts the suggestion back to answer; one not in the list is refused', () => {
    const d = desk();
    add(d, 'LATE FEE');
    bankRuleYes(d, { remove: 'bank-rule-1' });
    expect(suggestion(d, 'LATE FEE')).toMatchObject({ status: 'open', ruleId: null });
    expect(ask(d, { suggestion: { id: 's-not-one', answer: 'skip' } })).toEqual({ ok: false, code: 'refused', why: 'That is not one setup day suggests. Nothing was changed.' });
  });

  it('A25 24c a rule change drops answers about transfers it no longer asks about: asked again, they start unanswered', () => {
    const d = desk();
    add(d, 'Online Banking transfer from CHK 1111');
    ask(d, { onItsWay: { half: 'su-sav-landed', answer: true } });
    const withIt = ready(d).startingMoney;
    bankRuleYes(d, { remove: 'bank-rule-1' });
    expect(halves(d)).toEqual([]);
    expect(ready(d).startingMoney).toBe(withIt + 15_000);
    add(d, 'Online Banking transfer from CHK 1111');
    expect(ready(d).halves.find((h) => h.id === 'su-sav-landed')?.onItsWay).toBeNull();
  });

  it('24c d. the starting money follows the rules too: a pending bill from savings read as a payment to a person is not a pending charge any more', () => {
    const d = desk();
    const before = ready(d);
    expect(before.pendingCharges.map((c) => c.id)).toContain('su-p-water');
    bankRuleYes(d, { add: { account: 'savings', contains: 'BILL PAY WATER', means: 'payment-to-person' } });
    const after = ready(d);
    expect(after.pendingCharges.map((c) => c.id)).not.toContain('su-p-water');
    // It goes to the book once it posts (B36): until then the bank side leaves it out.
    expect(after.bankSide).toBe(before.bankSide + 6_410);
  });

  it('14.3 tracking does not start while a suggestion waits for an answer, and says so', () => {
    const d = desk();
    ask(d, { lastPaycheck: '2026-10-02' });
    ask(d, { assign: { pot: 'needs', rest: true } });
    const v = ready(d);
    expect(v.missing).toEqual(['suggestions']);
    expect(d.decide({ id: id(), setup: { start: true }, confirmed: true, seen: v.key })).toEqual({ ok: false, code: 'refused', why: 'Answer each suggested bank rule first. Nothing was changed.' });
  });

  it('13.5 24c every change on Setup day is logged with the date, before the book begins; after tracking starts, suggestions are done and the rules can still change', () => {
    const d = desk();
    for (const s of ready(d).suggestions) {
      if (s.other === null && s.means === 'transfer') changeThenYes(d, s.contains, { account: s.account, contains: s.contains, means: 'transfer', other: 'old-card' });
      else ask(d, { suggestion: { id: s.id, answer: s.means === 'card-fee' ? 'skip' : 'add' } });
    }
    expect(ready(d).unansweredSuggestions).toBe(0);
    for (const h of ready(d).halves) ask(d, { onItsWay: { half: h.id, answer: true } });
    ask(d, { lastPaycheck: '2026-10-02' });
    ask(d, { assign: { pot: 'needs', rest: true } });
    const v = ready(d);
    expect(v.missing).toEqual([]);
    expect(d.decide({ id: id(), setup: { start: true }, confirmed: true, seen: v.key })).toMatchObject({ ok: true });
    const book = d.started()?.book;
    expect(book?.inTransit().items.map((i) => i.id).sort()).toEqual(v.halves.map((h) => h.id).sort());
    expect(d.bankRules().log().map((l) => [l.date, l.action, l.afterBookLines])).toEqual(Array.from({ length: 7 }, () => [TODAY, 'added', 0]));
    expect(ask(d, { suggestion: { id: v.suggestions[0]?.id ?? '', answer: 'skip' } })).toEqual({ ok: false, code: 'refused', why: 'Setup day is done already. Nothing was changed.' });
    bankRuleYes(d, { remove: 'bank-rule-1' });
    expect(d.bankRules().log().at(-1)).toMatchObject({ action: 'removed', afterBookLines: book?.changeLog().length });
  });

  it('B92 an answer to a suggestion sent again gets the first answer back, and changes nothing', () => {
    const d = desk();
    const step: SetupStep = { suggestion: { id: suggestion(d, 'LATE FEE').id, answer: 'add' } };
    const first = d.decide({ id: 'same-decision-1', setup: step });
    const again = d.decide({ id: 'same-decision-1', setup: step });
    expect(again).toEqual({ ...first, replayed: true });
    expect(ready(d).bankRules).toHaveLength(1);
  });
});
