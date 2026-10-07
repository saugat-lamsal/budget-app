import { describe, expect, it } from 'vitest';
import { APP_PATHS } from '../../server/src/http/server.js';
import { TABS, pathOf, tabOf } from '../src/app/routes.js';

// The current tab is in the address, so a refresh or a notification link
// opens the right screen.

describe('tabs in the address', () => {
  it('each tab has its own address', () => {
    expect(TABS.map(pathOf)).toEqual(['/home', '/buckets', '/review', '/settings']);
  });

  it('an address leads back to its tab', () => {
    for (const tab of TABS) expect(tabOf(pathOf(tab))).toBe(tab);
    expect(tabOf('/review/')).toBe('review');
  });

  it('anything else is not a tab', () => {
    expect(tabOf('/')).toBeNull();
    expect(tabOf('/reviews')).toBeNull();
    expect(tabOf('/home/extra')).toBeNull();
    expect(tabOf('')).toBeNull();
  });

  it('the server answers every tab address with the app', () => {
    expect([...APP_PATHS].sort()).toEqual(['/', ...TABS.map(pathOf)].sort());
  });
});
