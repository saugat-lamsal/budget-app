import type { EvenPace, TrendsPeriod } from '@budget-app/server/views';
import { describe, expect, it } from 'vitest';
import {
  barWords,
  dayOfText,
  landingWords,
  mostWords,
  oldCardWords,
  paceWords,
  partName,
  paydayEffectWords,
  periodNote,
  periodRange,
  periodShort,
  placeGroupName,
  repeatWords,
  savingsWords,
  sinceText,
  streakWords,
  usualLines,
  waitingWords,
  weekdayName,
} from '../src/screens/trends-text.js';

// The Trends tab in words (section 40): every amount and date is the
// server's, put into words here so color is never the only signal. Every
// number is made up.

const period = (over: Partial<TrendsPeriod> = {}): TrendsPeriod => ({
  startDate: '2026-09-25',
  lastDay: '2026-10-08',
  current: false,
  cutOff: false,
  full: true,
  beforeSetup: 'none',
  spent: { needs: 7_850, wants: 3_300, 'old-card': 50_000, unsorted: 2_500 },
  total: 63_650,
  items: [],
  ...over,
});

describe('40.4 a pay period in words', () => {
  it('40.4 its days, its short label, and what it is', () => {
    expect(periodRange(period())).toBe('Sep 25 – Oct 8');
    expect(periodShort(period())).toBe('Sep 25');
    // What a bar shows is where its spoken label starts.
    expect(barWords(period()).startsWith(periodShort(period()))).toBe(true);
    expect(periodNote(period())).toBeNull();
    expect(periodNote(period({ current: true, full: false }))).toBe('So far');
    expect(periodNote(period({ cutOff: true, full: false }))).toBe('Part of a pay period');
    // 40.1: marked as read from the bank history.
    expect(periodNote(period({ beforeSetup: 'all' }))).toBe("Before setup day: read by today's rules");
    expect(periodNote(period({ beforeSetup: 'part', current: true, full: false }))).toBe("So far. Partly before setup day: read by today's rules");
    expect(periodNote(period({ beforeSetup: 'all', cutOff: true, full: false }))).toBe("Part of a pay period. Before setup day: read by today's rules");
  });

  it('40.2 40.4 a bar says every part with its amount, so a screen reader and the colors say the same', () => {
    expect(barWords(period({ current: true, full: false, beforeSetup: 'part' }))).toBe(
      "Sep 25 – Oct 8, so far. Partly before setup day: read by today's rules. Spent $636.50: needs $78.50, wants $33.00, old card payment $500.00, unsorted $25.00.",
    );
    // A negative part (money back) says minus.
    expect(barWords(period({ spent: { needs: 0, wants: -500, 'old-card': 0, unsorted: 0 }, total: -500 }))).toBe('Sep 25 – Oct 8. Spent minus $5.00: needs $0.00, wants minus $5.00, old card payment $0.00, unsorted $0.00.');
    expect(partName('old-card')).toBe('Old card payment');
    expect(partName('unsorted')).toBe('Unsorted');
  });

  it('40.1 since when Trends goes back', () => {
    expect(sinceText('2026-07-05', '2026-10-01')).toBe('Since Jul 5');
    expect(sinceText(null, '2026-10-01')).toBe('Since Oct 1');
  });
});

describe('40.6 the places in words', () => {
  it('40.6 a place by its name; the other two groups by what they are', () => {
    expect(placeGroupName({ kind: 'place', name: 'GREEN LEAF MARKET', amount: 9_600, items: [] })).toBe('GREEN LEAF MARKET');
    expect(placeGroupName({ kind: 'old-card', name: '', amount: 20_000, items: [] })).toBe('Old card payments');
    expect(placeGroupName({ kind: 'everything-else', name: '', amount: 3_975, items: [] })).toBe('Everything else');
  });
});

