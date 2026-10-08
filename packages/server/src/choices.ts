import {
  ACCOUNTS,
  MoneyError,
  addCents,
  formatDollars,
  subtractCents,
  type AccountId,
  type Book,
  type Cents,
  type IsoDate,
  type LeftoverAnswer,
  type PickTo,
  type ReviewDetail,
  type ReviewOptions,
  type SortChoice,
  type SplitPart,
} from '@budget-app/money';
import type { ChoiceOf, ChoicePart, ChoiceRequest, ChoiceResponse, Done, RefusalCode } from './views/choice.js';

// How a tap reaches the books (Phase 4). The screen sends the choice it was
// offered; the money math decides. Three promises:
// - The same choice sent twice changes nothing the second time. Each choice
//   carries a decision number made once on the phone; a repeat of it gets
//   the first answer back. A different decision number for an item that is
//   no longer waiting finds it already dealt with.
// - A refused choice changes nothing (the book undoes anything half done)
//   and says why, in words.
// - Anything final asks first: it is not done without his OK in the request.

const PICKS: readonly PickTo[] = ['paycheck', 'other-income', 'savings', 'needs', 'wants', 'momReserve', 'not-mine', 'mom'];
const SPLIT_BUCKETS: readonly ChoicePart['bucket'][] = ['needs', 'wants', 'not-mine'];
const BUCKET_WORDS: Readonly<Record<string, string>> = { needs: 'Needs', wants: 'Wants', 'not-mine': 'Not mine', savings: 'Savings', momReserve: 'Mom reserve' };

const ID_FORMAT = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_ITEM_LENGTH = 200;
const MAX_TEXT_LENGTH = 200;

// ----- Reading what the phone sent -----

// The request, if it is exactly the right shape, otherwise null. Nothing is
// guessed or repaired.
export function parseChoiceRequest(value: unknown): ChoiceRequest | null {
  if (!isRecord(value) || !onlyKeys(value, ['id', 'item', 'choice', 'always', 'confirmed'])) return null;
  const { id, item, choice, always, confirmed } = value;
  if (typeof id !== 'string' || !ID_FORMAT.test(id)) return null;
  if (typeof item !== 'string' || item === '' || item.length > MAX_ITEM_LENGTH) return null;
  const parsed = parseChoice(choice);
  if (parsed === null) return null;
  let rule: { readonly contains: string } | undefined;
  if (always !== undefined) {
    if (!isRecord(always) || !onlyKeys(always, ['contains']) || typeof always['contains'] !== 'string') return null;
    const contains = always['contains'].trim();
    if (contains === '' || contains.length > MAX_TEXT_LENGTH) return null;
    rule = { contains };
  }
  if (confirmed !== undefined && typeof confirmed !== 'boolean') return null;
  return { id, item, choice: parsed, ...(rule === undefined ? {} : { always: rule }), ...(confirmed === undefined ? {} : { confirmed }) };
}

function parseChoice(value: unknown): ChoiceOf | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  if ('to' in value) return (PICKS as readonly unknown[]).includes(value['to']) ? { to: value['to'] as PickTo } : null;
  if ('transfer' in value) return (ACCOUNTS as readonly unknown[]).includes(value['transfer']) ? { transfer: value['transfer'] as AccountId } : null;
  if ('leftover' in value) return value['leftover'] === 'roll-over' || value['leftover'] === 'move-to-savings' ? { leftover: value['leftover'] } : null;
  if ('acknowledge' in value) return value['acknowledge'] === true ? { acknowledge: true } : null;
  if ('split' in value) return parseSplit(value['split']);
  if ('refundOf' in value) {
    const of = value['refundOf'];
    return typeof of === 'string' && of !== '' && of.length <= MAX_ITEM_LENGTH ? { refundOf: of } : null;
  }
  return null;
}

function parseSplit(value: unknown): ChoiceOf | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > SPLIT_BUCKETS.length) return null;
  const parts: ChoicePart[] = [];
  for (const part of value as unknown[]) {
    if (!isRecord(part) || !onlyKeys(part, ['bucket', 'amount'])) return null;
    const { bucket, amount } = part;
    if (!(SPLIT_BUCKETS as readonly unknown[]).includes(bucket)) return null;
    if (amount !== 'rest' && !(typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0)) return null;
    parts.push({ bucket: bucket as ChoicePart['bucket'], amount: amount as Cents | 'rest' });
  }
  if (new Set(parts.map((p) => p.bucket)).size !== parts.length) return null;
  if (parts.filter((p) => p.amount === 'rest').length > 1) return null;
  return { split: parts };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Every key present has a value, and none is outside the list.
