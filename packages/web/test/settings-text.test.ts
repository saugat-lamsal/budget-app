import type { RecheckedItem } from '@budget-app/money';
import { describe, expect, it } from 'vitest';
import { SETTING_NAMES, ZONE_CHOICES, daysText, leftoverText, lockAmountsText, notReadText, payScheduleText, permissionWarnText, quietHoursText, recheckedText, reminderText, ruleDoneText, ruleText, settingValueText, settingsDoneText, splitText, statementDaysText, textRuleText, timeText, zoneText } from '../src/screens/settings-text.js';

// The words on the Settings screen. Every value comes from the money math;
// these only write it, and must write it right.

describe('section 2 how each setting is written', () => {
  it('2 the daily review time, on a 12-hour clock, at its edges', () => {
    expect(timeText('00:00')).toBe('12:00 AM');
    expect(timeText('00:01')).toBe('12:01 AM');
    expect(timeText('11:59')).toBe('11:59 AM');
    expect(timeText('12:00')).toBe('12:00 PM');
    expect(timeText('12:59')).toBe('12:59 PM');
    expect(timeText('13:00')).toBe('1:00 PM');
    expect(timeText('20:00')).toBe('8:00 PM');
    expect(timeText('23:59')).toBe('11:59 PM');
  });

  it('9.1 card reminder days: none, one, two, and more', () => {
    expect(reminderText([])).toBe('None');
    expect(reminderText([1])).toBe('1 day before');
    expect(reminderText([0])).toBe('0 days before');
    expect(reminderText([7, 2])).toBe('7 and 2 days before');
    expect(reminderText([10, 3, 1])).toBe('10, 3 and 1 days before');
  });

  it('3.7 11.2 days, one and many', () => {
    expect(daysText(1)).toBe('1 day');
    expect(daysText(0)).toBe('0 days');
    expect(daysText(14)).toBe('14 days');
  });

  it('3.3 3.4 the split, the leftover setting, and a text rule', () => {
    expect(splitText({ savings: 50, needs: 30, wants: 20 })).toBe('50 / 30 / 20');
    expect(leftoverText({ needs: 'ask', wants: 'move-to-savings' })).toBe('Needs: ask each time, Wants: always move to savings');
    expect(textRuleText(null)).toBe('Not set');
    expect(textRuleText({ contains: 'MADE UP' })).toBe('“MADE UP”');
  });

  it('section 2 the home time zone: the US zones by their names, any other as it is written; the choices start with his', () => {
    expect(ZONE_CHOICES.map(zoneText)).toEqual([
      'Eastern time (New York)',
      'Central time (Chicago)',
      'Mountain time (Denver)',
      'Arizona (Phoenix)',
      'Pacific time (Los Angeles)',
      'Alaska (Anchorage)',
      'Hawaii (Honolulu)',
    ]);
    expect(ZONE_CHOICES[0]).toBe('America/New_York');
    expect(zoneText('Asia/Kathmandu')).toBe('Asia/Kathmandu');
    expect(settingValueText('homeTimeZone', 'America/Chicago')).toBe('Central time (Chicago)');
  });

  it('section 2 10.13 the warning before the bank\'s permission runs out, in words', () => {
    expect(permissionWarnText(7)).toBe('7 days before');
    expect(permissionWarnText(1)).toBe('1 day before');
    expect(permissionWarnText(60)).toBe('60 days before');
    expect(settingValueText('bankPermissionWarnDays', 14)).toBe('14 days before');
    expect(SETTING_NAMES.bankPermissionWarnDays).toBe('Bank permission ending');
  });

  it('9.8 the days from statement to due date, for each card: not entered, or how many days before the due date', () => {
    expect(statementDaysText(null)).toBe('Not entered');
    expect(statementDaysText(1)).toBe('1 day before the due date');
    expect(statementDaysText(25)).toBe('25 days before the due date');
    expect(settingValueText('oldCardStatementDays', 25)).toBe('25 days before the due date');
    expect(settingValueText('everydayCardStatementDays', null)).toBe('Not entered');
    expect(SETTING_NAMES.everydayCardStatementDays).toBe('Everyday card: statement to due date');
    expect(SETTING_NAMES.oldCardStatementDays).toBe('Old card: statement to due date');
  });

  it('section 2 10.7 10.8 10.10 quiet hours, the bank-not-read alert and amounts on the lock screen, in words', () => {
    expect(quietHoursText({ from: '22:00', to: '07:00' })).toBe('10:00 PM to 7:00 AM');
    expect(quietHoursText({ from: '00:00', to: '12:00' })).toBe('12:00 AM to 12:00 PM');
    expect(quietHoursText({ from: '22:00', to: '22:00' })).toBe('None');
    expect(notReadText(24)).toBe('After 24 hours');
    expect(notReadText(1)).toBe('After 1 hour');
    expect(notReadText(168)).toBe('After 168 hours');
    expect(lockAmountsText(false)).toBe('Off, words only');
    expect(lockAmountsText(true)).toBe('On');
    expect(settingValueText('quietHours', { from: '23:00', to: '06:30' })).toBe('11:00 PM to 6:30 AM');
    expect(settingValueText('bankNotReadAlertHours', 12)).toBe('After 12 hours');
    expect(settingValueText('amountsOnLockScreen', true)).toBe('On');
    expect(SETTING_NAMES.quietHours).toBe('Quiet hours');
    expect(SETTING_NAMES.bankNotReadAlertHours).toBe('Bank not read');
    expect(SETTING_NAMES.amountsOnLockScreen).toBe('Amounts on the lock screen');
  });

  it('13.5 every setting, written for the change log', () => {
    expect(settingValueText('momReservePerPaycheck', 150_000)).toBe('$1,500.00');
    expect(settingValueText('momMonthlyTarget', { low: 200_000, high: 300_001 })).toBe('$2,000.00 to $3,000.01');
    expect(settingValueText('lowBucketAlertPercent', 20)).toBe('20%');
    expect(settingValueText('oldCardPromoEndDate', null)).toBe('Not entered');
    expect(settingValueText('oldCardPromoEndDate', '2027-06-30')).toBe('Jun 30, 2027');
    expect(settingValueText('payScheduleDays', 14)).toBe('Every 14 days');
    expect(settingValueText('paySchedule', 'twice-a-month')).toBe('Twice a month, the 15th and the last day');
    expect(settingValueText('paySchedule', 'every-n-days')).toBe('Every so many days');
    expect(SETTING_NAMES.paySchedule).toBe('Pay schedule');
    expect(SETTING_NAMES.totalsMismatchAlertHours).toBe('Totals do not match');
    expect(settingValueText('totalsMismatchAlertHours', 12)).toBe('After 12 hours');
    expect(payScheduleText({ paySchedule: 'twice-a-month', payScheduleDays: 14 })).toBe('Twice a month, the 15th and the last day');
    expect(payScheduleText({ paySchedule: 'every-n-days', payScheduleDays: 1 })).toBe('Every 1 day');
    expect(settingValueText('earlyPaycheckDays', 1)).toBe('1 day');
    expect(settingValueText('paycheckRule', null)).toBe('Not set');
    expect(settingValueText('split', { savings: 40, needs: 40, wants: 20 })).toBe('40 / 40 / 20');
  });
});

