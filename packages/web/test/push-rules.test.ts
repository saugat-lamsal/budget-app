import { describe, expect, it } from 'vitest';
import { SHOWN_KEPT, UNREADABLE, decide, payloadOf, screenToOpen, shownOf } from '../src/push/rules.js';

// Phase 5, the phone: what its service worker does with each push (the same
// rules the made-up phone in the server's tests follows). Every name and
// number is made up.

const push = { id: 'low-bucket needs pay period 3', title: 'Needs is low', body: 'Open the app to see what is left this pay period.', due: null, screen: '/buckets/needs' };

describe('Phase 5 the service worker\'s rules', () => {
  it('Phase 5 an alert is shown with its id as its tag, its words, and the screen a tap opens', () => {
    expect(decide(payloadOf(JSON.stringify(push)), false)).toEqual({ show: { title: 'Needs is low', body: push.body, tag: push.id, screen: '/buckets/needs' } });
  });

  it('Phase 5 B185 one sent late says when it was due after its words', () => {
    expect(shownOf({ ...push, due: 'Was due Sat, Oct 3, 8:00 PM.' }).body).toBe(`${push.body} Was due Sat, Oct 3, 8:00 PM.`);
  });

  it('Phase 5 B181 a push with an id it has shown is dropped as a repeat', () => {
    expect(decide(payloadOf(JSON.stringify(push)), true)).toEqual({ repeat: push.id });
    expect(SHOWN_KEPT).toBeGreaterThanOrEqual(100);
  });

  it('Phase 5 a push it cannot read still shows something plain (WebKit wants every push to show one), never twice by tag', () => {
    for (const text of [null, '', 'not json', '[]', '{}', JSON.stringify({ ...push, id: '' }), JSON.stringify({ ...push, due: 5 }), JSON.stringify({ ...push, body: 'x'.repeat(1001) }), 'x'.repeat(5000)]) {
      expect(payloadOf(text), String(text).slice(0, 40)).toBeNull();
      expect(decide(payloadOf(text), false)).toEqual({ show: UNREADABLE });
    }
    expect(UNREADABLE.body).not.toMatch(/\$/);
  });

  it('Phase 5 a tap opens one of the app\'s own screens; anything else opens Home', () => {
    for (const screen of ['/home', '/buckets/needs', '/review', '/settings', '/alerts', '/payday']) expect(screenToOpen(screen)).toBe(screen);
    for (const screen of ['https://evil.example/home', '//evil.example/home', 'javascript:alert(1)', '/nowhere', '', 7, null, undefined]) expect(screenToOpen(screen), String(screen)).toBe('/home');
  });
});
