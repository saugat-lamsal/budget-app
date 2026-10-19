import type { BankCheck } from '@budget-app/server/views';
import { useState } from 'react';
import { pathOf } from '../app/routes.js';
import { Banner, BottomSheet, Button, ListRow, Money } from '../ui/blocks.js';
import { WhyList } from './why.js';

// 0.5, 10.4, 12.6: the "totals do not match the bank" banner, the same on
// Buckets and Trends (40.9): still catching up, or off, with the lines that
// say why. Home has the numbers behind it.
export function CheckBanner({ check }: { readonly check: BankCheck }) {
  const [whyOpen, setWhyOpen] = useState(false);
  if (check.state !== 'does-not-match') return null;
  const why = check.why !== null && check.why.length > 0 ? check.why : null;
  const seeWhy =
    why !== null ? (
      <Button variant="secondary" onClick={() => setWhyOpen(true)} testId="see-why">
        See why
      </Button>
    ) : null;
  return (
    <>
      {check.catchingUp ? (
        // 10.4 (A47): a difference younger than the setting's hours.
        <Banner tone="warning" icon="clock" title="The bank is still catching up" testId="catching-up">
          <p className="banner__big">
            Off by <Money cents={Math.abs(check.difference)} testId="mismatch-amount" /> for now
          </p>
          <p className="banner__body">The bank shows {check.difference > 0 ? 'more' : 'less'} than your buckets add up to. This usually clears within a few hours. Home has the numbers behind it.</p>
          {seeWhy}
          <ListRow title="Open Home" href={pathOf('home')} testId="see-home" />
        </Banner>
      ) : (
        <Banner tone="danger" icon="alert" title="Totals do not match the bank" testId="mismatch">
          <p className="banner__big">
            Off by <Money cents={Math.abs(check.difference)} testId="mismatch-amount" />
          </p>
          <p className="banner__body">The bank shows {check.difference > 0 ? 'more' : 'less'} than your buckets add up to. Home has the numbers behind it.</p>
          {seeWhy}
          <ListRow title="Open Home" href={pathOf('home')} testId="see-home" />
        </Banner>
      )}
      {why !== null && (
        // 12.6 (A57): the same lines as Home's check sheet.
        <BottomSheet open={whyOpen} title="Why it doesn't match" onClose={() => setWhyOpen(false)} testId="why-sheet">
          <p className="sheet__note">
            Off by <Money cents={check.difference} signed testId="why-difference" />: the bank plus money on its way, less your buckets.
          </p>
          <WhyList lines={why} />
        </BottomSheet>
      )}
    </>
  );
}
