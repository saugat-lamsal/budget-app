import { afterEach, describe, expect, it } from 'vitest';
import { readOutbox } from '../src/alerts/outbox.js';
import { memoryLog } from '../src/log.js';
import { AlertTimer } from '../src/serve/alert-timer.js';
import { ACCOUNT_IDS } from './fake-plaid.js';
import { FakeClock } from './fake-clock.js';
import { FakePhone } from './fake-phone.js';
import { choose, lifeInAFile, noonInNewYork, setUpThroughTheDesk, type Life } from './keeper-harness.js';

// 10.14 (QUESTIONS.md A49), with the real books, the real alert timer and a
// made-up phone: the payday alert is kept when the paycheck is counted, waits
// for quiet hours (10.8), says when it was due, opens Payday, and has no
// amounts on the lock screen with the setting off (10.10). The plan itself:
// payday-alert.test.ts. Every name and number is made up.

const PAY = 400_000;

describe('10.14 10.8 the payday alert with the real books and the timer', () => {
  const lives: { life: Life; timer: AlertTimer }[] = [];
  afterEach(async () => {
    for (const { life, timer } of lives.splice(0)) {
      await timer.stop();
      life.done();
    }
  });

  it('10.14 10.8 a paycheck counted at 11:30 PM is kept then and sent at 7:00 AM, saying when it was due; a tap opens Payday', async () => {
    const life = await lifeInAFile();
    setUpThroughTheDesk(life);
    life.now = noonInNewYork('2026-10-09');
    const clock = new FakeClock(life);
    const phone = new FakePhone(() => life.now);
    const timer = new AlertTimer({ alerter: life.keeper, sender: phone, clock, log: memoryLog([]) });
    lives.push({ life, timer });
    life.keeper.whenChanged(() => timer.poke());
    timer.start();
    await timer.idle();
    // No paycheck rule yet: the deposit waits in review.
    life.h.fake.addPosted({ id: 'pay-1', account: ACCOUNT_IDS.checking, amount: -PAY, date: '2026-10-09', description: 'MADEUP CORP PAYROLL' });
    await life.sync();
    await timer.idle();
    // 11:30 PM in New York: he says it is his paycheck.
    await clock.advance(Date.parse('2026-10-10T03:30:00Z') - life.now.getTime(), () => timer.idle());
    expect(choose(life.keeper, { item: 'pay-1', choice: { to: 'paycheck' } })).toMatchObject({ ok: true });
    await timer.idle();
    const row = readOutbox(life.h.db, 20).rows.find((r) => r.kind === 'payday');
    const payday = life.keeper.payday();
    if (payday.state !== 'tracking' || payday.toSavings.state !== 'known') throw new Error('no payday to compare');
    expect(row).toMatchObject({ key: 'payday pay period 1', dueAt: '2026-10-10T03:30:00.000Z', sentAt: null, facts: { kind: 'payday', period: 1, date: '2026-10-09', toSavings: payday.toSavings.transfer.stillToMove, oldCard: null } });
    expect(phone.shown.filter((s) => s.id === 'payday pay period 1')).toEqual([]);
    await clock.advance(Date.parse('2026-10-10T11:00:00Z') - life.now.getTime(), () => timer.idle());
    const shown = phone.shown.filter((s) => s.id === 'payday pay period 1');
    // Words only on the lock screen (10.10, off to start).
    expect(shown).toEqual([{ id: 'payday pay period 1', title: 'Payday', body: 'Open Payday to see what to move to savings.', dueAt: '2026-10-10T03:30:00.000Z', due: 'Was due Fri, Oct 9, 11:30 PM.', screen: '/payday', at: '2026-10-10T11:00:00.000Z' }]);
    // A second look a minute later sends nothing more.
    await clock.advance(60_000, () => timer.idle());
    expect(phone.shown.filter((s) => s.id === 'payday pay period 1')).toHaveLength(1);
  });
});
