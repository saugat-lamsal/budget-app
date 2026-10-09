import type { Pot } from '@budget-app/money';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActivityView,
  BucketsView,
  ChoiceRequest,
  ChoiceResponse,
  HomeView,
  MoveRequest,
  MoveResponse,
  PaydayView,
  ReviewView,
  RuleRequest,
  RuleResponse,
  SettingsRequest,
  SettingsResponse,
  SettingsView,
  SetupRequest,
  SetupResponse,
  SetupView,
} from '@budget-app/server/views';

// The screens' numbers, from the server. The screens never work money out
// themselves: every amount comes from the money math on the server.

export type Load<T> = { readonly status: 'loading' } | { readonly status: 'error' } | { readonly status: 'ready'; readonly value: T };

// Each screen's numbers are read from its own address on the app's own server.
const READ = { cache: 'no-store', headers: { Accept: 'application/json' } } as const;
const READS = {
  '/api/home': () => fetch('/api/home', READ),
  '/api/buckets': () => fetch('/api/buckets', READ),
  '/api/review': () => fetch('/api/review', READ),
  '/api/payday': () => fetch('/api/payday', READ),
  '/api/settings': () => fetch('/api/settings', READ),
  '/api/setup': () => fetch('/api/setup', READ),
  '/api/activity/savings': () => fetch('/api/activity/savings', READ),
  '/api/activity/needs': () => fetch('/api/activity/needs', READ),
  '/api/activity/wants': () => fetch('/api/activity/wants', READ),
  '/api/activity/mom-reserve': () => fetch('/api/activity/mom-reserve', READ),
  '/api/activity/held-for-others': () => fetch('/api/activity/held-for-others', READ),
} as const;
// Each bucket's activity is read from its own address.
const ACTIVITY_URL: Readonly<Record<Pot, ViewUrl>> = {
  savings: '/api/activity/savings',
  needs: '/api/activity/needs',
  wants: '/api/activity/wants',
  momReserve: '/api/activity/mom-reserve',
  heldForOthers: '/api/activity/held-for-others',
};
type ViewUrl = keyof typeof READS;

async function fetchView<T extends { readonly state: string }>(url: ViewUrl): Promise<T> {
  const response = await READS[url]();
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const view = (await response.json()) as T;
  if (view.state !== 'tracking' && view.state !== 'not-set-up') throw new Error(`${url} sent something unexpected`);
  return view;
}

// 10.6: tells the server he has seen a take-back, so Home stops showing it
// (QUESTIONS.md B84). Changes no money.
export async function markTakeBackSeen(id: string): Promise<void> {
  const response = await fetch('/api/seen', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'bank-took-back', id }),
  });
  if (!response.ok) throw new Error(`marking it seen answered ${response.status}`);
}

// His choice for an item (waiting in review, or sorted already), a move of
// money between buckets by hand, or a change to the settings or a sorting
// rule. All go to the same address. The money math on the server decides; a
// refusal comes back as an answer with the reason (nothing was changed).
// Anything else, such as no signal, throws: the same request, with the same
// decision number, can be sent again and changes nothing twice. It changes
// the app's books, never the bank (0.4).
export async function sendChoice(request: ChoiceRequest): Promise<ChoiceResponse>;
export async function sendChoice(request: MoveRequest): Promise<MoveResponse>;
export async function sendChoice(request: SettingsRequest): Promise<SettingsResponse>;
export async function sendChoice(request: RuleRequest): Promise<RuleResponse>;
export async function sendChoice(request: SetupRequest): Promise<SetupResponse>;
export async function sendChoice(
  request: ChoiceRequest | MoveRequest | SettingsRequest | RuleRequest | SetupRequest,
): Promise<ChoiceResponse | MoveResponse | SettingsResponse | RuleResponse | SetupResponse> {
  const response = await fetch('/api/choice', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (response.status !== 200 && response.status !== 422) throw new Error(`sending the choice answered ${response.status}`);
  const answer = (await response.json()) as ChoiceResponse | MoveResponse | SettingsResponse | RuleResponse | SetupResponse;
  if (typeof answer !== 'object' || answer === null || typeof answer.ok !== 'boolean') throw new Error('the choice was answered with something unexpected');
  return answer;
}

// A new number for a decision, made once when it is made and kept for every
// retry of it. Random, but needs no secure connection (the demo runs over
// plain http on the home wifi).
export function newDecisionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// How long to wait for a screen's numbers before showing the error and Try
// again. Loading always ends: in the numbers or in the error.
export const TIME_LIMIT_MS = 15_000;

// Loads a screen's numbers, again when asked (Try again), and again when the
// app comes back after being in the background. One request at a time, and a
// request is never cancelled: WebKit on Linux was found (CI, Oct 7) to lose
// the answer to the request sent right after one it cancelled, which left
// Home loading for good. reload('after') is for after a choice: if a load is
// already on its way it may have been asked before the choice, so one more
// follows it. Nothing else is queued.
export type Reload = (when?: 'after') => void;

function useView<T extends { readonly state: string }>(url: ViewUrl): [Load<T>, Reload] {
  const [load, setLoad] = useState<Load<T>>({ status: 'loading' });
  const inFlight = useRef(false);
  const again = useRef(false);

  const start = useCallback<Reload>(
    (when) => {
      if (inFlight.current) {
        if (when === 'after') again.current = true;
        return;
      }
      inFlight.current = true;
      // Numbers already shown stay while they are fetched again.
      setLoad((current) => (current.status === 'ready' ? current : { status: 'loading' }));
      let settled = false;
      const settle = (next: Load<T>): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        inFlight.current = false;
        // What came back may have been asked before the choice went through,
        // so it is not shown: the answer to one more request is.
        if (again.current) {
          again.current = false;
          start();
          return;
        }
        setLoad(next);
      };
      // An answer that comes after the time limit is not shown; Try again asks again.
      const timer = setTimeout(() => settle({ status: 'error' }), TIME_LIMIT_MS);
      fetchView<T>(url).then(
        (value) => settle({ status: 'ready', value }),
        (error: unknown) => {
          console.error(error);
          settle({ status: 'error' });
        },
      );
    },
    [url],
  );

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

export const useHome = (): [Load<HomeView>, Reload] => useView<HomeView>('/api/home');
export const useBuckets = (): [Load<BucketsView>, Reload] => useView<BucketsView>('/api/buckets');
export const useReview = (): [Load<ReviewView>, Reload] => useView<ReviewView>('/api/review');
export const usePayday = (): [Load<PaydayView>, Reload] => useView<PaydayView>('/api/payday');
export const useSettings = (): [Load<SettingsView>, Reload] => useView<SettingsView>('/api/settings');
export const useSetup = (): [Load<SetupView>, Reload] => useView<SetupView>('/api/setup');
export const useActivity = (pot: Pot): [Load<ActivityView>, Reload] => useView<ActivityView>(ACTIVITY_URL[pot]);
