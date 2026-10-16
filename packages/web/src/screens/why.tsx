import type { WhyLine } from '@budget-app/server/views';
import type { IconName } from '../ui/Icon.js';
import { Card, ListRow, Money } from '../ui/blocks.js';
import { whyText } from './why-text.js';

// Rule 12.6 (QUESTIONS.md A57): why the totals do not match, on Home's check
// sheet and on Buckets' sheet alike: a line for each cause the server named,
// each with its part of the difference, signed, so together they add up to it.
const ICONS: Readonly<Record<WhyLine['kind'], IconName>> = {
  'posted-still-pending': 'clock',
  'not-in-available-yet': 'clock',
  'amount-changed': 'clock',
  'posted-and-pending': 'clock',
  'balance-moved': 'bank',
  rest: 'alert',
  'no-match-kept': 'alert',
};

export function WhyList({ lines, testId = 'why' }: { readonly lines: readonly WhyLine[]; readonly testId?: string }) {
  return (
    <>
      <Card title="Why" testId={testId}>
        {lines.map((line, i) => {
          const words = whyText(line);
          return <ListRow key={i} icon={ICONS[line.kind]} title={words.title} detail={words.detail} trailing={<Money cents={line.amount} signed testId={`${testId}-${i}-amount`} />} testId={`${testId}-${i}`} />;
        })}
      </Card>
      <p className="sheet__note">Each amount is its part of the difference; together they add up to it. The bank and Plaid usually agree again within hours.</p>
    </>
  );
}
