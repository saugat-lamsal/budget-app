import { useCallback, useEffect, useState } from 'react';
import type { HomeView } from '@budget-app/server/views';

// Home's numbers, from the server. The screens never work money out
// themselves: every amount comes from the money math on the server.

export type Load<T> = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly value: T };

async function fetchHome(signal: AbortSignal): Promise<HomeView> {
  const response = await fetch('/api/home', { signal, cache: 'no-store', headers: { Accept: 'application/json' } });
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

// Loads Home's numbers, again when asked (Try again), and again whenever the
// app comes back to the front.
export function useHome(): [Load<HomeView>, () => void] {
  const [load, setLoad] = useState<Load<HomeView>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoad((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    fetchHome(controller.signal).then(
      (value) => setLoad({ status: 'ready', value }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error);
          setLoad({ status: 'error' });
        }
      },
    );
    return () => controller.abort();
  }, [attempt]);

  useEffect(() => {
    const onShow = (): void => {
      if (document.visibilityState === 'visible') retry();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [retry]);

  return [load, retry];
}