describe('13.2 A9 what a change did, in words', () => {
  const paycheck: RecheckedItem = { kind: 'paycheck', id: 'p1', date: '2026-10-02', amount: 420_000, description: 'PAY', split: { momReserve: 150_000, savings: 135_000, needs: 81_000, wants: 54_000, detail: { reserveTaken: 150_000, overflowToSavings: 0, rest: 270_000, savingsShare: 135_000, roundingToSavings: 0 } } };
  const early: RecheckedItem = { kind: 'early-paycheck', id: 'p2', date: '2026-10-05', amount: 1_000, description: 'PAY' };
  const mom: RecheckedItem = { kind: 'mom', id: 'z1', date: '2026-10-03', amount: 50_000, description: 'ZELLE', fromReserve: 30_000, difference: 20_000 };
  const still: RecheckedItem = { kind: 'still-waiting', id: 'z2', date: '2026-10-04', amount: 3_000, description: 'ZELLE TO MADE UP MOM', why: 'partly-refunded' };

  it('A9 3.7 8.3 each waiting item a new rule handles', () => {
    expect(recheckedText(paycheck, 10)).toBe('Becomes your paycheck, and a new pay period starts that day.');
    expect(recheckedText(early, 10)).toBe('Still waits in review, as a paycheck that came early: less than 10 days after the last one.');
    expect(recheckedText(mom, 10)).toBe('$300.00 comes out of the mom reserve. The other $200.00 waits in review for you to pick a bucket.');
    expect(recheckedText({ ...mom, fromReserve: 50_000, difference: 0 }, 10)).toBe('Comes out of the mom reserve.');
    expect(recheckedText(still, 10)).toBe('Still waits in Review: part of it was refunded, so it cannot come out of the mom reserve. Sort it there.');
  });

  it('13.1 A9 what a settings change did', () => {
    expect(settingsDoneText({ changed: ['split'], fromNextPaycheck: true, rechecked: [] }, '2026-10-16')).toBe('Saved. It starts at your next paycheck, Fri, Oct 16.');
    expect(settingsDoneText({ changed: ['payScheduleDays'], fromNextPaycheck: false, rechecked: [] }, '2026-10-16')).toBe('Saved.');
    expect(settingsDoneText({ changed: ['paycheckRule'], fromNextPaycheck: false, rechecked: [paycheck, paycheck, early] }, '2026-10-16')).toBe('Saved. 2 deposits that were waiting are now paychecks. One waits in review as an early paycheck.');
    expect(settingsDoneText({ changed: ['momRule'], fromNextPaycheck: false, rechecked: [mom, mom] }, '2026-10-16')).toBe('Saved. 2 payments that were waiting came out of the mom reserve.');
    expect(settingsDoneText({ changed: ['momRule'], fromNextPaycheck: false, rechecked: [mom, still] }, '2026-10-16')).toBe(
      'Saved. A payment that was waiting came out of the mom reserve. ZELLE TO MADE UP MOM still waits in Review: part of it was refunded, so it cannot come out of the mom reserve.',
    );
  });

  it('13.2 A19 what a rule change did', () => {
    const rule = { id: 'r', for: 'purchase', contains: 'CAFE', to: 'wants' } as const;
    expect(ruleText(rule)).toBe('“CAFE” → Wants');
    expect(ruleDoneText({ action: 'added', rule, alsoSorted: 0, stillWaiting: [] })).toBe('Rule added: “CAFE” → Wants.');
    expect(ruleDoneText({ action: 'added', rule, alsoSorted: 2, stillWaiting: [{ item: 'x', name: 'MADE UP CAFE' }] })).toBe('Rule added: “CAFE” → Wants. It sorted 2 items that were waiting. It could not sort MADE UP CAFE, so that still waits in Review.');
    expect(ruleDoneText({ action: 'removed', rule, alsoSorted: 0, stillWaiting: [] })).toBe('Rule removed: “CAFE” → Wants. What it sorted stays where it is.');
  });
});
