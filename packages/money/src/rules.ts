import { isSpendingBucket, type SplitBucket } from './buckets.js';
import { MoneyError } from './errors.js';
import { matchesTextRule } from './settings.js';

// Your sorting rules (4.2). A rule matches a bank description that contains
// its text, ignoring case. When several rules match, the first one in the
// list wins.
export type SortingRule = {
  readonly id: string;
  readonly for: 'purchase';
  readonly contains: string;
  readonly bucket: SplitBucket;
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
    if (rule.for !== 'purchase') bad('unknown kind of rule');
    if (!isSpendingBucket(rule.bucket)) bad('a purchase rule must pick needs or wants');
    return Object.freeze({ ...rule });
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
