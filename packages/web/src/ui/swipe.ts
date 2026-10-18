// Swipe to sort (redesign PR 3). Only the shape of a drag lives here: how far
// it went, how fast, and which side may answer at all. What a swipe does is
// what the matching button does, through the same call (blocks.tsx SwipeSort).

export const SWIPE_COMMIT_PX = 96;
export const SWIPE_FLICK_PX = 40;
export const SWIPE_FLICK_SPEED = 0.6;
export const SWIPE_MAX_PX = 140;

export interface Sides {
  readonly right: boolean;
  readonly left: boolean;
}

export type SwipeOutcome = 'right' | 'left' | 'back';

// Farther than the commit distance, or a quick flick over the flick distance
// (as with a sheet), toward a side that may answer. Anything else goes back.
export function swipeOutcome(dx: number, ms: number, sides: Sides): SwipeOutcome {
  const side: 'right' | 'left' = dx > 0 ? 'right' : 'left';
  if (!sides[side]) return 'back';
  const far = Math.abs(dx);
  const speed = far / Math.max(1, ms);
  return far > SWIPE_COMMIT_PX || (far > SWIPE_FLICK_PX && speed > SWIPE_FLICK_SPEED) ? side : 'back';
}

// How far the card moves with the finger: not at all toward a side that may
// not answer, and never past the most.
export function limitSwipe(dx: number, sides: Sides): number {
  if ((dx > 0 && !sides.right) || (dx < 0 && !sides.left)) return 0;
  return Math.max(-SWIPE_MAX_PX, Math.min(SWIPE_MAX_PX, dx));
}

// The hint words fade in as the card is dragged: 0 at rest, 1 at the commit distance.
export function hintLevel(dx: number): number {
  return Math.min(1, Math.abs(dx) / SWIPE_COMMIT_PX);
}
