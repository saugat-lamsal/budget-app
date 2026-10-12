import type { BrowserContext, Page } from 'playwright';

// Phase 5, the phone, in the browser tests: browsers driven by Playwright
// cannot make a real push subscription (they have no push service to ask, and
// no person to ask for permission). So this stands in for exactly those
// browser parts, and nothing of the app's: the phone's permission question,
// the service worker's registration, and the push subscription, which is the
// test phone's (packages/server/test/fake-push-service.ts), with its real
// keys and its address at the made-up push service. Everything after that is
// real: the app's own code, the server, the web-push library, and the push
// service opening each alert with the phone's keys. What the stub was asked is
// kept for the test to read (pushAsked).
//
// The browser's state lives in sessionStorage (this tab only), so it lasts
// from page to page as a real subscription would. A phone that is not an
// app on the home screen has no push at all (as iPhone Safari is): no
// PushManager, and no Notification.

export type PhoneKind = 'home-screen' | 'safari-not-home-screen';
// What the phone answers when the app asks for permission.
export type Answer = 'granted' | 'denied' | 'default';

export interface StubPhone {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export interface PushAsked {
  // How many times the app asked the phone for permission.
  readonly permissionAsks: number;
  // The key the app subscribed with, as base64url.
  readonly subscribedWith: string | null;
  readonly registered: string | null;
}

declare global {
  interface Window {
    __pushAsked?: () => PushAsked;
  }
}

// Set up on a context before its pages open. Each page reads its kind of
// phone and its answer at load (setPushPhone).
export async function stubPush(context: BrowserContext, phone: StubPhone): Promise<void> {
  await context.addInitScript((p: StubPhone) => {
    if (location.protocol === 'about:') return;
    const w = window as unknown as Record<string, unknown>;
    const store = window.sessionStorage;
    const get = (name: string): string | null => store.getItem(`__push.${name}`);
    const set = (name: string, value: string | null): void => (value === null ? store.removeItem(`__push.${name}`) : store.setItem(`__push.${name}`, value));
    const kind = (get('kind') as PhoneKind | null) ?? 'home-screen';
    if (kind === 'safari-not-home-screen') {
      delete w['PushManager'];
      delete w['Notification'];
      return;
    }
    // An app on the home screen has them all; a browser built without them (WebKit as Playwright builds it) gets stand-ins.
    if (!('PushManager' in window)) w['PushManager'] = function PushManager(): void {};
    if (!('Notification' in window)) w['Notification'] = function Notification(): void {};
    if (navigator.serviceWorker === undefined) Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} });
    const permission = (): NotificationPermission => (get('permission') as NotificationPermission | null) ?? 'default';
    Object.defineProperty(Notification, 'permission', { configurable: true, get: permission });
    Notification.requestPermission = (async () => {
      set('asks', String(Number(get('asks') ?? '0') + 1));
      if (permission() === 'default') set('permission', get('answer') ?? 'granted');
      return permission();
    }) as typeof Notification.requestPermission;
    const subscription = {
      endpoint: p.endpoint,
      toJSON: () => ({ endpoint: p.endpoint, keys: p.keys }),
      unsubscribe: async () => {
        set('subscribed', null);
        return true;
      },
    };
    const toBase64url = (key: BufferSource): string => {
      const bytes = key instanceof ArrayBuffer ? new Uint8Array(key) : new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
      return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const pushManager = {
      subscribe: async (options: PushSubscriptionOptionsInit) => {
        if (permission() !== 'granted') throw new DOMException('not allowed', 'NotAllowedError');
        set('subscribedWith', options.applicationServerKey === undefined || options.applicationServerKey === null || typeof options.applicationServerKey === 'string' ? null : toBase64url(options.applicationServerKey));
        set('subscribed', '1');
        return subscription;
      },
      getSubscription: async () => (get('subscribed') === '1' ? subscription : null),
    };
    const registration = { pushManager, scope: `${location.origin}/` };
    const container = navigator.serviceWorker;
    container.register = (async (url: string | URL) => {
      set('registered', String(url));
      return registration;
    }) as unknown as typeof container.register;
    container.getRegistration = (async () => (get('registered') === null ? undefined : registration)) as unknown as typeof container.getRegistration;
    Object.defineProperty(container, 'ready', { configurable: true, get: () => Promise.resolve(registration) });
    window.__pushAsked = () => ({ permissionAsks: Number(get('asks') ?? '0'), subscribedWith: get('subscribedWith'), registered: get('registered') });
  }, phone);
}

// The kind of phone and its answer, for this tab from its next page on (the
// page must be on the app's address). permission: what the phone's settings
// say already; left out, it is as it was.
export async function setPushPhone(page: Page, kind: PhoneKind, answer: Answer = 'granted', permission?: NotificationPermission): Promise<void> {
  await page.evaluate(
    ([k, a, p]) => {
      sessionStorage.setItem('__push.kind', k);
      sessionStorage.setItem('__push.answer', a);
      if (p !== null) sessionStorage.setItem('__push.permission', p);
    },
    [kind, answer, permission ?? null] as const,
  );
}

export async function pushAsked(page: Page): Promise<PushAsked> {
  return page.evaluate(() => window.__pushAsked?.() ?? { permissionAsks: 0, subscribedWith: null, registered: null });
}
