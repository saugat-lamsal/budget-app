import type { EvenPace, TrendsPeriod } from '@budget-app/server/views';
import { describe, expect, it } from 'vitest';
import { barWords, dayOfText, paceWords, partName, periodNote, periodRange, periodShort, placeGroupName, sinceText, usualLines } from '../src/screens/trends-text.js';

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
