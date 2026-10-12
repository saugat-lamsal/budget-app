import type { PushPayload } from '@budget-app/server/views';
import { pathOfRoute, routeOf } from '../app/routes.js';

// Phase 5, the phone: what the service worker (sw.ts) does with each push,
// kept apart from it so the made-up phone in the server's tests follows
// exactly the same rules (packages/server/test/fake-push-service.ts).
//
// - Each alert is shown with its id as its tag, its words, and when it was
//   due when it went late (10.8, B185).
// - The ids shown are remembered (the newest SHOWN_KEPT of them), and a push
//   with an id already shown is dropped: it is a try the server could not
//   mark as done (B181).
// - A push that cannot be read still shows something plain: WebKit requires
//   every push to show a notification, and may end a subscription whose
//   service worker shows nothing.
// - A tap opens the screen it is about, on the app's own address; anything
//   else opens Home.

export const SHOWN_KEPT = 500;

export interface Shown {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly screen: string;
}

// A push's data as the server sends it (push/push-sender.ts), or null when
// it is not that.
export function payloadOf(text: string | null): PushPayload | null {
  if (text === null || text.length > 4096) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { id, title, body, due, screen } = value as Record<string, unknown>;
  const text_ = (v: unknown, most: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= most;
  if (!text_(id, 300) || !text_(title, 200) || !text_(body, 1000) || !text_(screen, 200) || !(due === null || text_(due, 200))) return null;
  return { id, title, body, due, screen };
}

// What the phone shows for an alert: its words, then when it was due if it went late.
export function shownOf(p: PushPayload): Shown {
  return { title: p.title, body: p.due === null ? p.body : `${p.body} ${p.due}`, tag: p.id, screen: screenToOpen(p.screen) };
}

// Shown for a push that cannot be read.
export const UNREADABLE: Shown = { title: 'Budget', body: 'Something new. Open the app to see it.', tag: 'unreadable', screen: '/home' };

// What one push does, once it is known whether its id was shown before (the
// service worker finds out and notes it in one step): shown, or dropped as a
// repeat.
export function decide(p: PushPayload | null, shownBefore: boolean): { readonly show: Shown } | { readonly repeat: string } {
  if (p === null) return { show: UNREADABLE };
  if (shownBefore) return { repeat: p.id };
  return { show: shownOf(p) };
}

// The screen a tap opens: one of the app's own screens, or Home.
export function screenToOpen(screen: unknown): string {
  if (typeof screen !== 'string' || !screen.startsWith('/') || screen.startsWith('//')) return '/home';
  const route = routeOf(screen);
  return route === null ? '/home' : pathOfRoute(route);
}
