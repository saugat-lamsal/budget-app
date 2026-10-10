import { describe, expect, it } from 'vitest';
import { describeFailure, liveALife, type RecordedAnswer, type RecordedBankDay } from './sim/life.js';
import { PAY_PERIOD, PAY_PERIOD_SEED } from './sim/pay-period.js';

// Phase 4's finish line, the money side: the pay period the screens are
// played through (sim/pay-period.ts), lived by the simulator as planned. Every
// day passes every one of the simulator's checks, worked out from the
// rulebook, and the period has in it everything the screens must show.

function live(): { days: RecordedBankDay[]; answers: RecordedAnswer[]; result: ReturnType<typeof liveALife> } {
  const days: RecordedBankDay[] = [];
  const answers: RecordedAnswer[] = [];
  const result = liveALife({ seed: PAY_PERIOD_SEED, years: 0, plan: PAY_PERIOD, record: { setupDay: () => undefined, day: (d) => days.push(d), answer: (a) => answers.push(a) } });
  return { days, answers, result };
}

describe('the pay period for the screens, lived by the simulator', () => {
  it('simulator: every day of the planned pay period passes every check, from setup day to the next payday', () => {
    const { days, result } = live();
    if (!result.ok) throw new Error(describeFailure(result, 0));
    expect(days.map((d) => d.date)).toEqual(Array.from({ length: 16 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`));
  });

  it('simulator: the pay period has in it everything the screens must get right', () => {
    const { result, answers } = live();
    if (!result.ok) throw new Error(describeFailure(result, 0));
    const s = result.stats;
    expect({
      paychecks: s.paychecks,
      pendingAtSetup: s.pendingAtSetup,
      inTransitAtSetup: s.inTransitAtSetup,
      postedAtNewAmount: s.postedAtNewAmount,
      splitPurchases: s.splitPurchases,
      momPayments: s.momPayments,
      refundsMatchedByHand: s.refundsLinked,
      everydayCardPayments: s.everydayCardPayments,
      oldCardPayments: s.oldCardPayments,
      takenBack: s.takenBack,
      oldCardRefunds: s.oldCardRefunds,
      resorts: s.resorts,
      handMoves: s.handMoves,
      settingsChanges: s.settingsChanges,
      rulesAdded: s.rulesAdded,
      leftoverAnswers: s.leftoverRolledOver + s.leftoverMovedToSavings,
    }).toEqual({
      paychecks: 2,
      pendingAtSetup: 2,
      inTransitAtSetup: 1,
      postedAtNewAmount: 3,
      splitPurchases: 1,
      momPayments: 1,
      refundsMatchedByHand: 2,
      everydayCardPayments: 1,
      oldCardPayments: 1,
      takenBack: 1,
      oldCardRefunds: 1,
      resorts: 1,
      handMoves: 1,
      settingsChanges: 3,
      rulesAdded: 4,
      leftoverAnswers: 4,
    });
    const methods = new Set(answers.map((a) => a.method));
    expect([...methods].sort()).toEqual(['addRule', 'answerLeftover', 'changeSettings', 'moveMoney', 'moveRule', 'sort']);
    // A29: one refund to the debit card, money in to checking, matched to its purchase.
    expect(answers.some((a) => a.method === 'sort' && JSON.stringify(a.args[1]).includes('refundOf') && String(a.args[0]).startsWith('d'))).toBe(true);
  });
});