function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key) && value[key] !== undefined);
}

// ----- The desk -----

export class ChoiceDesk {
  readonly #book: Book;
  readonly #today: () => IsoDate;
  // What each decision number did, for the repeats. Kept in memory here (the
  // demo); the real server keeps it with the book's history.
  readonly #done = new Map<string, { readonly fingerprint: string; readonly done: Done }>();

  constructor(book: Book, today: () => IsoDate) {
    this.#book = book;
    this.#today = today;
  }

  decide(request: ChoiceRequest): ChoiceResponse {
    const fingerprint = canonical(request);
    const earlier = this.#done.get(request.id);
    if (earlier !== undefined) {
      if (earlier.fingerprint === fingerprint) return { ok: true, replayed: true, done: earlier.done };
      return refuse('id-reused', 'That decision number was already used for a different choice.');
    }

    const details = this.#book.reviewDetails();
    const detail = details.find((d) => d.item.id === request.item);
    if (detail === undefined) return refuse('not-waiting', 'That one was already dealt with.');

    // Only what the rulebook gives for this kind of item.
    const notOffered = this.#notOffered(request, detail);
    if (notOffered !== null) return refuse('refused', notOffered);

    // Anything final asks first.
    if (isFinal(request, detail.options) && request.confirmed !== true) {
      return refuse('needs-confirmation', "This can't be undone here, so it needs your OK first.");
    }

    // "The rest" of a split is worked out by the money math, not the screen.
    let choice = request.choice;
    if ('split' in choice) {
      const resolved = resolveSplit(choice.split, detail);
      if (typeof resolved === 'string') return refuse('refused', resolved);
      choice = { split: resolved };
    }

    const before = new Set(this.#book.reviewItems().map((i) => i.id));
    let applied: Applied;
    try {
      applied = this.#apply(request, choice);
    } catch (error) {
      if (error instanceof MoneyError) return refuse('refused', explainRefusal(error, details));
      throw error;
    }
    const after = new Set(this.#book.reviewItems().map((i) => i.id));
    // 13.2: the other waiting items the new rule sorted.
    const alsoSorted = request.always === undefined ? 0 : [...before].filter((id) => id !== request.item && !after.has(id)).length;
    // A19: the ones it matched but left waiting, by name.
    const stillWaiting = applied.stillWaiting.map((id) => {
      const d = details.find((x) => x.item.id === id);
      return { item: id, name: d === undefined ? 'An item' : nameOf(d) };
    });
    const done: Done = { item: request.item, choice, alsoSorted, stillWaiting, sticks: applied.sticks };
    this.#done.set(request.id, { fingerprint, done });
    return { ok: true, replayed: false, done };
  }

  // The choice is one the money math offers for this item (review-options.ts).
  // The book still has the last word; this gives the plain reason up front.
  #notOffered(request: ChoiceRequest, detail: ReviewDetail): string | null {
    const c = request.choice;
    const options = detail.options;
    const no = "That isn't one of the choices for this item.";
    if ('leftover' in c) return options.type === 'leftover' && options.answers.includes(c.leftover) && request.always === undefined ? null : no;
    if ('acknowledge' in c) return options.type === 'acknowledge' && request.always === undefined ? null : no;
    if (options.type !== 'sort') return no;
    // A18: only one of the likely purchases offered, only for a refund, and
    // never by a rule.
    if ('refundOf' in c) {
      if (request.always !== undefined) return "A rule can't do that for this item.";
      if (detail.item.type !== 'money-in' || detail.item.reason !== 'refund') return no;
      return options.match.includes(c.refundOf) ? null : "That purchase isn't one this refund can belong to.";
    }
    const unavailable = options.unavailable.find((u) => ('to' in c && c.to === 'paycheck' && u.what === 'paycheck') || ('transfer' in c && u.what === 'transfer'));
    if (unavailable !== undefined) return unavailable.why;
    if ('to' in c) {
      if (!options.picks.some((p) => p.to === c.to)) return no;
      return request.always === undefined || options.always.includes(c.to) ? null : "A rule can't do that for this item.";
    }
    if (request.always !== undefined) return "A rule can't do that for this item.";
    if ('transfer' in c) return options.transfer.includes(c.transfer) ? null : no;
    if (options.split === null) return "This one can't be split.";
    return c.split.every((p) => options.split?.includes(p.bucket) === true) ? null : "This one can't be split that way.";
  }

  // Hands the choice to the money math. Returns whether "always do this"
  // will catch the next one (null when it was not asked for), and what the
  // rule left waiting.
  #apply(request: ChoiceRequest, choice: ChoiceOf): Applied {
    const book = this.#book;
    const today = this.#today();
    const item = request.item;
    const once: Applied = { sticks: null, stillWaiting: [] };
    if ('leftover' in choice) {
      book.answerLeftover(item, choice.leftover as LeftoverAnswer, today);
      return once;
    }
    if ('acknowledge' in choice) {
      book.acknowledge(item, today);
      return once;
    }
    const sort: SortChoice =
      'to' in choice
        ? { to: choice.to }
        : 'transfer' in choice
          ? { transfer: choice.transfer }
          : 'refundOf' in choice
            ? { refundOf: choice.refundOf }
            : { split: choice.split.map((p): SplitPart => ({ bucket: p.bucket, amount: p.amount as Cents })) };
    if (request.always === undefined) {
      book.sort(item, sort, today);
      return once;
    }
    // The rule's number comes from the decision number, so it is made once.
    return book.sortAlways(item, sort, { id: `always-${request.id}`, contains: request.always.contains }, today);
  }
}

