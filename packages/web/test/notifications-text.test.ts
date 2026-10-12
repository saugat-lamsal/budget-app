import type { PushView } from '@budget-app/server/views';
import { describe, expect, it } from 'vitest';
import { cardState, cardWords, type DeviceFacts } from '../src/screens/notifications-text.js';

// Phase 5, the phone: Settings' Notifications card in words, from what the
// server says about this device and what this browser can do. Every name and
// number is made up.

const ENDPOINT = 'https://web.push.apple.com/made-up';
const on: PushView = { state: 'ready', publicKey: 'made-up-key', thisDevice: { on: true, endpoint: ENDPOINT, since: '2026-10-12' }, devices: 1 };
const off: PushView = { state: 'ready', publicKey: 'made-up-key', thisDevice: { on: false, stopped: null }, devices: 0 };
const allowed: DeviceFacts = { support: 'yes', permission: 'granted', endpoint: ENDPOINT };

describe('Phase 5 the Notifications card says the state in words', () => {
  it('Phase 5 on: only when the server and this phone agree (the same subscription, allowed)', () => {
    expect(cardWords(cardState(on, allowed))).toEqual({ title: 'On for this phone', detail: 'Since Mon, Oct 12.' });
    expect(cardWords(cardState({ ...on, devices: 3 }, allowed)).detail).toBe('Since Mon, Oct 12. 2 other devices get them.');
    // The server has it, but this browser lost its subscription (its data cleared): off here.
    expect(cardState(on, { ...allowed, endpoint: null }).kind).toBe('off');
    expect(cardState(on, { ...allowed, endpoint: 'https://web.push.apple.com/another' }).kind).toBe('off');
    // Off here while the server still counts this login's subscription: it is not one of the others.
    expect(cardWords(cardState({ ...on, devices: 1 }, { ...allowed, endpoint: null })).detail).toBe('Turn them on to get alerts here.');
    expect(cardWords(cardState({ ...on, devices: 2 }, { ...allowed, endpoint: null })).detail).toBe('Turn them on to get alerts here. 1 other device gets them.');
  });

  it('Phase 5 off; and off because the push service stopped taking them, saying when', () => {
    expect(cardWords(cardState(off, { ...allowed, endpoint: null }))).toEqual({ title: 'Off on this phone', detail: 'Turn them on to get alerts here.' });
    const stopped: PushView = { ...off, thisDevice: { on: false, stopped: { date: '2026-10-13', why: 'its push service answered 410' } }, devices: 1 };
    expect(cardWords(cardState(stopped, { ...allowed, endpoint: null }))).toEqual({
      title: 'Off on this phone',
      detail: "They stopped Tue, Oct 13: this phone's push service would not take them any more. Turn them on to start again. 1 other device gets them.",
    });
  });

  it('Phase 5 blocked in the phone\'s settings, open it from the home screen first, not on a secure address, not this browser, not set up on the server', () => {
    expect(cardWords(cardState(on, { ...allowed, permission: 'denied' })).title).toBe("Blocked in the phone's settings");
    expect(cardWords(cardState(off, { support: 'home-screen-first', permission: 'default', endpoint: null })).title).toBe('Open the app from the home screen first');
    expect(cardWords(cardState(off, { support: 'not-secure', permission: 'default', endpoint: null })).title).toBe('Not on this address');
    expect(cardWords(cardState(off, { support: 'not-this-browser', permission: 'default', endpoint: null })).title).toBe("This browser can't show them");
    expect(cardWords(cardState({ state: 'no-keys' }, allowed)).title).toBe('Not set up on the server');
    expect(cardWords(cardState(on, null)).title).toBe('Checking this phone');
  });

  it('Phase 5 not allowed yet (the phone has not asked him): off, with Turn on', () => {
    expect(cardState(off, { support: 'yes', permission: 'default', endpoint: null }).kind).toBe('off');
    expect(cardState(on, { ...allowed, permission: 'default' }).kind).toBe('off');
  });
});
