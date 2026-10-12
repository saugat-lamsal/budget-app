import type { PushAnswer, PushOnRequest } from '@budget-app/server/views';
import { pushSend } from './api.js';

// Phase 5, the phone: this device's notifications, from the browser's side.
// The server keeps which devices have them on (Settings' Notifications card
// reads it); this asks the browser what it can do, and turns them on or off
// here. Permission is asked only from his tap (iPhone allows nothing else).
// The service worker (/sw.js) is registered only when he turns them on.

export type Support =
  | 'yes'
  // iPhone and iPad send notifications only to an app opened from the home screen.
  | 'home-screen-first'
  // Notifications need the app's secure address (https), which comes with hosting.
  | 'not-secure'
  | 'not-this-browser';

function appleTouchDevice(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function fromHomeScreen(): boolean {
  return (navigator as { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

export function support(): Support {
  if (!window.isSecureContext) return 'not-secure';
  if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'yes';
  return appleTouchDevice() && !fromHomeScreen() ? 'home-screen-first' : 'not-this-browser';
}

// What the phone's own settings say: not asked yet, allowed, or blocked.
export function permission(): NotificationPermission {
  return 'Notification' in window ? Notification.permission : 'default';
}

// The address this browser's push subscription has, if it has one.
export async function browserEndpoint(): Promise<string | null> {
  if (support() !== 'yes') return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  return subscription?.endpoint ?? null;
}

// The server's key, as base64url (from the Settings view), as the bytes the push service wants.
function keyBytes(publicKey: string): Uint8Array<ArrayBuffer> {
  const base64 = publicKey.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export type TurnedOn = { readonly ok: true } | { readonly ok: false; readonly blocked: boolean; readonly why: string };

// From his tap only: asks the phone first (before anything else, so the tap
// still counts), then subscribes with the server's key and tells the server.
export async function turnOn(publicKey: string): Promise<TurnedOn> {
  const asked = await Notification.requestPermission();
  if (asked !== 'granted') return { ok: false, blocked: asked === 'denied', why: asked === 'denied' ? 'The phone did not allow them.' : 'They were not allowed yet.' };
  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const options = { userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) };
  let subscription: PushSubscription;
  try {
    subscription = await registration.pushManager.subscribe(options);
  } catch (error) {
    // One made with another key (the server's keys changed): replaced.
    const old = await registration.pushManager.getSubscription();
    if (old === null) throw error;
    await old.unsubscribe();
    subscription = await registration.pushManager.subscribe(options);
  }
  const json = subscription.toJSON();
  const request: PushOnRequest = { endpoint: subscription.endpoint, keys: { p256dh: json.keys?.['p256dh'] ?? '', auth: json.keys?.['auth'] ?? '' } };
  const answer = await pushSend('/api/push/on', request);
  return answer.ok ? { ok: true } : { ok: false, blocked: false, why: answer.why };
}

// Off here: the server forgets this device first, then the browser its subscription.
export async function turnOff(): Promise<PushAnswer> {
  const answer = await pushSend('/api/push/off', {});
  if (answer.ok && support() === 'yes') {
    const registration = await navigator.serviceWorker.getRegistration('/');
    await (await registration?.pushManager.getSubscription())?.unsubscribe();
  }
  return answer;
}

export function sendTestAlert(): Promise<PushAnswer> {
  return pushSend('/api/push/test', {});
}
