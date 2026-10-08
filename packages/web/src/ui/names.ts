import type { Pot } from '@budget-app/money';

// What each bucket is called, everywhere.
export const POT_NAMES: Readonly<Record<Pot, string>> = {
  savings: 'Savings',
  needs: 'Needs',
  wants: 'Wants',
  momReserve: 'Mom reserve',
  heldForOthers: 'Held for others',
};
