import { useCallback, useEffect, useState, type PointerEvent } from 'react';

// Motion (redesign PR 2). Quick and precise: 200 to 300 ms, expo-out,
// entrances up to 600 ms, movements of 4 to 8 px, no bounce. These are the
// same numbers as tokens.css (--ease, --duration); the library needs them as
// numbers. Reduced motion turns every one of them off (MotionConfig in
// App.tsx, and base.css for the CSS ones).
export const EASE: readonly [number, number, number, number] = [0.16, 1, 0.3, 1];
export const QUICK_S = 0.25;
export const ENTRANCE_S = 0.6;

// The phone's reduced-motion setting, kept up to date. (Motion's own hook
// warns in the console when it is on, and the screens' tests count that.)
export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (): void => setReduced(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// How far through the pay period it is, 0 to 1, from whole days: the day it
// started, today, and the next payday. A late paycheck (today past the next
// payday) is a full ring; a pay period of no length is empty.
export function ringFraction(start: string, today: string, next: string): number {
  const total = daysBetween(start, next);
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, daysBetween(start, today) / total));
}

export function daysBetween(from: string, to: string): number {
  const day = (iso: string): number => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / 86_400_000;
  };
  return Math.round(day(to) - day(from));
}

// The light that follows a finger on a card (blocks.css .spot). It only
// sets two variables and a flag; it takes no tap and changes no number.
export function useSpotlight(): {
  readonly onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerLeave: (event: PointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: PointerEvent<HTMLElement>) => void;
} {
  const reduced = useReducedMotion();
  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      if (reduced) return;
      const el = event.currentTarget;
      const box = el.getBoundingClientRect();
      el.style.setProperty('--spot-x', `${Math.round(event.clientX - box.left)}px`);
      el.style.setProperty('--spot-y', `${Math.round(event.clientY - box.top)}px`);
      el.dataset['spot'] = 'on';
    },
    [reduced],
  );
  const off = useCallback((event: PointerEvent<HTMLElement>) => {
    delete event.currentTarget.dataset['spot'];
  }, []);
  return { onPointerMove, onPointerLeave: off, onPointerUp: off };
}
