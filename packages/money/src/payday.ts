import { assertCents, assertPositiveCents, percentOf, subtractCents, type Cents } from './cents.js';
import { addDays, assertIsoDate, dayOfWeek, daysBetween, lastDayOfMonth, monthOf, type IsoDate } from './dates.js';
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

export type PayScheduleSettings = Pick<Settings, 'paySchedule' | 'payScheduleDays'>;

// Section 2 (A48): twice a month, the 15th and the last day of the month;
// a Saturday or Sunday moves to the Friday before.
function onAWeekday(date: IsoDate): IsoDate {
  const day = dayOfWeek(date);
  return day === 6 ? addDays(date, -1) : day === 0 ? addDays(date, -2) : date;
}

function nextMonth(month: string): string {
  const [year = 0, m = 0] = month.split('-').map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
}

// The twice-a-month paydays in order, from the month before `date` on.
function* twiceAMonthFrom(date: IsoDate): Generator<IsoDate> {
  const [year = 0, m = 0] = monthOf(date).split('-').map(Number);
  let month = m === 1 ? `${year - 1}-12` : `${year}-${String(m - 1).padStart(2, '0')}`;
  for (;;) {
    yield onAWeekday(`${month}-15`);
    yield onAWeekday(lastDayOfMonth(month));
    month = nextMonth(month);
  }
}

// The paydays after the last paycheck, in order, without end. Every so many
// days: the last paycheck plus that many days at a time. Twice a month: the
// scheduled paydays after the one nearest the last paycheck (halfway
// between two counts as the earlier, a late paycheck), so a paycheck a few
// days early or late does not move the next one.
export function* paydaysAfter(lastPaycheckDate: IsoDate, schedule: number | PayScheduleSettings): Generator<IsoDate> {
  assertIsoDate(lastPaycheckDate, 'last paycheck date');
  const { paySchedule, payScheduleDays } = typeof schedule === 'number' ? { paySchedule: 'every-n-days', payScheduleDays: schedule } : schedule;
  if (paySchedule === 'every-n-days') {
    for (let payday = addDays(lastPaycheckDate, payScheduleDays); ; payday = addDays(payday, payScheduleDays)) yield payday;
  }
  const scheduled = twiceAMonthFrom(lastPaycheckDate);
  let before = scheduled.next().value as IsoDate;
  let after = scheduled.next().value as IsoDate;
  while (daysBetween(lastPaycheckDate, after) < 0) [before, after] = [after, scheduled.next().value as IsoDate];
  // before is the last scheduled payday before the paycheck, after the first on or after it.
  if (daysBetween(before, lastPaycheckDate) > daysBetween(lastPaycheckDate, after)) after = scheduled.next().value as IsoDate;
  for (;;) {
    yield after;
    after = scheduled.next().value as IsoDate;
  }
}

// 11.2: the next payday from the pay schedule, counted from the last
// paycheck, and the days to it from today. Once it has passed with no
// paycheck the days go negative instead of jumping ahead (B35).
export function nextPayday(lastPaycheckDate: IsoDate, schedule: number | PayScheduleSettings, today: IsoDate): { readonly nextPayday: IsoDate; readonly daysToPayday: number } {
  const next = paydaysAfter(lastPaycheckDate, schedule).next().value as IsoDate;
  return { nextPayday: next, daysToPayday: daysBetween(today, next) };
}
