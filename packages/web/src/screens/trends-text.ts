import type { EvenPace, PlaceGroup, TrendsPart, TrendsPeriod, Usual } from '@budget-app/server/views';
import type { IsoDate } from '@budget-app/money';
import type { IconName } from '../ui/Icon.js';
import { monthDay } from '../ui/dates.js';
import { moneyText, moneyWords } from '../ui/money-format.js';

// The Trends tab in words (rulebook section 40, QUESTIONS.md A58). Every
// amount and date comes from the server; these only say them, so what a
// bar's color shows is always also in words.

const PART_NAMES: Readonly<Record<TrendsPart, string>> = { needs: 'Needs', wants: 'Wants', 'old-card': 'Old card payment', unsorted: 'Unsorted' };

export function partName(part: TrendsPart): string {
  return PART_NAMES[part];
}

// "Sep 25 – Oct 8"
export function periodRange(p: TrendsPeriod): string {
  return `${monthDay(p.startDate)} – ${monthDay(p.lastDay)}`;
}

// Under its bar: "Sep 25", which its spoken label starts with.
export function periodShort(p: TrendsPeriod): string {
  return monthDay(p.startDate);
}

const BEFORE = { all: "Before setup day: read by today's rules", part: "Partly before setup day: read by today's rules" } as const;

// 40.1, 40.3: what is not a plain full pay period from the books says so.
export function periodNote(p: TrendsPeriod): string | null {
  const notes = [p.current ? 'So far' : null, p.cutOff ? 'Part of a pay period' : null, p.beforeSetup === 'none' ? null : BEFORE[p.beforeSetup]].filter((n): n is string => n !== null);
  return notes.length === 0 ? null : notes.join('. ');
}

// 40.4: everything a bar shows, in words, for a screen reader.
export function barWords(p: TrendsPeriod): string {
  const head = [`${periodRange(p)}${p.current ? ', so far' : ''}`, p.cutOff ? 'Part of a pay period' : null, p.beforeSetup === 'none' ? null : BEFORE[p.beforeSetup]].filter((n): n is string => n !== null).join('. ');
  const parts = (['needs', 'wants', 'old-card', 'unsorted'] as const).map((part) => `${PART_NAMES[part].toLowerCase()} ${moneyWords(p.spent[part])}`).join(', ');
  return `${head}. Spent ${moneyWords(p.total)}: ${parts}.`;
}

// 40.1: how far back it goes.
export function sinceText(historyFrom: IsoDate | null, setupDay: IsoDate): string {
  return `Since ${monthDay(historyFrom ?? setupDay)}`;
}

// 40.6
export function placeGroupName(g: PlaceGroup): string {
  return g.kind === 'place' ? g.name : g.kind === 'old-card' ? 'Old card payments' : 'Everything else';
}

// 40.7
export function usualLines(usual: Usual, day: number): readonly string[] {
  if (usual.state === 'not-enough') return ['Not enough pay periods yet to know your usual.', `It takes 3 full pay periods; there ${usual.fullPeriods === 1 ? 'is 1' : `are ${usual.fullPeriods}`} so far.`];
  const which = usual.periods % 2 === 1 ? `The middle one of your last ${usual.periods} full pay periods.` : `The middle of your last ${usual.periods} full pay periods.`;
  return [`Usual by day ${day}: ${moneyText(usual.byToday)}`, `A whole pay period usually: ${moneyText(usual.whole)}`, `${which} Old card payments are left out.`];
}

// 40.8: always the amount in words, with an icon, never color alone.
export function paceWords(pace: EvenPace): { readonly title: string; readonly tone: 'warning' | 'ok' | 'info'; readonly icon: IconName } {
  if (pace.state === 'none') return { title: 'No even pace: Wants started this pay period at $0.00 or below', tone: 'info', icon: 'info' };
  if (pace.difference < 0) return { title: `${moneyText(-pace.difference)} less left than an even pace`, tone: 'warning', icon: 'alert' };
  if (pace.difference > 0) return { title: `${moneyText(pace.difference)} more left than an even pace`, tone: 'ok', icon: 'check' };
  return { title: 'On an even pace', tone: 'ok', icon: 'check' };
}

export function dayOfText(day: number, days: number): string {
  return day > days ? `Day ${day}: the payday has passed` : `Day ${day} of ${days}`;
}
