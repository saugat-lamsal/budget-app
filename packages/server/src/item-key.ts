import type { ResortDetail, ReviewDetail } from '@budget-app/money';

// Step 3: a name for an item as a screen shows it (waiting in review, or on a
// bucket's list): what it is (its amount, its day, its description, pending or
// posted, for a payday question what it asks), where it is sorted now, and
// what "this is my paycheck" would do with it. The same item unchanged always
// gets the same key, and anything a sync changes about it gives a different
// one. The screens get it with their numbers and send it back with an answer
// (seen); the choice desk refuses an answer whose item is not that any more
// (choices.ts). What it is offered is left out: the desk refuses a choice that
// is not offered any more anyway, and a new purchase arriving must not refuse
// an answer about a refund whose likely purchases it joined.
//
// It only tells a change apart, so it needs no cryptography: FNV-1a, 64 bits,
// over the item written out the same way whatever order its keys are in.
// Nothing here uses Node, because the screens' views use it and the phone
// checks their types.

const OFFSET = 0xcbf29ce484222325n;
const PRIME = 0x100000001b3n;
const BITS = (1n << 64n) - 1n;

export function itemKey(detail: ReviewDetail | ResortDetail): string {
  const text = canonical(factsOf(detail));
  let hash = OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * PRIME) & BITS;
  }
  return hash.toString(16).padStart(16, '0');
}

function factsOf(detail: ReviewDetail | ResortDetail): unknown {
  if ('item' in detail) return { item: detail.item, account: detail.account, pending: detail.pending, paycheckPreview: detail.paycheckPreview };
  if (!detail.resortable) return detail;
  const { options: _options, likelyPurchases: _likely, ...facts } = detail;
  return facts;
}

// The same value always gives the same text, whatever order its keys were
// written in.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
