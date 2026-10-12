import type { IsoDate } from '@budget-app/money';
import type { PushView } from '@budget-app/server/views';
import type { Support } from '../app/push.js';
import { shortDate } from '../ui/dates.js';

// Settings' Notifications card (Phase 5), in words: what the server says
// about this device, and what this browser can do, as one state. Nothing here
// touches the browser; the card hands in what it found.

export interface DeviceFacts {
  readonly support: Support;
  // What the phone's own settings say: not asked yet, allowed, or blocked.
  readonly permission: NotificationPermission;
  // The address of this browser's push subscription, if it has one.
  readonly endpoint: string | null;
}

export type CardState =
  // Still asking the browser.
  | { readonly kind: 'checking' }
  // The server has no push keys.
  | { readonly kind: 'no-keys' }
  | { readonly kind: 'home-screen-first' }
  | { readonly kind: 'not-secure' }
  | { readonly kind: 'not-this-browser' }
  | { readonly kind: 'blocked' }
  | { readonly kind: 'on'; readonly since: IsoDate; readonly devices: number }
  | { readonly kind: 'off'; readonly stopped: { readonly date: IsoDate } | null; readonly devices: number };

export function cardState(view: PushView, facts: DeviceFacts | null): CardState {
  if (view.state === 'no-keys') return { kind: 'no-keys' };
  if (facts === null) return { kind: 'checking' };
  if (facts.support !== 'yes') return { kind: facts.support };
  if (facts.permission === 'denied') return { kind: 'blocked' };
  const d = view.thisDevice;
  // On only when the server and this browser agree: the same subscription, and allowed.
  if (d.on && facts.permission === 'granted' && facts.endpoint === d.endpoint) return { kind: 'on', since: d.since, devices: view.devices };
  return { kind: 'off', stopped: !d.on && d.stopped !== null ? { date: d.stopped.date } : null, devices: d.on ? view.devices - 1 : view.devices };
}

const others = (n: number): string => (n === 0 ? '' : n === 1 ? ' 1 other device gets them.' : ` ${n} other devices get them.`);

// The row's title and the line under it.
export function cardWords(state: CardState): { readonly title: string; readonly detail: string } {
  switch (state.kind) {
    case 'checking':
      return { title: 'Checking this phone', detail: 'A moment.' };
    case 'no-keys':
      return { title: 'Not set up on the server', detail: 'The server has no push keys yet, so it writes each alert in its own window instead.' };
    case 'home-screen-first':
      return { title: 'Open the app from the home screen first', detail: 'iPhone sends notifications only to apps added to the home screen. In Safari: Share, then Add to Home Screen.' };
    case 'not-secure':
      return { title: 'Not on this address', detail: "Notifications need the app's secure address (https). They work once the app is hosted." };
    case 'not-this-browser':
      return { title: "This browser can't show them", detail: "Use the app from your iPhone's home screen." };
    case 'blocked':
      return { title: "Blocked in the phone's settings", detail: "To allow them: the phone's Settings, then Notifications, then Budget." };
    case 'on':
      return { title: 'On for this phone', detail: `Since ${shortDate(state.since)}.${others(state.devices - 1)}` };
    case 'off':
      return state.stopped === null
        ? { title: 'Off on this phone', detail: `Turn them on to get alerts here.${others(state.devices)}` }
        : { title: 'Off on this phone', detail: `They stopped ${shortDate(state.stopped.date)}: this phone's push service would not take them any more. Turn them on to start again.${others(state.devices)}` };
  }
}

// What each button said it did.
export const NOTIFICATION_DONE = {
  on: 'Notifications are on for this phone.',
  off: 'Notifications are off on this phone.',
  test: 'A test alert is on its way to this phone.',
} as const;

export const NOTIFICATION_NO_SIGNAL = "Couldn't reach the app. Check your connection and try again. Nothing was changed.";
