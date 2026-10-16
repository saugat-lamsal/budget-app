import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { demoBankRulesDesk } from '../../../server/src/demo/demo-server.js';
import { DEMO_TODAY, demoScenario } from '../../../server/src/demo/scenarios.js';
import type { SetupDesk } from '../../../server/src/setup-desk.js';
import type { BankRuleSpec } from '../../../server/src/views/bank-rules.js';
import type { SetupStep } from '../../../server/src/views/choice.js';
import { ENGINES, openScenario, phone, textAt, untilQuiet, useEngine } from './harness.js';
import { openSetup, ready, tell, twinOf } from './setup-screens.js';

// Bank rules (rulebook section 2, 20a, 24c) used in a browser like a person
// would: suggested on Setup day and answered one by one, and changed on
// Settings. Every count and list shown is compared with a twin of the life's
// desks, given the same answers directly. Every name and number is made up.

// His yes to a suggestion he changed, given to the twin: asked first, then yes to what it showed.
function tellYes(desk: SetupDesk, step: SetupStep): void {
  const asked = tell(desk, step);
  if (asked.ok || asked.preview === undefined) throw new Error(`the twin did not ask first: ${JSON.stringify(asked)}`);
  const done = tell(desk, step, { confirmed: true, seen: asked.preview.key });
  if (!done.ok) throw new Error(done.why);
}

async function sheetClosed(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelector('dialog[open]') === null);
  await untilQuiet(page);
}

const ruleTexts = async (page: Page, within: string): Promise<string[]> => page.getByTestId(within).locator('[data-testid^="bank-rule-"]').allInnerTexts();

