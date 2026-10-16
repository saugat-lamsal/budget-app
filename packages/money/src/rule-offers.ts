import type { PickTo } from './review-options.js';
import type { SortingRule } from './rules.js';

// Rule 13.8 (QUESTIONS.md A55): the second time he sorts something from the
// same place the same way by hand, the app offers to make it a rule ("always
// do this", 13.6), with the place's name as its text. The name is the
// longest run of words in the description as it first showed up with no
// digits in them and none on most of his items of that kind on that account
// in the 90 days before (the same "most" as 4.5, A33). So a bank's
// "PURCHASE 10/11 GREEN LEAF MARKET" gives "GREEN LEAF MARKET": its dates and
// card digits would stop a rule from matching the next one.

// What the app offers to make a rule of: the kind of rule, its text, and
// where it would sort (what he picked).
export interface RuleOffer {
  readonly for: SortingRule['for'];
  readonly contains: string;
  readonly to: PickTo;
}

// A word as it is compared: its letters and digits, without case. A word of
// marks only ("-", "#", "*") is empty.
function bare(word: string): string {
  return word.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// The words on more than half of the descriptions, each counted once per
// description. A word with a digit in it is never part of a name, so never
// counted.
export function commonPlaceWords(descriptions: readonly string[]): ReadonlySet<string> {
  const count = new Map<string, number>();
  for (const description of descriptions) {
    const words = new Set(description.split(/\s+/).map(bare).filter((w) => w !== '' && !/\d/.test(w)));
    for (const word of words) count.set(word, (count.get(word) ?? 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n * 2 > descriptions.length).map(([word]) => word));
}

// The place's name in a description: its longest run of words (the first
// of two as long) that have no digit in them and are not common. Marks
// between the words stay as the bank wrote them; marks at the run's ends are
// left off. Null when no word is left.
export function placeName(description: string, common: ReadonlySet<string>): string | null {
  let best: { start: number; end: number; words: number } | null = null;
  let run: { start: number; end: number; words: number } | null = null;
  for (const match of description.matchAll(/\S+/g)) {
    const text = match[0];
    const at = match.index;
    const word = bare(text);
    if (/\d/.test(text) || common.has(word)) {
      run = null;
      continue;
    }
    // Marks only: inside a run they stay; they never start or end one.
    if (word === '') continue;
    if (run === null) run = { start: at, end: at + text.length, words: 1 };
    else {
      run.end = at + text.length;
      run.words += 1;
    }
    if (best === null || run.words > best.words) best = { ...run };
  }
  return best === null ? null : description.slice(best.start, best.end);
}
