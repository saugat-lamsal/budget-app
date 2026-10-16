import { SHOWN_KEPT, decide, payloadOf, screenToOpen } from '../push/rules.js';
import { NO_ANSWER_MS, handlesNavigation, offlinePage, showOffline } from './offline.js';

// Phase 5, the phone's service worker, at /sw.js: notifications, and (0.8)
// the plain page when the app's server cannot be reached. It follows the
// rules in push/rules.ts (the made-up phone in the server's tests follows the
// same ones): each alert shown with its id as its tag, a repeat dropped, a tap
// opening the screen it is about.
//
// It never keeps or serves the app's numbers: it keeps no copy of anything
// the server sends. Every request a screen makes (its numbers, its answers)
// goes to the server as if it were not there; only opening a screen of the
// app passes through it, on to the server as it is, and when the server
// cannot be reached it answers with one fixed page instead (sw/offline.ts).
// The one thing it keeps on the phone is the ids of the newest alerts it has
// shown (10.12, QUESTIONS.md A42), never their words or amounts.

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 0.8 (QUESTIONS.md A57): opening a screen of the app goes on to the server
// as it is; when the server cannot be reached, the plain page. Anything else
// is left to the browser.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate' || !handlesNavigation(new URL(event.request.url), self.location.origin)) return;
  event.respondWith(openScreen(event.request));
});

async function openScreen(request: Request): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const noAnswer = new Promise<'no-answer'>((done) => {
    timer = setTimeout(() => done('no-answer'), NO_ANSWER_MS);
  });
  try {
    const answer = await Promise.race([fetch(request), noAnswer]);
    if (answer === 'no-answer') return offlinePage();
    return showOffline(answer) ? offlinePage() : answer;
  } catch {
    return offlinePage();
  } finally {
    clearTimeout(timer);
  }
}

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

// 10.12 (QUESTIONS.md A42): the ids it has shown, the newest SHOWN_KEPT, kept
// in its own storage (IndexedDB, which only it reads), so a repeat is dropped
// even after the phone stopped and started it again. Also, while it runs, in
// memory (two copies arriving at once), and the alerts still on the screen by
// their tag. If its storage cannot be used, the memory and the screen still
// count, and the alert still shows (WebKit: every push must show something).
const shown = new Set<string>();

// Notes the id as shown; false when it was shown before. Noted in memory
// before anything is awaited, so two copies arriving at once still show once.
async function claim(id: string): Promise<boolean> {
  if (shown.has(id)) return false;
  shown.add(id);
  if (shown.size > SHOWN_KEPT) {
    const oldest = shown.values().next();
    if (oldest.done !== true) shown.delete(oldest.value);
  }
  try {
    if (await keptBefore(id)) return false;
  } catch {
    // Its storage could not be used: the screen still counts.
  }
  const still = await self.registration.getNotifications({ tag: id });
  return still.length === 0;
}

const STORE = 'shown';

function openShown(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = self.indexedDB.open('budget-alerts-shown', 1);
    request.onupgradeneeded = () => {
      // Each id once, in the order shown (the key counts up).
      request.result.createObjectStore(STORE, { autoIncrement: true }).createIndex('id', 'id', { unique: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('could not open'));
  });
}

// In one step: true when the id is kept already; otherwise kept now, and the
// oldest dropped past SHOWN_KEPT.
async function keptBefore(id: string): Promise<boolean> {
  const db = await openShown();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let before = false;
      const found = store.index('id').getKey(id);
      found.onsuccess = () => {
        if (found.result !== undefined) {
          before = true;
          return;
        }
        store.add({ id });
        const count = store.count();
        count.onsuccess = () => {
          let extra = count.result - SHOWN_KEPT;
          if (extra <= 0) return;
          const cursor = store.openCursor();
          cursor.onsuccess = () => {
            const at = cursor.result;
            if (at === null || extra <= 0) return;
            at.delete();
            extra -= 1;
            at.continue();
          };
        };
      };
      tx.oncomplete = () => resolve(before);
      tx.onerror = () => reject(tx.error ?? new Error('could not keep'));
      tx.onabort = () => reject(tx.error ?? new Error('could not keep'));
    });
  } finally {
    db.close();
  }
}
