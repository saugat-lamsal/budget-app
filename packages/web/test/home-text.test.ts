import { describe, expect, it } from 'vitest';
import type { OnItsWayIn } from '@budget-app/server/views';
import { cardsOffText, onItsWayInText } from '../src/screens/home-text.js';

// Words on Home (and Settings) for a card whose reminders are off (9.8,
// QUESTIONS.md A52, A53). The words are the rulebook's: "Card reminders are off for
// the old card: the bank did not send its statement date."
describe('9.8 a card whose reminders are off', () => {
  it('9.8 says which card, and why, with what to do when there is something to do', () => {
    expect(cardsOffText({ card: 'old-card', why: 'no-statement-date' })).toEqual({
      title: 'Card reminders are off for the old card',
      detail: 'The bank did not send its statement date. Enter the day its statement closes in Settings.',
    });
    expect(cardsOffText({ card: 'everyday-card', why: 'no-statement-date' }).title).toBe('Card reminders are off for the everyday card');
    expect(cardsOffText({ card: 'everyday-card', why: 'unreadable' })).toEqual({
      title: 'Card reminders are off for the everyday card',
      detail: 'The bank sent a statement for it that cannot be read.',
    });
  });
});

// 11.4 (A56): money still pending in, in the rulebook's words.
describe('11.4 money on its way in', () => {
  const zone = 'America/New_York';
  const row = (extra: Partial<OnItsWayIn>): OnItsWayIn => ({ account: 'checking', amount: 180_000, date: '2026-10-02', paycheck: true, since: { day: '2026-10-02' }, usually: null, ...extra });

  it('11.4 a paycheck says "Paycheck on its way"; other money "Money on its way in"; both say where and that it counts when it posts', () => {
    expect(onItsWayInText(row({}), '2026-10-02', zone).title).toBe('Paycheck on its way');
    expect(onItsWayInText(row({ paycheck: false }), '2026-10-02', zone).title).toBe('Money on its way in');
    expect(onItsWayInText(row({ account: 'savings' }), '2026-10-02', zone).detail).toMatch(/^To savings, counted when it posts\. /);
    expect(onItsWayInText(row({}), '2026-10-02', zone).detail).toMatch(/^To checking, counted when it posts\. /);
  });

  it('11.4 A57 pending since when the app first saw it: the time today, the day and time before today; the day the bank dated it when the time is not known', () => {
    expect(onItsWayInText(row({ since: { at: '2026-10-02T06:12:00-04:00' } }), '2026-10-02', zone).detail).toBe('To checking, counted when it posts. Pending since 6:12 AM.');
    expect(onItsWayInText(row({ since: { at: '2026-10-01T18:40:00-04:00' } }), '2026-10-02', zone).detail).toBe('To checking, counted when it posts. Pending since Thu, Oct 1, 6:40 PM.');
    expect(onItsWayInText(row({ since: { day: '2026-10-01' } }), '2026-10-02', zone).detail).toBe('To checking, counted when it posts. Pending since Thu, Oct 1.');
  });

  it('11.4 A57 usually posts within, in hours or days, only when the server has the figure', () => {
    const since = { at: '2026-10-02T06:12:00-04:00' };
    expect(onItsWayInText(row({ since, usually: { within: 9, unit: 'hours' } }), '2026-10-02', zone).detail).toBe('To checking, counted when it posts. Pending since 6:12 AM. Usually posts within 9 hours.');
    expect(onItsWayInText(row({ since, usually: { within: 1, unit: 'hours' } }), '2026-10-02', zone).detail).toBe('To checking, counted when it posts. Pending since 6:12 AM. Usually posts within 1 hour.');
    expect(onItsWayInText(row({ since, usually: { within: 3, unit: 'days' } }), '2026-10-02', zone).detail).toBe('To checking, counted when it posts. Pending since 6:12 AM. Usually posts within 3 days.');
  });
});
