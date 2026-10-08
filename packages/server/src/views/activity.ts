import { MOVABLE_POTS, type Book, type BucketActivity, type Cents, type IsoDate, type Pot } from '@budget-app/money';

// What the screen for one bucket shows (QUESTIONS.md B97 to B102), worked out
// on the server from the book: what went in and out of it this pay period,
// each item with the choices for sorting it again. The screen only formats
// it: every number here comes from the money math, in whole cents, and is
// sent to the phone as JSON.

export interface ActivityInput {
  readonly today: IsoDate;
  // Null before setup day (section 14).
  readonly book: Book | null;
  readonly pot: Pot;
  // True only for the demo's made-up numbers, so the screen can say so.
  readonly madeUpData: boolean;
}

export type ActivityView =
  | { readonly state: 'not-set-up'; readonly madeUpData: boolean }
  | {
      readonly state: 'tracking';
      readonly madeUpData: boolean;
      readonly today: IsoDate;
      readonly pot: Pot;
      readonly activity: BucketActivity;
      // What every bucket holds now, for the form that moves money (13.3).
      readonly balances: Readonly<Record<Pot, Cents>>;
    };

export function activityView(input: ActivityInput): ActivityView {
  const { today, book, pot, madeUpData } = input;
  if (book === null) return { state: 'not-set-up', madeUpData };
  const pots = book.pots();
  const balances = Object.fromEntries(MOVABLE_POTS.map((p) => [p, pots[p]])) as Record<Pot, Cents>;
  return { state: 'tracking', madeUpData, today, pot, activity: book.activity(pot), balances };
}

// Each bucket's name in an address: /buckets/needs, /api/activity/needs.
// Must match packages/web/src/app/routes.ts (a test checks).
export const POT_SLUGS: Readonly<Record<string, Pot>> = Object.freeze({
  savings: 'savings',
  needs: 'needs',
  wants: 'wants',
  'mom-reserve': 'momReserve',
  'held-for-others': 'heldForOthers',
});

export function potOfSlug(slug: string): Pot | null {
  return Object.hasOwn(POT_SLUGS, slug) ? (POT_SLUGS[slug] ?? null) : null;
}

export function slugOfPot(pot: Pot): string {
  const found = Object.entries(POT_SLUGS).find(([, p]) => p === pot);
  if (found === undefined) throw new Error(`no address for ${pot}`);
  return found[0];
}
