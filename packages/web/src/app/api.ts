import { useCallback, useEffect, useRef, useState } from 'react';
import type { HomeView } from '@budget-app/server/views';

// Home's numbers, from the server. The screens never work money out
// themselves: every amount comes from the money math on the server.

export type Load<T> = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly value: T };

async function fetchHome(): Promise<HomeView> {
  const response = await fetch('/api/home', { cache: 'no-store', headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Home answered ${response.status}`);
  const view = (await response.json()) as HomeView;
  if (view.state !== 'tracking' && view.state !== 'not-set-up') throw new Error('Home sent something unexpected');
  return view;
}

// 10.6: tells the server he has seen a take-back, so Home stops showing it
// (QUESTIONS.md B84). The only thing the screens ever send; no money moves.
export async function markTakeBackSeen(id: string): Promise<void> {
  const response = await fetch('/api/seen', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'bank-took-back', id }),
  });
  if (!response.ok) throw new Error(`marking it seen answered ${response.status}`);
}

// How long to wait for Home's numbers before showing the error and Try again.
// Loading always ends: in the numbers or in the error.
export const TIME_LIMIT_MS = 15_000;

// Loads Home's numbers, again when asked (Try again), and again when the app
// comes back after being in the background. One request at a time, and a
// request is never cancelled: WebKit on Linux was found (CI, Oct 7) to lose
// the answer to the request sent right after one it cancelled, which left
// Home loading for good.
export function useHome(): [Load<HomeView>, () => void] {
  const [load, setLoad] = useState<Load<HomeView>>({ status: 'loading' });
  const inFlight = useRef(false);

  const start = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    // Numbers already shown stay while they are fetched again.
    setLoad((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    let settled = false;
    const settle = (next: Load<HomeView>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      inFlight.current = false;
      setLoad(next);
    };
    // An answer that comes after the time limit is not shown; Try again asks again.
    const timer = setTimeout(() => settle({ status: 'error' }), TIME_LIMIT_MS);
    fetchHome().then(
      (value) => settle({ status: 'ready', value }),
      (error: unknown) => {
        console.error(error);
        settle({ status: 'error' });
      },
    );
  }, []);

  useEffect(() => start(), [start]);

  useEffect(() => {
    // Only a real return from the background counts; a page that says it is
    // visible as it opens has not been away.
    let wasHidden = document.visibilityState === 'hidden';
    const onChange = (): void => {
      if (document.visibilityState === 'hidden') wasHidden = true;
      else if (wasHidden) {
        wasHidden = false;
        start();
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [start]);

  return [load, start];
}
