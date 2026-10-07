import { TAB_LABELS, type Tab } from '../app/routes.js';
import { StateMessage } from '../ui/blocks.js';

// Settings is built after Home, Buckets, and Review are agreed.
export function ComingNext({ tab }: { readonly tab: Extract<Tab, 'settings'> }) {
  return (
    <main className="screen" data-testid={tab}>
      <h1 className="screen-title">{TAB_LABELS[tab]}</h1>
      <div className="card">
        <StateMessage icon={tab} title="Coming next" detail="This screen is built once the looks of the others are agreed." testId="coming-next" />
      </div>
    </main>
  );
}
