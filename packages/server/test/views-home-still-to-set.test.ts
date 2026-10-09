import type { Settings } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { appSide, openTestBook, purchase } from '../../money/test/helpers.js';
import { homeView, type HomeView } from '../src/views/home.js';

// After setup day, Home says what is still to set (section 2: the paycheck
// rule is set after the first sync, the mom rule in the app), with a way to
// Settings, until each is set. Made-up numbers only.

function attention(settings: Partial<Settings>): Extract<HomeView, { state: 'tracking' }>['attention'] {
  const book = openTestBook({ pots: { wants: 10_000 }, settings });
  const view = homeView({
    today: '2026-10-01',
    book,
    bank: { checking: appSide(book.pots()), savings: 0, everydayCard: 0 },
    needsLogin: false,
    statements: [],
    madeUpData: false,
    seenTakeBacks: new Set(),
    lastChecked: null,
  });
  if (view.state !== 'tracking') throw new Error('not tracking');
  return view.attention;
}

describe('14 section 2 what is still to set after setup day', () => {
  it('14 neither rule set: Home says both are still to set', () => {
    expect(attention({ paycheckRule: null, momRule: null })).toEqual([{ kind: 'still-to-set', settings: ['paycheckRule', 'momRule'] }]);
  });

  it('14 one set: only the other is still to set', () => {
    expect(attention({ momRule: null })).toEqual([{ kind: 'still-to-set', settings: ['momRule'] }]);
    expect(attention({ paycheckRule: null })).toEqual([{ kind: 'still-to-set', settings: ['paycheckRule'] }]);
  });

  it('14 both set: nothing is said', () => {
    expect(attention({})).toEqual([]);
  });

  it('14 it comes after what waits in review, which setting the rules may sort (A9)', () => {
    const book = openTestBook({ pots: { wants: 10_000 }, settings: { paycheckRule: null, momRule: null } });
    book.receive(purchase('p1', '2026-10-01', 1_000, 'MADE UP SHOP'));
    const view = homeView({
      today: '2026-10-01',
      book,
      bank: { checking: appSide(book.pots()) - 1_000, savings: 0, everydayCard: 0 },
      needsLogin: true,
      statements: [],
      madeUpData: false,
      seenTakeBacks: new Set(),
      lastChecked: null,
    });
    expect(view.state === 'tracking' && view.attention.map((a) => a.kind)).toEqual(['bank-login', 'review', 'still-to-set']);
  });
});
