import { describe, expect, it } from 'vitest';
import type { Keeper } from '../src/history/keeper.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { decision, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// Rule 12.1 (QUESTIONS.md A47, his call, Oct 14, 2026): for checking and
// savings, the bank side is the available balance plus what is still pending
// that the books count only once it posts; with no available balance, the
// posted one less pending charges. The everyday card: what it owes plus
// pending charges. Bank of America's "current" left out items Plaid already
// sent as posted until the bank's overnight processing (B231), so the old
// bank side came out high for most of a day. Every name and number is made up.

const C = ACCOUNT_IDS.checking;
const S = ACCOUNT_IDS.savings;
const E = ACCOUNT_IDS.everyday;

// The difference the screens show: null when the totals match.
function difference(keeper: Keeper): number | null {
  const s = keeper.home();
  if (s.state !== 'tracking') throw new Error('not tracking');
  return s.safeToSpend.shown ? null : s.safeToSpend.why === 'totals-do-not-match' ? s.safeToSpend.check.difference : NaN;
}

async function setUpLife(): Promise<Life> {
  const life = await lifeInAFile();
  setUpThroughTheDesk(life);
  life.now = noonInNewYork('2026-10-02');
  return life;
}

describe('12.1 the bank side from the available balance (A47)', () => {
  it('12.1 B231 a posted purchase Bank of America has not taken into "current" yet makes no gap', async () => {
    const life = await setUpLife();
    try {
      life.h.fake.addPosted({ id: 'grocer-1', account: C, amount: 4_210, date: '2026-10-02', description: 'MADE UP GROCER' });
      life.h.fake.notInCurrentYet(C, 4_210);
      await life.sync();
      const sorted = life.keeper.choice({ id: decision(), item: 'grocer-1', choice: { to: 'needs' } });
      expect(sorted.ok).toBe(true);
      expect(difference(life.keeper)).toBeNull();
      life.h.fake.overnightProcessing();
      await life.sync();
      expect(difference(life.keeper)).toBeNull();
    } finally {
      life.done();
    }
  });

  it('12.1 a pending purchase counts once: it is out of the available balance, as the books count it (4.6)', async () => {
    const life = await setUpLife();
    try {
      life.h.fake.addPending({ id: 'cafe-p', account: C, amount: 650, date: '2026-10-02', description: 'MADE UP CAFE' });
      await life.sync();
      expect(difference(life.keeper)).toBeNull();
    } finally {
      life.done();
    }
  });

  it('12.1 a pending transfer between his accounts is put back: the books count it once it posts', async () => {
    const life = await setUpLife();
    try {
      life.h.fake.addPending({ id: 'to-sav-p', account: C, amount: 50_000, date: '2026-10-02', description: 'Online transfer to SAV 2222' });
      await life.sync();
      expect(difference(life.keeper)).toBeNull();
    } finally {
      life.done();
    }
  });

  it('12.1 a pending payment to a person, and pending money leaving savings, are put back too', async () => {
    const life = await setUpLife();
    try {
      life.h.fake.addPending({ id: 'zelle-p', account: C, amount: 2_500, date: '2026-10-02', description: 'Zelle payment to MADE UP FRIEND' });
      life.h.fake.addPending({ id: 'sav-zelle-p', account: S, amount: 1_000, date: '2026-10-02', description: 'Zelle payment to MADE UP FRIEND' });
      await life.sync();
      expect(difference(life.keeper)).toBeNull();
    } finally {
      life.done();
    }
  });

  it('12.1 money in still pending is not in the available balance, and the books count it once it posts', async () => {
    const life = await setUpLife();
    try {
      life.h.fake.addPending({ id: 'refund-p', account: C, amount: -1_999, date: '2026-10-02', description: 'MADE UP STORE REFUND' });
      await life.sync();
      expect(difference(life.keeper)).toBeNull();
    } finally {
      life.done();
    }
  });

  it('12.1 4.6 a tip changes a pending amount: still no gap', async () => {
    const life = await setUpLife();
    try {
      life.h.fake.addPending({ id: 'diner-p', account: E, amount: 3_000, date: '2026-10-02', description: 'MADE UP DINER' });
      await life.sync();
      life.h.fake.postPending('diner-p', { id: 'diner-1', date: '2026-10-03', amount: 3_600 });
      life.now = noonInNewYork('2026-10-03');
      await life.sync();
      expect(difference(life.keeper)).toBeNull();
    } finally {
      life.done();
    }
  });

  it('12.1 a deposit hold makes the available balance lower than the books: a real gap, shown', async () => {
    const life = await setUpLife();
    try {
      life.h.fake.addPosted({ id: 'friend-in', account: C, amount: -20_000, date: '2026-10-02', description: 'MADE UP FRIEND DEPOSIT' });
      life.h.fake.holdAvailable(C, 15_000);
      await life.sync();
      expect(difference(life.keeper)).toBe(-15_000);
      life.h.fake.holdAvailable(C, 0);
      await life.sync();
      expect(difference(life.keeper)).toBeNull();
    } finally {
      life.done();
    }
  });

  it('12.1 B230 the everyday card owes a posted charge before Plaid sends it: a gap until it is sent', async () => {
    const life = await setUpLife();
    try {
      life.h.fake.addPosted({ id: 'card-early', account: E, amount: 7_700, date: '2026-10-02', description: 'MADE UP HARDWARE' }, { heldBack: true });
      await life.sync();
      expect(difference(life.keeper)).toBe(-7_700);
      life.h.fake.sendHeldBack();
      await life.sync();
      expect(difference(life.keeper)).toBeNull();
    } finally {
      life.done();
    }
  });
});

describe('14.1 12.1 setup day and the daily check read the same bank side', () => {
  it('14.1 12.1 B231 setup day on a day the bank has not processed a posted purchase: no gap after it', async () => {
    const life = await lifeInAFile();
    try {
      life.h.fake.addPosted({ id: 'grocer-0', account: C, amount: 4_210, date: '2026-10-01', description: 'MADE UP GROCER' });
      life.h.fake.notInCurrentYet(C, 4_210);
      await life.sync();
      setUpThroughTheDesk(life);
      expect(difference(life.keeper)).toBeNull();
      life.h.fake.overnightProcessing();
      life.now = noonInNewYork('2026-10-02');
      await life.sync();
      expect(difference(life.keeper)).toBeNull();
    } finally {
      life.done();
    }
  });
});

describe('12.1 with no available balance, the posted balance less pending charges, as before', () => {
  it('12.1 the bank gives no available balance: posted, less pending charges', async () => {
    const life = await setUpLife();
    try {
      life.h.fake.addPending({ id: 'cafe-p', account: C, amount: 650, date: '2026-10-02', description: 'MADE UP CAFE' });
      life.h.fake.noAvailable(C);
      await life.sync();
      expect(difference(life.keeper)).toBeNull();
      // Without the available balance, Bank of America's lag shows (B231).
      life.h.fake.addPosted({ id: 'grocer-1', account: C, amount: 4_210, date: '2026-10-02', description: 'MADE UP GROCER' });
      life.h.fake.notInCurrentYet(C, 4_210);
      await life.sync();
      expect(difference(life.keeper)).toBe(4_210);
    } finally {
      life.done();
    }
  });
});
