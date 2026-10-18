import { describe, expect, it } from 'vitest';
import { SWIPE_COMMIT_PX, SWIPE_FLICK_PX, SWIPE_FLICK_SPEED, SWIPE_MAX_PX, hintLevel, limitSwipe, swipeOutcome } from '../src/ui/swipe.js';

// Redesign PR 3: when a swipe is a choice. Nothing here decides what a choice
// does; it only decides whether a drag was far enough, and in which
// direction one is allowed at all.

const BOTH = { right: true, left: true } as const;
const NONE = { right: false, left: false } as const;

describe('PR 3 swipeOutcome', () => {
  it('a drag past the commit distance to an allowed side is that side', () => {
    expect(swipeOutcome(SWIPE_COMMIT_PX + 1, 400, BOTH)).toBe('right');
    expect(swipeOutcome(-(SWIPE_COMMIT_PX + 1), 400, BOTH)).toBe('left');
  });

  it('exactly the commit distance is not far enough; one pixel more is', () => {
    expect(swipeOutcome(SWIPE_COMMIT_PX, 400, BOTH)).toBe('back');
    expect(swipeOutcome(-SWIPE_COMMIT_PX, 400, BOTH)).toBe('back');
    expect(swipeOutcome(SWIPE_COMMIT_PX + 1, 400, BOTH)).toBe('right');
  });

  it('a short drag goes back, and so does no drag at all', () => {
    expect(swipeOutcome(0, 400, BOTH)).toBe('back');
    expect(swipeOutcome(SWIPE_FLICK_PX, 10, BOTH)).toBe('back');
  });

  it('a quick flick over the flick distance counts; exactly at the distance or the speed does not', () => {
    const ms = (SWIPE_FLICK_PX + 1) / (SWIPE_FLICK_SPEED + 0.01);
    expect(swipeOutcome(SWIPE_FLICK_PX + 1, ms, BOTH)).toBe('right');
    expect(swipeOutcome(-(SWIPE_FLICK_PX + 1), ms, BOTH)).toBe('left');
    expect(swipeOutcome(SWIPE_FLICK_PX, SWIPE_FLICK_PX / (SWIPE_FLICK_SPEED + 0.01), BOTH)).toBe('back');
    expect(swipeOutcome(SWIPE_FLICK_PX + 1, (SWIPE_FLICK_PX + 1) / SWIPE_FLICK_SPEED, BOTH)).toBe('back');
  });

  it('a side that is not allowed never answers, however far or fast', () => {
    expect(swipeOutcome(500, 1, { right: false, left: true })).toBe('back');
    expect(swipeOutcome(-500, 1, { right: true, left: false })).toBe('back');
    expect(swipeOutcome(500, 1, NONE)).toBe('back');
    expect(swipeOutcome(-500, 1, NONE)).toBe('back');
  });

  it('a drag of no time at all does not divide by zero', () => {
    expect(swipeOutcome(SWIPE_FLICK_PX + 1, 0, BOTH)).toBe('right');
  });
});

describe('PR 3 limitSwipe', () => {
  it('follows the finger on an allowed side, up to the most it moves', () => {
    expect(limitSwipe(50, BOTH)).toBe(50);
    expect(limitSwipe(-50, BOTH)).toBe(-50);
    expect(limitSwipe(SWIPE_MAX_PX + 100, BOTH)).toBe(SWIPE_MAX_PX);
    expect(limitSwipe(-(SWIPE_MAX_PX + 100), BOTH)).toBe(-SWIPE_MAX_PX);
  });

  it('does not move at all toward a side that is not allowed', () => {
    expect(limitSwipe(80, { right: false, left: true })).toBe(0);
    expect(limitSwipe(-80, { right: true, left: false })).toBe(0);
  });
});

describe('PR 3 hintLevel', () => {
  it('fades in from nothing to full at the commit distance, either way', () => {
    expect(hintLevel(0)).toBe(0);
    expect(hintLevel(SWIPE_COMMIT_PX / 2)).toBe(0.5);
    expect(hintLevel(-SWIPE_COMMIT_PX / 2)).toBe(0.5);
    expect(hintLevel(SWIPE_COMMIT_PX)).toBe(1);
    expect(hintLevel(SWIPE_MAX_PX)).toBe(1);
  });
});
