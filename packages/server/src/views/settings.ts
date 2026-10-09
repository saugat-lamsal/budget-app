import {
  FROM_NEXT_PAYCHECK,
  RULE_CHOICES,
  payoffCountdown,
  type BankBalances,
  type Book,
  type Cents,
  type ChangeLogEntry,
  type IsoDate,
  type PayoffCountdown,
  type Pot,
  type Settings,
  type SortingRule,
  type SplitSettings,
} from '@budget-app/money';
import type { RuleView } from './choice.js';

// What the Settings screen shows, worked out on the server from the book:
// every setting in rulebook section 2, what is in force this pay period next
// to what comes from the next paycheck (13.1), the sorting rules in the order
// they are tried, and the change log, newest first (13.5). The screen only
// formats it.

export interface SettingsInput {
  readonly today: IsoDate;
  // Null before setup day (section 14).
  readonly book: Book | null;
  // Today's balances as the bank reports them, pending charges included
  // (12.1). Null when the bank could not be read.
  readonly bank: BankBalances | null;
  readonly madeUpData: boolean;
}

// A sorting rule, with its place among the rules of its kind: the first that
// matches wins (4.2, B9).
export type RuleRow = RuleView & { readonly position: number };

// One setting changed: its name, what it was, and what it became.
export type SettingChange = { readonly [K in keyof Settings]: { readonly key: K; readonly before: Settings[K]; readonly after: Settings[K] } }[keyof Settings];

// One line of the change log (13.5). key names the line, for the screen.
export type LogRow =
  // 13.1: fromNextPaycheck when the change waits for the next paycheck.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'setting'; readonly change: SettingChange; readonly fromNextPaycheck: boolean }
  // 13.6: a rule made from a correction ("always do this") goes just ahead of
  // the rule it corrects, which is shown as it was then.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'rule-added'; readonly rule: RuleView; readonly fromCorrection: boolean; readonly aheadOf: RuleView | null }
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'rule-changed'; readonly before: RuleView; readonly after: RuleView }
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'rule-removed'; readonly rule: RuleView }
  // A22: moved one place up or down past another rule of its kind; position is its place now.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'rule-moved'; readonly rule: RuleView; readonly past: RuleView; readonly direction: 'up' | 'down'; readonly position: number }
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'money-moved'; readonly from: Pot; readonly to: Pot; readonly amount: Cents }
  // 4.10: the bank took back something the app had counted.
  | { readonly key: string; readonly date: IsoDate; readonly kind: 'bank-took-back'; readonly description: string; readonly amount: Cents };

export type SettingsView =
  | { readonly state: 'not-set-up'; readonly madeUpData: boolean }
  | {
      readonly state: 'tracking';
      readonly madeUpData: boolean;
      readonly today: IsoDate;
      // 0.5: Settings says so too when the totals do not match the bank.
      readonly check: { readonly state: 'matches' } | { readonly state: 'does-not-match'; readonly difference: Cents } | { readonly state: 'bank-not-read' };
      // 13.1: the split and the mom reserve in force this pay period, and what
      // the next paycheck will use. waiting names the ones that differ.
      readonly split: {
        readonly thisPayPeriod: SplitSettings;
        readonly fromNextPaycheck: SplitSettings;
        readonly waiting: readonly (keyof SplitSettings)[];
        readonly payPeriodStarted: IsoDate;
        // 11.2: from the pay schedule; days are negative when the paycheck is late (B35).
        readonly nextPayday: { readonly date: IsoDate; readonly days: number };
      };
      // Every setting as it is now. Everything but the split and the mom
      // reserve is in force right away (B38).
      readonly settings: Settings;
      // 9.5: on once the promo end date is entered.
      readonly payoff: PayoffCountdown;
      // Each kind of rule in the order they are tried.
      readonly rules: { readonly purchase: readonly RuleRow[]; readonly deposit: readonly RuleRow[]; readonly person: readonly RuleRow[] };
      // What each kind of rule can pick, from the money math.
      readonly ruleChoices: typeof RULE_CHOICES;
      // Newest first; the same day, the one made last first.
      readonly log: readonly LogRow[];
    };

export function ruleViewOf(rule: SortingRule): RuleView {
  switch (rule.for) {
    case 'purchase':
      return { id: rule.id, for: rule.for, contains: rule.contains, to: rule.bucket };
    case 'deposit':
      return { id: rule.id, for: rule.for, contains: rule.contains, to: rule.choice.to };
    case 'person':
      return { id: rule.id, for: rule.for, contains: rule.contains, to: rule.choice.to };
  }
}