interface Applied {
  readonly sticks: boolean | null;
  readonly stillWaiting: readonly string[];
}

function refuse(code: RefusalCode, why: string): ChoiceResponse {
  return { ok: false, code, why: `${why.replace(/\s*\.?\s*$/, '')}. Nothing was changed.` };
}

// 3.4, 6.1, 13.6: what cannot be taken back here asks first. A leftover
// answer cannot be asked again; "this is my paycheck" starts a pay period
// (B52); a rule keeps applying to everything that comes after; a refund
// matched to a purchase is matched for good, like one the bank matched (A18).
function isFinal(request: ChoiceRequest, options: ReviewOptions): boolean {
  const c = request.choice;
  if (request.always !== undefined || 'leftover' in c || 'refundOf' in c) return true;
  return options.type === 'sort' && 'to' in c && options.picks.some((p) => p.to === c.to && p.final);
}

// The parts of a split with "the rest" worked out, or the reason it cannot be.
function resolveSplit(parts: readonly ChoicePart[], detail: ReviewDetail): readonly ChoicePart[] | string {
  const net = detail.item.type === 'spending' ? detail.item.amount : 0;
  const rest = parts.find((p) => p.amount === 'rest');
  const known = addCents(0, ...parts.map((p) => (p.amount === 'rest' ? 0 : p.amount)));
  if (rest === undefined) {
    return known === net ? parts : `The parts add up to ${formatDollars(known)}, but this is ${formatDollars(net)}`;
  }
  const left = subtractCents(net, known);
  const word = BUCKET_WORDS[rest.bucket] ?? rest.bucket;
  if (left <= 0) {
    return left === 0
      ? `Nothing is left for ${word}: the other parts already add up to ${formatDollars(net)}`
      : `Nothing is left for ${word}: the other parts add up to ${formatDollars(known)}, more than the ${formatDollars(net)} to split`;
  }
  return parts.map((p) => (p.amount === 'rest' ? { bucket: p.bucket, amount: left } : p));
}

// A refusal from the money math in plain words: the ids of the items waiting
// are replaced with what they are, and a total too large to keep exact says so.
export function explainRefusal(error: MoneyError, details: readonly ReviewDetail[]): string {
  if (error.code === 'not-cents') return 'That would make a total too large to keep exact';
  let text = error.message;
  // The longest ids first, so one id inside another is not cut in two.
  for (const d of [...details].sort((a, b) => b.item.id.length - a.item.id.length)) {
    if (d.item.id.length < 4) continue;
    text = text.replace(new RegExp(`(?<![\\w:-])${escape(d.item.id)}(?![\\w:-])`, 'g'), () => `"${nameOf(d)}"`);
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function nameOf(d: ReviewDetail): string {
  const item = d.item;
  return item.type === 'leftover' ? `${BUCKET_WORDS[item.bucket] ?? item.bucket} leftover` : item.description;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The same request always gives the same text, whatever order its keys were
// written in, so a repeat is recognized.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
