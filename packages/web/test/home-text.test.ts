import { describe, expect, it } from 'vitest';
import { cardsOffText } from '../src/screens/home-text.js';

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