export function settingsView(input: SettingsInput): SettingsView {
  const { today, book, bank, madeUpData } = input;
  if (book === null) return { state: 'not-set-up', madeUpData };

  let check: Extract<SettingsView, { state: 'tracking' }>['check'];
  if (bank === null) check = { state: 'bank-not-read' };
  else {
    const self = book.selfCheck(bank);
    check = self.ok ? { state: 'matches' } : { state: 'does-not-match', difference: self.difference };
  }

  const settings = book.settings();
  const thisPayPeriod = book.splitInForce();
  const fromNextPaycheck: SplitSettings = { split: settings.split, momReservePerPaycheck: settings.momReservePerPaycheck, momReserveCap: settings.momReserveCap };
  const waiting = FROM_NEXT_PAYCHECK.filter((key) => JSON.stringify(thisPayPeriod[key]) !== JSON.stringify(fromNextPaycheck[key]));
  const safe = book.safeToSpend(today);

  const rows = (kind: SortingRule['for']): RuleRow[] =>
    book
      .rules()
      .filter((r) => r.for === kind)
      .map((r, i) => ({ ...ruleViewOf(r), position: i + 1 }));

  return {
    state: 'tracking',
    madeUpData,
    today,
    check,
    split: { thisPayPeriod, fromNextPaycheck, waiting, payPeriodStarted: book.period().startDate, nextPayday: { date: safe.nextPayday, days: safe.daysToPayday } },
    settings,
    payoff: payoffCountdown(book, today),
    rules: { purchase: rows('purchase'), deposit: rows('deposit'), person: rows('person') },
    ruleChoices: RULE_CHOICES,
    log: logRows(book),
  };
}

// The change log as lines, newest first. A settings change is one line for
// each setting it changed.
function logRows(book: Book): LogRow[] {
  const log = book.changeLog();
  const rows: LogRow[] = [];
  log.forEach((entry, i) => {
    const key = (j: number): string => `${i}-${j}`;
    const { date } = entry;
    switch (entry.kind) {
      case 'settings-changed':
        (Object.keys(entry.changes) as (keyof Settings)[]).forEach((name, j) => {
          const change = { key: name, before: entry.before[name], after: entry.changes[name] } as SettingChange;
          rows.push({ key: key(j), date, kind: 'setting', change, fromNextPaycheck: (FROM_NEXT_PAYCHECK as readonly string[]).includes(name) });
        });
        break;
      case 'rule-added':
        rows.push({ key: key(0), date, kind: 'rule-added', rule: ruleViewOf(entry.rule), fromCorrection: false, aheadOf: null });
        break;
      case 'rule-added-from-correction': {
        const ahead = entry.aheadOf === null ? undefined : ruleAsItWas(log, i, entry.aheadOf, book.rules());
        rows.push({ key: key(0), date, kind: 'rule-added', rule: ruleViewOf(entry.rule), fromCorrection: true, aheadOf: ahead === undefined ? null : ruleViewOf(ahead) });
        break;
      }
      case 'rule-changed':
        rows.push({ key: key(0), date, kind: 'rule-changed', before: ruleViewOf(entry.before), after: ruleViewOf(entry.after) });
        break;
      case 'rule-removed':
        rows.push({ key: key(0), date, kind: 'rule-removed', rule: ruleViewOf(entry.rule) });
        break;
      case 'rule-moved':
        rows.push({ key: key(0), date, kind: 'rule-moved', rule: ruleViewOf(entry.rule), past: ruleViewOf(entry.past), direction: entry.direction, position: entry.position });
        break;
      case 'money-moved':
        rows.push({ key: key(0), date, kind: 'money-moved', from: entry.from, to: entry.to, amount: entry.amount });
        break;
      case 'bank-took-back':
        rows.push({ key: key(0), date, kind: 'bank-took-back', description: entry.description, amount: entry.amount });
        break;
    }
  });
  // Newest first. The log is in the order things happened, so this also puts
  // the one made last first on the same day; the lines of one change keep their order.
  const byEntry = new Map<string, LogRow[]>();
  for (const row of rows) {
    const entry = row.key.split('-')[0] ?? '';
    byEntry.set(entry, [...(byEntry.get(entry) ?? []), row]);
  }
  return [...byEntry.values()].reverse().flat();
}

// A rule as it was when the log line at index `at` was written: the last
// version of it the log shows by then; else, for a rule he had from the
// start, the first version the log shows after it; else the rule as it is now.
function ruleAsItWas(log: readonly ChangeLogEntry[], at: number, id: string, rules: readonly SortingRule[]): SortingRule | undefined {
  const versionIn = (entry: ChangeLogEntry, side: 'then' | 'first'): SortingRule | undefined => {
    switch (entry.kind) {
      case 'rule-added':
      case 'rule-added-from-correction':
      case 'rule-removed':
        return entry.rule.id === id ? entry.rule : undefined;
      case 'rule-changed':
        if (entry.after.id !== id) return undefined;
        return side === 'then' ? entry.after : entry.before;
      case 'rule-moved':
        return entry.rule.id === id ? entry.rule : entry.past.id === id ? entry.past : undefined;
      default:
        return undefined;
    }
  };
  for (let i = at - 1; i >= 0; i -= 1) {
    const found = versionIn(log[i] as ChangeLogEntry, 'then');
    if (found !== undefined) return found;
  }
  for (let i = at + 1; i < log.length; i += 1) {
    const found = versionIn(log[i] as ChangeLogEntry, 'first');
    if (found !== undefined) return found;
  }
  return rules.find((r) => r.id === id);
}
