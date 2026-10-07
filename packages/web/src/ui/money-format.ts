import { assertCents, formatDollars, type Cents } from '@budget-app/money';

// Money is written one way on every screen (design rules): dollars and
// cents with commas, and a real minus sign in front of a negative, so it is
// obvious without color. The digits line up because every amount is shown
// in tabular figures (blocks.css, .money).
export const MINUS = '−';

export function moneyText(cents: Cents): string {
  assertCents(cents);
  const plain = formatDollars(Math.abs(cents));
  return cents < 0 ? `${MINUS}${plain}` : plain;
}

// What a screen reader says for the same amount.
export function moneyWords(cents: Cents): string {
  assertCents(cents);
  const plain = formatDollars(Math.abs(cents));
  return cents < 0 ? `minus ${plain}` : plain;
}