describe('40.7 your usual in words', () => {
  it('40.7 known: by today and a whole pay period; not yet: says so', () => {
    expect(usualLines({ state: 'known', periods: 5, byToday: 3_000, whole: 6_000 }, 12)).toEqual(['Usual by day 12: $30.00', 'A whole pay period usually: $60.00', 'The middle one of your last 5 full pay periods. Old card payments are left out.']);
    expect(usualLines({ state: 'known', periods: 4, byToday: 3_500, whole: 7_000 }, 1)).toEqual(['Usual by day 1: $35.00', 'A whole pay period usually: $70.00', 'The middle of your last 4 full pay periods. Old card payments are left out.']);
    expect(usualLines({ state: 'not-enough', fullPeriods: 2 }, 6)).toEqual(['Not enough pay periods yet to know your usual.', 'It takes 3 full pay periods; there are 2 so far.']);
  });
});

describe('40.8 Wants against an even pace in words', () => {
  const pace = (difference: number): EvenPace => ({ state: 'pace', points: [], today: 7_500, difference });

  it('40.8 less left, more left, or on an even pace, always with the amount and a word, not only a color', () => {
    expect(paceWords(pace(-4_210))).toEqual({ title: '$42.10 less left than an even pace', tone: 'warning', icon: 'alert' });
    expect(paceWords(pace(4_210))).toEqual({ title: '$42.10 more left than an even pace', tone: 'ok', icon: 'check' });
    expect(paceWords(pace(1))).toEqual({ title: '$0.01 more left than an even pace', tone: 'ok', icon: 'check' });
    expect(paceWords(pace(0))).toEqual({ title: 'On an even pace', tone: 'ok', icon: 'check' });
  });

  it('40.8 no even pace, and why', () => {
    expect(paceWords({ state: 'none', why: 'started-at-or-below-zero' })).toEqual({ title: 'No even pace: Wants started this pay period at $0.00 or below', tone: 'info', icon: 'info' });
  });

  it('40.8 the day of the pay period, and past payday', () => {
    expect(dayOfText(6, 8)).toBe('Day 6 of 8');
    expect(dayOfText(8, 8)).toBe('Day 8 of 8');
    expect(dayOfText(12, 8)).toBe('Day 12: the payday has passed');
  });
});

describe('40.10 to 40.13 Future in words, every amount marked Estimate', () => {
  it('40.11 where a bucket lands, the pace it comes from, and what is not counted', () => {
    const landing = { state: 'estimate', holds: 29_000, spentSoFar: 1_000, daysSoFar: 5, daysLeft: 3, pace: 600, lands: 28_400 } as const;
    expect(landingWords('Wants', landing)).toEqual({
      title: 'Estimate: Wants lands at about $284.00 by payday',
      detail: 'At this pay period’s pace: $10.00 spent in 5 days, 3 days left.',
      tone: 'ok',
      icon: 'check',
    });
    // Below zero says so in words, with an icon.
    expect(landingWords('Needs', { ...landing, lands: -1_200, daysLeft: 1, daysSoFar: 1 })).toMatchObject({ title: 'Estimate: Needs lands at about −$12.00 by payday, below zero', detail: 'At this pay period’s pace: $10.00 spent in 1 day, 1 day left.', tone: 'warning', icon: 'alert' });
    expect(landingWords('Wants', { state: 'too-early', holds: 29_000, daysSoFar: 2 })).toMatchObject({ title: 'Wants: too early in the pay period to tell', detail: 'An estimate comes on day 3.' });
    expect(landingWords('Wants', { state: 'payday-passed', holds: 29_000 })).toMatchObject({ title: 'Wants: no estimate, payday has passed with no paycheck' });
    expect(waitingWords(3_500)).toBe('Not counting $35.00 waiting in review.');
    expect(waitingWords(0)).toBeNull();
  });

  it('40.12 savings a year out, a range, or not enough yet', () => {
    const s = { state: 'estimate', now: 120_000, to: '2027-11-21', paydays: 26, periods: 4, least: 0, most: 325_000, low: 120_000, high: 8_570_000, points: [] } as const;
    expect(savingsWords(s)).toEqual(['Estimate: $1,200.00 to $85,700.00 by Nov 21, 2027', '26 paydays, each adding what a pay period added to savings lately: $0.00 to $3,250.00 (the last 4 pay periods). The mom reserve is not part of it.']);
    expect(savingsWords({ state: 'not-enough', now: 100, periods: 1 })).toEqual(['Not enough pay periods yet to estimate', 'It takes 3 pay periods since setup day; there is 1 so far.']);
    expect(savingsWords({ state: 'not-enough', now: 100, periods: 0 })[1]).toBe('It takes 3 pay periods since setup day; there are 0 so far.');
  });

  it('40.13 the old card\'s plan', () => {
    const plan = { state: 'plan', promoEndDate: '2027-03-31', perPayday: 41_250, paydaysLeft: 7, paidOffBy: '2027-03-31', points: [] } as const;
    expect(oldCardWords(plan)).toBe('Estimate, if each payday’s share is paid: paid off by Mar 31, 2027, at $412.50 a payday.');
    expect(oldCardWords({ state: 'no-promo-end-date' })).toBe('The plan starts once the promo end date is entered.');
    expect(oldCardWords({ state: 'paid-off' })).toBe('The old card is paid off.');
    expect(oldCardWords({ state: 'due-now', promoEndDate: '2026-10-09', owed: 280_000 })).toBe('No payday is left before the promo ends on Oct 9, 2026: all of it, $2,800.00, is due now.');
  });
});

