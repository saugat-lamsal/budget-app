import { SHOWN_KEPT, decide, payloadOf, screenToOpen } from '../push/rules.js';

// Phase 5, the phone's service worker, at /sw.js: notifications only. It
// follows the rules in push/rules.ts (the made-up phone in the server's tests
// follows the same ones): each alert shown with its id as its tag, a repeat
// dropped, a tap opening the screen it is about.
//
// It never keeps or serves the app's numbers: it has no fetch handler, so
// every request the app makes goes to the server as if it were not there, and
// it keeps nothing on the phone (only, while it runs, the ids of the alerts
// it has shown, never their words).

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  event.waitUntil(onPush(event.data?.text() ?? null));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  event.waitUntil(open(screenToOpen(typeof data === 'object' && data !== null ? (data as { screen?: unknown }).screen : undefined)));
});

async function onPush(text: string | null): Promise<void> {
  const p = payloadOf(text);
  const shownBefore = p === null ? false : !(await claim(p.id));
  const d = decide(p, shownBefore);
  if ('repeat' in d) return;
  await self.registration.showNotification(d.show.title, { body: d.show.body, tag: d.show.tag, data: { screen: d.show.screen } });
}

// The app open already: brought forward, at that screen. Otherwise opened there.
async function open(screen: string): Promise<void> {
  const url = new URL(screen, self.location.origin).href;
  const windows = await self.clients.matchAll({ type: 'window' });
  for (const w of windows) {
    if (new URL(w.url).origin !== self.location.origin) continue;
    try {
      const focused = await w.focus();
      await focused.navigate(url);
      return;
    } catch {
      // Not one it can move: a new one instead.
    }
  }
  await self.clients.openWindow(url);
}

// ----- The ids shown -----

// The ids it has shown while it runs (the newest SHOWN_KEPT), and, after the
// phone stopped and started it again, the alerts still on the screen, by
// their tag. Nothing is kept on the phone (the screens' rule 0.4 test: no
// storage at all), so a repeat after a restart, of an alert he has already
// swiped away, shows again (QUESTIONS.md A42 asks about keeping the ids).
const shown = new Set<string>();

// Notes the id as shown; false when it was shown before. Noted before the
// look at the screen, so two copies arriving at once still show once.
async function claim(id: string): Promise<boolean> {
  if (shown.has(id)) return false;
  shown.add(id);
  if (shown.size > SHOWN_KEPT) {
    const oldest = shown.values().next();
    if (oldest.done !== true) shown.delete(oldest.value);
  }
  const still = await self.registration.getNotifications({ tag: id });
  return still.length === 0;
}
