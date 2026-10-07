import { TAB_LABELS, type Tab } from '../app/routes.js';
import { StateMessage } from '../ui/blocks.js';
import type { IconName } from '../ui/Icon.js';

// Buckets, Review, and Settings are built after Home's look is agreed.
export function ComingNext({ tab }: { readonly tab: Exclude<Tab, 'home'> }) {
  const icon: IconName = tab === 'review' ? 'tray' : tab;
  return (
    <main className="screen" data-testid={tab}>
      <h1 className="screen-title">{TAB_LABELS[tab]}</h1>
      <div className="card">
        <StateMessage icon={icon} title="Coming next" detail="This screen is built once the look of Home is agreed." testId="coming-next" />
      </div>
    </main>
  );
}
