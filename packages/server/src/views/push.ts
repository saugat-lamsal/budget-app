import type { IsoDate } from '@budget-app/money';

// Phase 5, the phone: what the Notifications card on Settings is told about
// the device asking, and what one push carries. Types only; the phone shares
// them, and so does its service worker.

export type PushView =
  // The server has no push keys (VAPID_* in .env; npm run push-keys makes a
  // pair): it writes each alert in its own window instead.
  | { readonly state: 'no-keys' }
  | {
      readonly state: 'ready';
      // The app's public push key, for the device's push service
      // (applicationServerKey). The private one never leaves the server.
      readonly publicKey: string;
      // This device: on, with the address its push service gave and since
      // when; or off, and, if its push service stopped taking them, when and why.
      readonly thisDevice: { readonly on: true; readonly endpoint: string; readonly since: IsoDate } | { readonly on: false; readonly stopped: { readonly date: IsoDate; readonly why: string } | null };
      // How many devices have them on, this one too.
      readonly devices: number;
    };

// What the phone sends when he turns them on: its push subscription
// (PushSubscription.toJSON(), the address and the device's public keys).
export interface PushOnRequest {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export type PushAnswer = { readonly ok: true } | { readonly ok: false; readonly why: string };

// One push, as the server sends it (push/push-sender.ts) and the phone's
// service worker reads it (packages/web/src/push/rules.ts).
export interface PushPayload {
  // The alert's id: the notification's tag, and how a repeat is known.
  readonly id: string;
  readonly title: string;
  readonly body: string;
  // Sent late: when it was due ("Was due 3:10 AM."); null otherwise (B185).
  readonly due: string | null;
  // The screen a tap opens, one of the app's own addresses.
  readonly screen: string;
}
