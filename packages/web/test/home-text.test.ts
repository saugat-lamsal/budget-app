import { describe, expect, it } from 'vitest';
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
  it('11.4 a paycheck says "Paycheck on its way"; other money "Money on its way in"; both say where and that it counts when it posts', () => {
    expect(onItsWayInText({ account: 'checking', amount: 180_000, date: '2026-10-02', paycheck: true })).toEqual({ title: 'Paycheck on its way', detail: 'To checking, counted when it posts' });
    expect(onItsWayInText({ account: 'savings', amount: 40_000, date: '2026-10-02', paycheck: true })).toEqual({ title: 'Paycheck on its way', detail: 'To savings, counted when it posts' });
    expect(onItsWayInText({ account: 'checking', amount: 2_500, date: '2026-10-02', paycheck: false })).toEqual({ title: 'Money on its way in', detail: 'To checking, counted when it posts' });
  });
});