describe('40.14 to 40.17 Habits in words', () => {
  const days = (perDay: number) => ({ days: 15, total: perDay * 15, perDay, items: [] });

  it('40.14 the payday effect', () => {
    expect(paydayEffectWords({ state: 'known', periods: 5, first: days(4_820), rest: days(3_175) })).toEqual([
      'Payday and the 2 days after: $48.20 a day',
      'The rest of the pay period: $31.75 a day',
      '$16.45 a day more just after payday, over your last 5 full pay periods.',
    ]);
    expect(paydayEffectWords({ state: 'known', periods: 3, first: days(100), rest: days(300) })[2]).toBe('$2.00 a day less just after payday, over your last 3 full pay periods.');
    expect(paydayEffectWords({ state: 'known', periods: 3, first: days(100), rest: days(100) })[2]).toBe('The same each day, over your last 3 full pay periods.');
    expect(paydayEffectWords({ state: 'not-enough', fullPeriods: 2 })).toEqual(['Not enough pay periods yet', 'It takes 3 full pay periods; there are 2 so far.']);
  });

  it('40.15 the busiest weekday, named in words', () => {
    expect(weekdayName(6)).toBe('Saturday');
    const day = (weekday: number, average: number) => ({ weekday, days: 13, total: average * 13, average, items: [] });
    expect(mostWords({ from: '2026-07-09', to: '2026-10-06', total: 0, days: [day(1, 0)], most: null })).toBe('Nothing spent in the last 90 days.');
    expect(mostWords({ from: '2026-07-09', to: '2026-10-06', total: 5_210, days: [day(6, 5_210)], most: 6 })).toBe('Most on Saturdays: $52.10 on an average Saturday.');
  });

  it('40.16 a repeat charge: how often, the next one and a year, both marked Estimate', () => {
    const r = { name: 'STREAMFLIX', every: 'month', newestDate: '2026-09-19', newestAmount: 1_649, next: '2026-10-19', perYear: 19_788, items: [] } as const;
    expect(repeatWords(r)).toEqual({ often: 'Every month', next: 'Next around Oct 19 (Estimate)', year: 'About $197.88 a year (Estimate)' });
    expect(repeatWords({ ...r, every: 'week' }).often).toBe('Every week');
    expect(repeatWords({ ...r, every: 'two-weeks' }).often).toBe('Every 2 weeks');
  });

  it('40.17 the Wants streak', () => {
    expect(streakWords({ ended: 5, current: 3, best: 4, lastOver: false })).toBe('Wants not overspent: 3 pay periods in a row. Best: 4.');
    expect(streakWords({ ended: 1, current: 1, best: 1, lastOver: false })).toBe('Wants not overspent: 1 pay period in a row. Best: 1.');
    expect(streakWords({ ended: 3, current: 0, best: 2, lastOver: true })).toBe('Wants went over last pay period. A new run starts with this one.');
    expect(streakWords({ ended: 0, current: 0, best: 0, lastOver: false })).toBe('No pay period has ended in the books yet.');
  });
});
