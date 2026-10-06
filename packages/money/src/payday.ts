import { assertCents, assertPositiveCents, percentOf, subtractCents, type Cents } from './cents.js';
import type { Settings } from './settings.js';

export interface PaycheckSplit {
  readonly momReserve: Cents;
  readonly savings: Cents;
  readonly needs: Cents;
  readonly wants: Cents;
  // How the parts were worked out, for showing the steps.
  readonly detail: {
    // What came off the top for the reserve (never more than the paycheck).
    readonly reserveTaken: Cents;
    // The part of reserveTaken that did not fit under the cap.
    readonly overflowToSavings: Cents;
    // What was left to split by the percentages.
    readonly rest: Cents;
    readonly savingsShare: Cents;
    readonly roundingToSavings: Cents;
  };
}

export type SplitSettings = Pick<Settings, 'split' | 'momReservePerPaycheck' | 'momReserveCap'>;

// Rules 3.2 and 3.3. The mom reserve comes off first; whatever does not fit
// under the cap goes to savings. The rest is split by the percentages, each
// share rounded down, and the leftover cents go to savings. The parts always
// add up to the paycheck exactly.
export function splitPaycheck(amount: Cents, momReserveNow: Cents, settings: SplitSettings): PaycheckSplit {
  assertPositiveCents(amount, 'paycheck');
  assertCents(momReserveNow, 'mom reserve');
  const reserveTaken = Math.min(settings.momReservePerPaycheck, amount);
  const room = Math.max(0, subtractCents(settings.momReserveCap, momReserveNow));
  const toReserve = Math.min(reserveTaken, room);
  const overflowToSavings = reserveTaken - toReserve;
  const rest = amount - reserveTaken;
  const savingsShare = percentOf(rest, settings.split.savings);
  const needs = percentOf(rest, settings.split.needs);
  const wants = percentOf(rest, settings.split.wants);
  const roundingToSavings = rest - savingsShare - needs - wants;
  return {
    momReserve: toReserve,
    savings: overflowToSavings + savingsShare + roundingToSavings,
    needs,
    wants,
    detail: { reserveTaken, overflowToSavings, rest, savingsShare, roundingToSavings },
  };
}
