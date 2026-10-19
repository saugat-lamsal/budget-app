import type { AccountId, Cents, IsoDate } from '@budget-app/money';
import type { BankCheck } from './buckets.js';

// What the Trends tab shows (rulebook section 40, QUESTIONS.md A58), worked
// out on the server (src/trends.ts) from the books and the bank history the
// app keeps. The screen only formats it. Trends only reads: nothing here
// changes the books.

// 40.2: the parts of what was spent. A payment to the old card is its own
// part of needs; "unsorted" is spending still waiting in review (or, before
// setup day, what no rule sorts).
export type TrendsPart = 'needs' | 'wants' | 'old-card' | 'unsorted';
export const TRENDS_PARTS: readonly TrendsPart[] = Object.freeze(['needs', 'wants', 'old-card', 'unsorted'] as const);

export interface TrendsItem {
  // The book's id for it, or the bank's before setup day.
  readonly id: string;
  // The day it happened (4.1).
  readonly date: IsoDate;
  readonly description: string;
  readonly account: AccountId | null;
  readonly part: TrendsPart;
  // Spent: positive. Less what was refunded, so a refund can make it negative.
  readonly amount: Cents;
  // 40.1: read from the bank history by today's rules, not from the books.
  readonly beforeSetup: boolean;
}

export interface TrendsPeriod {
  readonly startDate: IsoDate;
  // Its last day: the day before the next one began. For the current pay
  // period, the day before the next payday (11.2), or today once that has passed.
  readonly lastDay: IsoDate;
  readonly current: boolean;
  // 40.3: the oldest, cut off by the start of the bank history ("Part of a pay period").
  readonly cutOff: boolean;
  // 40.3: ended and not cut off.
  readonly full: boolean;
  // 40.1: all of it from the bank history, part of it (the pay period setup
  // day fell in), or none of it.
  readonly beforeSetup: 'all' | 'part' | 'none';
  readonly spent: Readonly<Record<TrendsPart, Cents>>;
  readonly total: Cents;
  // Newest first. They add up to spent, part by part.
  readonly items: readonly TrendsItem[];
}

// 40.5: what the savings bucket and the mom reserve held, each its own amount.
export interface SavingsPoint {
  readonly date: IsoDate;
  // When tracking started, at the end of a pay period, or now.
  readonly at: 'start' | 'end' | 'now';
  readonly savings: Cents;
  readonly momReserve: Cents;
}

// 40.6: one place, the old card payments, or everything else.
export interface PlaceGroup {
  readonly kind: 'place' | 'old-card' | 'everything-else';
  // The place's name; empty for the other two.
  readonly name: string;
  readonly amount: Cents;
  // Newest first.
  readonly items: readonly TrendsItem[];
}

// 40.7: your usual by the same day of a pay period.
export type Usual =
  | { readonly state: 'known'; readonly periods: number; readonly byToday: Cents; readonly whole: Cents }
  | { readonly state: 'not-enough'; readonly fullPeriods: number };

// 40.8: what Wants held at the end of a day, or what an even pace leaves.
export interface DayPoint {
  readonly date: IsoDate;
  // Day 1 is the pay period's first day.
  readonly day: number;
  readonly left: Cents;
}

export type EvenPace =
  | {
      readonly state: 'pace';
      // Days 1 to D (and on to today, once the next payday has passed).
      readonly points: readonly DayPoint[];
      // What an even pace leaves at the end of today, and Wants against it: what
      // Wants holds now less that (negative: less left than an even pace).
      readonly today: Cents;
      readonly difference: Cents;
    }
  | { readonly state: 'none'; readonly why: 'started-at-or-below-zero' };

export interface WantsPace {
  // The books' pay period: day 1 is the day it began.
  readonly startDate: IsoDate;
  readonly nextPayday: IsoDate;
  // Today's day number, and D: the days from the first day to the day before the next payday.
  readonly day: number;
  readonly days: number;
  // 10.1: what Wants started the pay period with.
  readonly startedWith: Cents;
  // What Wants holds now: the line's last point.
  readonly left: Cents;
  // Days 1 to today.
  readonly line: readonly DayPoint[];
  readonly pace: EvenPace;
}

export interface TrendsNow {
  // 40.7: this pay period (40.3), and today's day number in it (payday is day 1).
  readonly startDate: IsoDate;
  readonly day: number;
  // So far this pay period, without old card payments.
  readonly spentSoFar: Cents;
  readonly usual: Usual;
  readonly wants: WantsPace;
}

export type TrendsView =
  | { readonly state: 'not-set-up'; readonly madeUpData: boolean }
  | {
      readonly state: 'tracking';
      readonly madeUpData: boolean;
      readonly today: IsoDate;
      readonly setupDay: IsoDate;
      // 40.1: the first day of the bank history kept from before setup day; null when there is none.
      readonly historyFrom: IsoDate | null;
      // 40.9: the same check as Home and Buckets.
      readonly check: BankCheck;
      // 40.4: each pay period in the last 90 days, and the current one, oldest first.
      readonly periods: readonly TrendsPeriod[];
      // 40.5: oldest first.
      readonly savings: readonly SavingsPoint[];
      // 40.6: the last 90 days.
      readonly places: { readonly from: IsoDate; readonly to: IsoDate; readonly total: Cents; readonly groups: readonly PlaceGroup[] };
      readonly now: TrendsNow;
    };
