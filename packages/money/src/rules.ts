import { isBucket, isSpendingBucket, type Bucket, type SplitBucket } from './buckets.js';
import { MoneyError } from './errors.js';
import { matchesTextRule } from './settings.js';

// The choices for money coming in (6.1): this is my paycheck (a new pay
// period: the mom reserve first, then the split), other income (split by
// the percentages only), payback into a bucket you pick, or not mine (held
// for others).
export type MoneyInChoice = { readonly to: 'paycheck' | DepositRuleChoice['to'] };

// What a deposit rule can pick (6.2): anything but "this is my paycheck".
// Paychecks are found by the paycheck rule in settings (section 2), which
// keeps the 10-day check (3.7).
export type DepositRuleChoice = { readonly to: 'other-income' | 'not-mine' | Bucket };

export function isMoneyInChoice(choice: unknown): choice is MoneyInChoice {
  return isDepositRuleChoice(choice) || (typeof choice === 'object' && choice !== null && 'to' in choice && choice.to === 'paycheck');
}

export function isDepositRuleChoice(choice: unknown): choice is DepositRuleChoice {
  if (typeof choice !== 'object' || choice === null || !('to' in choice)) return false;
  return choice.to === 'other-income' || choice.to === 'not-mine' || isBucket(choice.to);
}

// What a payment to a person can be (7.2, 7.4): spending from needs or
// wants, or not mine (lowers held for others).
export type PersonPaymentChoice = { readonly to: SplitBucket | 'not-mine' };

export function isPersonPaymentChoice(choice: unknown): choice is PersonPaymentChoice {
  if (typeof choice !== 'object' || choice === null || !('to' in choice)) return false;
  return choice.to === 'not-mine' || isSpendingBucket(choice.to);
}

// Your sorting rules (4.2, 6.2, 7.4). A rule matches a bank description that
// contains its text, ignoring case. When several rules match, the first one
// in the list wins.
export type SortingRule =
  | {
      readonly id: string;
      readonly for: 'purchase';
      readonly contains: string;
      readonly bucket: SplitBucket;
    }
  | {
      readonly id: string;
      readonly for: 'deposit';
      readonly contains: string;
      readonly choice: DepositRuleChoice;
    }
  | {
      readonly id: string;
      readonly for: 'person';
      readonly contains: string;
      readonly choice: PersonPaymentChoice;
    };

export function checkRules(rules: readonly SortingRule[]): readonly SortingRule[] {
  const ids = new Set<string>();
  const checked = rules.map((rule) => {
    const bad = (why: string): never => {
      throw new MoneyError('bad-rule', `${why}: ${JSON.stringify(rule)}`);
    };
    if (typeof rule.id !== 'string' || rule.id === '') bad('a rule needs an id');
    if (ids.has(rule.id)) bad('two rules have the same id');
    ids.add(rule.id);
    if (typeof rule.contains !== 'string' || rule.contains.trim() === '') bad('a rule needs some text to match');
    switch (rule.for) {
      case 'purchase':
        if (!isSpendingBucket(rule.bucket)) bad('a purchase rule must pick needs or wants');
        return Object.freeze({ ...rule });
      case 'deposit':
        if (!isDepositRuleChoice(rule.choice)) bad('a deposit rule must pick other income, a bucket, or not mine');
        return Object.freeze({ ...rule, choice: Object.freeze({ to: rule.choice.to }) });
      case 'person':
        if (!isPersonPaymentChoice(rule.choice)) bad('a person rule must pick needs, wants, or not mine');
        return Object.freeze({ ...rule, choice: Object.freeze({ to: rule.choice.to }) });
      default:
        return bad('unknown kind of rule');
    }
  });
  return Object.freeze(checked);
}

export function findRule<K extends SortingRule['for']>(
  rules: readonly SortingRule[],
  kind: K,
  description: string,
): Extract<SortingRule, { for: K }> | undefined {
  return rules.find((rule): rule is Extract<SortingRule, { for: K }> => rule.for === kind && matchesTextRule(rule, description));
}
