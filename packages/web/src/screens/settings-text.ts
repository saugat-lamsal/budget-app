import type { LeftoverChoice, RecheckedItem, Settings } from '@budget-app/money';
import type { RuleDone, RuleSpec, SettingsDone } from '@budget-app/server/views';
import { dayWithYear, shortDate } from '../ui/dates.js';
import { moneyText } from '../ui/money-format.js';
import { POT_NAMES } from '../ui/names.js';

// Words on the Settings screen: what each setting and each rule is called,
// and how a value is written. Every value comes from the money math on the
// server; these only name it.

export const RULE_KINDS: Readonly<Record<RuleSpec['for'], string>> = {
  purchase: 'Purchases',
  deposit: 'Money in',
  person: 'Payments to people',
};

// What a rule of each kind catches, in a sentence.
export const RULE_KIND_DETAIL: Readonly<Record<RuleSpec['for'], string>> = {
  purchase: 'A rule here sorts card and debit purchases.',
  deposit: 'A rule here sorts deposits that are not your paycheck.',
  person: 'A rule here sorts Zelle and other payments to someone.',
};

// What a rule does with what it catches.
export const RULE_CHOICE_NAMES: Readonly<Record<RuleSpec['to'], string>> = {
  ...POT_NAMES,
  'other-income': 'Other income (split)',
  'not-mine': 'Not mine',
  mom: 'For mom',
};

export const LEFTOVER_NAMES: Readonly<Record<LeftoverChoice, string>> = {
  ask: 'Ask each time',
  'roll-over': 'Always roll over',
  'move-to-savings': 'Always move to savings',
};

export const SETTING_NAMES: Readonly<Record<keyof Settings, string>> = {
  split: 'Split',
  momReservePerPaycheck: 'Mom reserve per paycheck',
  momReserveCap: 'Mom reserve cap',
  momMonthlyTarget: 'Mom monthly target',
  lowBucketAlertPercent: 'Low-bucket alert',
  cardReminderDaysBefore: 'Card reminders',
  dailyReviewTime: 'Daily review time',
  leftoverAtPayday: 'Leftover at payday',
  oldCardPromoEndDate: 'Old card promo end date',
  paycheckRule: 'Paycheck rule',
  payScheduleDays: 'Pay schedule',
  momRule: 'Mom rule',
  earlyPaycheckDays: 'Early paycheck check',
};

export function splitText(split: Settings['split']): string {
  return `${split.savings} / ${split.needs} / ${split.wants}`;
}

// "8:00 PM" for "20:00".
export function timeText(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (match === null) return time;
  const hours = Number(match[1]);
  return `${hours % 12 === 0 ? 12 : hours % 12}:${match[2]} ${hours < 12 ? 'AM' : 'PM'}`;
}

// "7 and 2 days before"; "None".
export function reminderText(days: readonly number[]): string {
  if (days.length === 0) return 'None';
  const list = days.length === 1 ? String(days[0]) : `${days.slice(0, -1).join(', ')} and ${String(days.at(-1))}`;
  return `${list} ${days.length === 1 && days[0] === 1 ? 'day' : 'days'} before`;
}

export function daysText(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export function textRuleText(rule: Settings['paycheckRule']): string {
  return rule === null ? 'Not set' : `“${rule.contains}”`;
}

export function leftoverText(leftover: Settings['leftoverAtPayday']): string {
  return `Needs: ${LEFTOVER_NAMES[leftover.needs].toLowerCase()}, Wants: ${LEFTOVER_NAMES[leftover.wants].toLowerCase()}`;
}

// A rule in a line: “GROCERY” → Needs.
export function ruleText(rule: RuleSpec): string {
  return `“${rule.contains}” → ${RULE_CHOICE_NAMES[rule.to]}`;
}

// Any setting's value, written out, for the change log.
export function settingValueText<K extends keyof Settings>(key: K, value: Settings[K]): string {
  const v = value as Settings[keyof Settings];
  switch (key) {
    case 'split':
      return splitText(v as Settings['split']);
    case 'momReservePerPaycheck':
    case 'momReserveCap':
      return moneyText(v as number);
    case 'momMonthlyTarget': {
      const t = v as Settings['momMonthlyTarget'];
      return `${moneyText(t.low)} to ${moneyText(t.high)}`;
    }
    case 'lowBucketAlertPercent':
      return `${String(v)}%`;
    case 'cardReminderDaysBefore':
      return reminderText(v as readonly number[]);
    case 'dailyReviewTime':
      return timeText(v as string);
    case 'leftoverAtPayday':
      return leftoverText(v as Settings['leftoverAtPayday']);
    case 'oldCardPromoEndDate':
      return v === null ? 'Not entered' : dayWithYear(v as string);
    case 'paycheckRule':
    case 'momRule':
      return textRuleText(v as Settings['paycheckRule']);
    case 'payScheduleDays':
      return `Every ${daysText(v as number)}`;
    case 'earlyPaycheckDays':
      return daysText(v as number);
    default:
      return String(v);
  }
}

// What a new paycheck rule or mom rule does to one waiting item (A9).
export function recheckedText(item: RecheckedItem, earlyDays: number): string {
  switch (item.kind) {
    case 'paycheck':
      return 'Becomes your paycheck, and a new pay period starts that day.';
    case 'early-paycheck':
      return `Still waits in review, as a paycheck that came early: less than ${daysText(earlyDays)} after the last one.`;
    case 'mom':
      return item.difference === 0
        ? `Comes out of the mom reserve.`
        : `${moneyText(item.fromReserve)} comes out of the mom reserve. The other ${moneyText(item.difference)} waits in review for you to pick a bucket.`;
  }
}

// What a settings change did, in a sentence (13.1, A9).
export function settingsDoneText(done: SettingsDone, nextPayday: string): string {
  const parts = [done.fromNextPaycheck ? `Saved. It starts at your next paycheck, ${shortDate(nextPayday)}.` : 'Saved.'];
  const count = (kind: RecheckedItem['kind']): number => done.rechecked.filter((i) => i.kind === kind).length;
  const paychecks = count('paycheck');
  const early = count('early-paycheck');
  const mom = count('mom');
  if (paychecks > 0) parts.push(paychecks === 1 ? 'A deposit that was waiting is now your paycheck.' : `${paychecks} deposits that were waiting are now paychecks.`);
  if (early > 0) parts.push(early === 1 ? 'One waits in review as an early paycheck.' : `${early} wait in review as early paychecks.`);
  if (mom > 0) parts.push(mom === 1 ? 'A payment that was waiting came out of the mom reserve.' : `${mom} payments that were waiting came out of the mom reserve.`);
  return parts.join(' ');
}

// What a rule change did, in a sentence (13.2, A19).
export function ruleDoneText(done: RuleDone): string {
  const what = done.action === 'added' ? 'Rule added' : done.action === 'changed' ? 'Rule changed' : 'Rule removed';
  const parts = [`${what}: ${ruleText(done.rule)}.`];
  if (done.alsoSorted > 0) parts.push(done.alsoSorted === 1 ? 'It sorted 1 item that was waiting.' : `It sorted ${done.alsoSorted} items that were waiting.`);
  if (done.stillWaiting.length > 0) parts.push(`It could not sort ${done.stillWaiting.map((w) => w.name).join(', ')}, so that still waits in Review.`);
  if (done.action === 'removed') parts.push('What it sorted stays where it is.');
  return parts.join(' ');
}