describe.each(ENGINES)('Bank rules in %s', (_name, engine) => {
  const { browser, base } = useEngine(engine);

  it('B226 a card payment still pending, read as a purchase, is pointed out with a rule for its wording; the others are not', async () => {
    const twin = twinOf('setup-pending-payment');
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-pending-payment', 'rules');
    const flagged = ready(twin).suggestions.filter((s) => s.pending !== null);
    expect(flagged.map((s) => [s.contains, s.pending?.description])).toEqual([['PAYMENT TO ACCT', 'PAYMENT TO ACCT #3333 ON 10/08 VIA WEB']]);
    const card = page.getByTestId(`suggestion-${flagged[0]?.id ?? ''}`);
    expect(await card.getByTestId('suggestion-pending').innerText()).toBe(
      'Pending now, and read as a purchase until a rule fits it: “PAYMENT TO ACCT #3333 ON 10/08 VIA WEB”, $60.00, Thu, Oct 8. This rule reads its wording, so the next one is read right too.',
    );
    expect(await card.innerText()).toContain('“PAYMENT TO ACCT”');
    expect(await page.getByTestId('suggestion-pending').count()).toBe(1);
  });

  it('20a every suggestion is the server\'s, with what it matches; add, skip, and change-first do what the twin does, and the transfers step follows the rules', async () => {
    const twin = twinOf('setup-suggest');
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-suggest', 'rules');
    const card = (contains: string) => page.locator('[data-testid^="suggestion-s-"]').filter({ hasText: `“${contains}”` });
    for (const s of ready(twin).suggestions) {
      const shown = page.getByTestId(`suggestion-${s.id}`);
      expect(await shown.getByTestId('matches-count').innerText(), s.contains).toBe(`It matches ${s.matches.count === 1 ? '1 item' : `${s.matches.count} items`} in your history.`);
      for (const e of s.matches.examples) expect(await shown.getByTestId(`match-${e.id}`).count(), e.id).toBe(1);
      expect(await shown.getByTestId('suggestion-status').innerText()).toBe('Not answered yet');
    }
    expect(await textAt(page, 'suggestions-left')).toBe(String(ready(twin).unansweredSuggestions));

    const id = (contains: string): string => ready(twin).suggestions.find((s) => s.contains === contains)?.id ?? '';
    // Added as it is.
    await card('Online Banking transfer from CHK 1111').getByTestId('suggestion-add').click();
    await card('Online Banking transfer from CHK 1111').getByTestId('suggestion-status').filter({ hasText: 'Your answer: added' }).waitFor();
    tell(twin, { suggestion: { id: id('Online Banking transfer from CHK 1111'), answer: 'add' } });
    await untilQuiet(page);
    // Skipped.
    await card('LATE FEE').getByTestId('suggestion-skip').click();
    await card('LATE FEE').getByTestId('suggestion-status').filter({ hasText: 'skipped' }).waitFor();
    tell(twin, { suggestion: { id: id('LATE FEE'), answer: 'skip' } });
    await untilQuiet(page);
    // One with the account to pick: Add waits; changed first, it asks with what it would match.
    expect(await card('Online payment to CRD 4444').getByTestId('suggestion-add').isDisabled()).toBe(true);
    await card('Online payment to CRD 4444').getByTestId('suggestion-change').click();
    await page.getByTestId('field-bank-other').selectOption('old-card');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('confirm-ask').waitFor();
    const rule: BankRuleSpec = { account: 'checking', contains: 'Online payment to CRD 4444', means: 'transfer', other: 'old-card' };
    const asked = tell(twin, { suggestion: { id: id('Online payment to CRD 4444'), answer: 'change', rule } });
    expect(await page.getByTestId('preview-matches').getByTestId('matches-count').innerText()).toBe(`It would have matched ${!asked.ok && asked.preview?.matches.count === 1 ? '1 item' : 'more'} in the last 90 days.`);
    await page.getByTestId('confirm-yes').click();
    await sheetClosed(page);
    tellYes(twin, { suggestion: { id: id('Online payment to CRD 4444'), answer: 'change', rule } });
    expect(await card('Online payment to CRD 4444').getByTestId('suggestion-status').innerText()).toBe('Your answer: added as you changed it');
    expect(await textAt(page, 'suggestions-left')).toBe(String(ready(twin).unansweredSuggestions));
    expect(await ruleTexts(page, 'setup-bank-rules')).toHaveLength(ready(twin).bankRules.length);

    // The transfers step reads the history with the rules as they are now.
    await page.getByTestId('next').click();
    await page.getByTestId('look-back').waitFor();
    await untilQuiet(page);
    expect(await page.getByTestId('rules-first').count()).toBe(1);
    const halves = await page.locator('[data-testid^="half-"]').evaluateAll((cards) => cards.map((c) => (c.getAttribute('data-testid') ?? '').replace('half-', '')));
    expect(halves).toEqual(ready(twin).halves.map((h) => h.id));
    expect(halves).toEqual(['su-sav-in', 'su-old-left', 'su-sav-landed']);
    await page.context().close();
  });

  it('24c a refusal says why, in the server\'s words, and changes nothing: the same rule twice', async () => {
    const twin = twinOf('setup-day');
    const page = await openSetup(await browser().newContext(phone()), base(), 'setup-day', 'rules');
    const before = await ruleTexts(page, 'setup-bank-rules');
    expect(before).toHaveLength(ready(twin).bankRules.length);
    await page.getByTestId('row-add-bank-rule').click();
    await page.getByTestId('field-bank-text').fill('zelle payment TO');
    await page.getByTestId('field-bank-means').selectOption('payment-to-person');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('sheet-problem').waitFor();
    expect(await textAt(page, 'sheet-problem')).toBe('You already have that rule. Nothing was changed.');
    await page.getByTestId('bank-rule-sheet').getByRole('button', { name: 'Close' }).click();
    await sheetClosed(page);
    expect(await ruleTexts(page, 'setup-bank-rules')).toEqual(before);
    await page.context().close();
  });

  it('section 2 24c 13.5 Settings: the list is the server\'s; a new rule asks first with what it would have matched lately; Back changes nothing; yes saves it and the change log says so first; removing asks first', async () => {
    const scenario = demoScenario('settings-busy');
    if (scenario === undefined) throw new Error('no life');
    const twin = demoBankRulesDesk(scenario, DEMO_TODAY, () => null);
    const page = await openScenario(await browser().newContext(phone()), base(), 'settings-busy', '/settings');
    // The numbers are in once openScenario returns, but WebKit may not have
    // drawn the list yet: wait for it before counting (it counted 0, Oct 9).
    await page.getByTestId('bank-rules-card').locator('[data-testid^="bank-rule-"]').first().waitFor();
    expect(await ruleTexts(page, 'bank-rules-card')).toHaveLength(twin.rules().length);

    const spec: BankRuleSpec = { account: 'checking', contains: 'ZELLE TO MADE UP', means: 'payment-to-person' };
    const preview = twin.preview({ add: spec });
    if ('why' in preview) throw new Error(preview.why);
    await page.getByTestId('row-add-bank-rule').click();
    await page.getByTestId('field-bank-text').fill(spec.contains);
    await page.getByTestId('field-bank-means').selectOption('payment-to-person');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('confirm-ask').waitFor();
    const count = preview.matches.count;
    expect(await page.getByTestId('preview-matches').getByTestId('matches-count').innerText()).toContain(`${count === 1 ? '1 item' : `${count} items`} in the last 90 days`);
    expect(await page.getByTestId('preview-matches').locator('[data-testid^="match-"]').count()).toBe(preview.matches.examples.length);
    // The rule before it ("ZELLE TO") reads them first: said in words.
    expect(preview.matches.readFirstByEarlier).toBe(count);
    expect(await textAt(page, 'matches-overlap')).toContain('read first by a bank rule before it');
    // Back: nothing changed.
    await page.getByTestId('confirm-cancel').click();
    await page.getByTestId('bank-rule-sheet').getByRole('button', { name: 'Close' }).click();
    await sheetClosed(page);
    expect(await ruleTexts(page, 'bank-rules-card')).toHaveLength(twin.rules().length);

    // Saved with his yes; the change log's newest line says so.
    await page.getByTestId('row-add-bank-rule').click();
    await page.getByTestId('field-bank-text').fill(spec.contains);
    await page.getByTestId('field-bank-means').selectOption('payment-to-person');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('confirm-yes').click();
    await sheetClosed(page);
    twin.apply({ add: spec });
    expect(await ruleTexts(page, 'bank-rules-card')).toHaveLength(twin.rules().length);
    expect(await page.getByTestId('log').locator('[data-testid^="log-"]').first().innerText()).toContain('Bank rule added');

    // Removing asks first, with what the rule reads.
    await page.getByTestId('bank-rule-bank-rule-3').click();
    await page.getByTestId('sheet-remove').click();
    await page.getByTestId('confirm-ask').waitFor();
    expect(await textAt(page, 'confirm-ask')).toContain('needs your OK first');
    await page.getByTestId('confirm-yes').click();
    await sheetClosed(page);
    twin.apply({ remove: 'bank-rule-3' });
    expect(await ruleTexts(page, 'bank-rules-card')).toHaveLength(twin.rules().length);
    expect(await page.getByTestId('bank-rule-bank-rule-3').count()).toBe(0);
    expect(await page.getByTestId('log').locator('[data-testid^="log-"]').first().innerText()).toContain('Bank rule removed');
    await page.context().close();
  });

  it('A27 13.5 Settings: a rule moves up or down only among the rules on its account; it asks first with what would change hands; yes moves it, as in the twin, and the log says so', async () => {
    const scenario = demoScenario('settings-busy');
    if (scenario === undefined) throw new Error('no life');
    const twin = demoBankRulesDesk(scenario, DEMO_TODAY, () => null);
    const page = await openScenario(await browser().newContext(phone()), base(), 'settings-busy', '/settings');
    const buttons = async (id: string): Promise<[number, number]> => {
      await page.getByTestId(`bank-rule-${id}`).click();
      await page.getByTestId('bank-rule-sheet').waitFor();
      const shown: [number, number] = [await page.getByTestId('sheet-move-up').count(), await page.getByTestId('sheet-move-down').count()];
      await page.getByTestId('bank-rule-sheet').getByRole('button', { name: 'Close' }).click();
      await sheetClosed(page);
      return shown;
    };
    // The first rule on checking can only go down; the only one on savings, nowhere; the last on the everyday card, only up.
    expect(await buttons('bank-rule-1')).toEqual([0, 1]);
    expect(await buttons('bank-rule-2')).toEqual([0, 0]);
    expect(await buttons('bank-rule-5')).toEqual([1, 0]);

    // A narrow rule added after a wide one, then moved ahead of it.
    const spec: BankRuleSpec = { account: 'checking', contains: 'ZELLE TO MADE UP', means: 'payment-to-person' };
    await page.getByTestId('row-add-bank-rule').click();
    await page.getByTestId('field-bank-text').fill(spec.contains);
    await page.getByTestId('field-bank-means').selectOption('payment-to-person');
    await page.getByTestId('sheet-save').click();
    await page.getByTestId('confirm-yes').click();
    await sheetClosed(page);
    const added = twin.apply({ add: spec });
    if (!added.ok) throw new Error(added.why);
    const id = added.done.rule.id;

    const preview = twin.preview({ move: { id, direction: 'up' } });
    if ('why' in preview || preview.move === undefined) throw new Error('the twin did not preview the move');
    await page.getByTestId(`bank-rule-${id}`).click();
    await page.getByTestId('sheet-move-up').click();
    await page.getByTestId('confirm-ask').waitFor();
    expect(await textAt(page, 'confirm-ask')).toBe('Moving a bank rule changes which rule reads what the bank sends from now on. It needs your OK first. Nothing was changed.');
    const lately = (n: number): string => (n === 1 ? '1 item' : `${n} items`);
    expect(await textAt(page, 'preview-move')).toBe(
      preview.move.switching === 0
        ? 'Nothing from the last 90 days fits both this rule and “ZELLE TO” on checking: a payment to a person, so nothing read lately would change.'
        : `It would read ${lately(preview.move.switching)} from the last 90 days that “ZELLE TO” on checking: a payment to a person reads now.`,
    );
    // Back: nothing moved.
    await page.getByTestId('confirm-cancel').click();
    await page.getByTestId('bank-rule-sheet').getByRole('button', { name: 'Close' }).click();
    await sheetClosed(page);
    // Each row is the twin's rule at that place, numbered.
    const inOrder = async (): Promise<boolean[]> => (await ruleTexts(page, 'bank-rules-card')).map((t, i) => t.startsWith(`${i + 1}.`) && t.includes(`“${twin.rules()[i]?.contains ?? ''}”`));
    expect(await inOrder()).toEqual(twin.rules().map(() => true));

    await page.getByTestId(`bank-rule-${id}`).click();
    await page.getByTestId('sheet-move-up').click();
    await page.getByTestId('confirm-yes').click();
    await sheetClosed(page);
    twin.apply({ move: { id, direction: 'up' } });
    expect(await inOrder()).toEqual(twin.rules().map(() => true));
    expect(twin.rules().map((r) => r.id).slice(0, 3)).toEqual(['bank-rule-1', 'bank-rule-2', id]);
    expect(await page.getByTestId('log').locator('[data-testid^="log-"]').first().innerText()).toContain('Bank rule moved up');
    expect(await page.getByTestId('log').locator('[data-testid^="log-"]').first().innerText()).toContain('now number 3, ahead of “ZELLE TO”');

    // And back down, past the same rule.
    await page.getByTestId(`bank-rule-${id}`).click();
    // It can still go up past the first rule on checking, or down past "ZELLE TO" again.
    expect(await page.getByTestId('sheet-move-up').count()).toBe(1);
    await page.getByTestId('sheet-move-down').click();
    await page.getByTestId('confirm-yes').click();
    await sheetClosed(page);
    twin.apply({ move: { id, direction: 'down' } });
    expect(await inOrder()).toEqual(twin.rules().map(() => true));
    expect(twin.rules().at(-1)?.id).toBe(id);
    expect(await page.getByTestId('log').locator('[data-testid^="log-"]').first().innerText()).toContain('Bank rule moved down');
    expect(await page.getByTestId('log').locator('[data-testid^="log-"]').first().innerText()).toContain('now number 6, after “ZELLE TO”');
    await page.context().close();
  });
});
