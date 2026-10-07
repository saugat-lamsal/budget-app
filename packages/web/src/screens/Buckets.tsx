import type { BucketsView } from '@budget-app/server/views';
import type { Load, Reload } from '../app/api.js';
import { pathOf } from '../app/routes.js';
import { Banner, BucketBar, Button, Card, Hero, ListRow, MadeUpPill, Money, Skeleton, StateMessage, TargetBar } from '../ui/blocks.js';
import { longDate, monthName } from '../ui/dates.js';
import { Icon } from '../ui/Icon.js';

// Buckets: what is left in each bucket, the mom reserve with this month
// against the target, money held for others, and the old card debt. The one
// main number is everything in the buckets (12.2). Every number comes from
// the server, worked out by the money math.

export function BucketsScreen({ load, onRetry }: { readonly load: Load<BucketsView>; readonly onRetry: Reload }) {
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="buckets">
      <h1 className="sr-only">Buckets</h1>
      {load.status === 'loading' && <BucketsLoading />}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't load your buckets" detail="Check your connection, then try again." testId="buckets-error">
          <Button onClick={() => onRetry()} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && (
        <>
          {load.value.madeUpData && <MadeUpPill />}
          <StateMessage icon="bank" title="No buckets yet" detail="Setup day reads your bank balances and lets you hand out your starting money. Your buckets show here after that." testId="buckets-not-set-up" />
        </>
      )}
      {load.status === 'ready' && load.value.state === 'tracking' && <BucketsReady view={load.value} />}
    </main>
  );
}

function BucketsLoading() {
  return (
    <div data-testid="buckets-loading" style={{ display: 'contents' }}>
      <span className="sr-only">Loading your buckets</span>
      <div className="hero" aria-hidden="true">
        <Skeleton width="7rem" height="1rem" />
        <Skeleton width="13rem" height="3rem" />
        <Skeleton width="10rem" height="1rem" />
      </div>
      <div className="card card--padded" aria-hidden="true" style={{ display: 'grid', gap: '12px' }}>
        <Skeleton width="60%" height="1rem" />
        <Skeleton width="80%" height="1rem" />
        <Skeleton width="50%" height="1rem" />
      </div>
    </div>
  );
}

type Tracking = Extract<BucketsView, { state: 'tracking' }>;

// 7.3, B22
const HELD_WORDS = {
  settled: 'Settled: nothing held either way',
  'holding-for-others': "Holding money that isn't yours",
  'owed-to-you': 'Someone owes you',
} as const;

function BucketsReady({ view }: { readonly view: Tracking }) {
  const { check, momReserve, heldForOthers, waiting } = view;
  return (
    <>
      <div className="eyebrow">
        <span>{longDate(view.today)}</span>
        {view.madeUpData && <MadeUpPill />}
      </div>

      {check.state === 'does-not-match' && (
        <Banner tone="danger" icon="alert" title="Totals do not match the bank" testId="mismatch">
          <p className="banner__big">
            Off by <Money cents={Math.abs(check.difference)} testId="mismatch-amount" />
          </p>
          <p className="banner__body">The bank shows {check.difference > 0 ? 'more' : 'less'} than your buckets add up to. Home has the numbers behind it.</p>
          <ListRow title="Open Home" href={pathOf('home')} testId="see-home" />
        </Banner>
      )}

      <Hero
        label="In your buckets"
        testId="buckets-hero"
        sub={
          check.state === 'matches' ? (
            <>
              <Icon name="check" size={16} />
              <span data-testid="check-line">Matches your bank, to the cent</span>
            </>
          ) : check.state === 'bank-not-read' ? (
            <>
              <Icon name="clock" size={16} />
              <span data-testid="check-line">Can't reach the bank to check this now</span>
            </>
          ) : undefined
        }
      >
        <Money cents={view.total} hero testId="buckets-total" />
      </Hero>

      <Card title="This pay period" testId="pay-period">
        <BucketBar name="Needs" {...view.needs} testId="bucket-needs" />
        <BucketBar name="Wants" {...view.wants} testId="bucket-wants" />
      </Card>

      <Card title="Savings and reserves" testId="reserves">
        <ListRow icon="bank" title="Savings" trailing={<Money cents={view.savings} testId="savings" />} testId="row-savings" />
        <TargetBar
          testId="mom"
          name="Mom reserve"
          amount={<Money cents={momReserve.amount} testId="mom-reserve" />}
          caption={
            <>
              Sent in {monthName(momReserve.month)}: <Money cents={momReserve.sent} testId="mom-sent" />. Target <Money cents={momReserve.target.low} testId="mom-target-low" /> to{' '}
              <Money cents={momReserve.target.high} testId="mom-target-high" />.
            </>
          }
          sent={momReserve.sent}
          low={momReserve.target.low}
          high={momReserve.target.high}
          position={momReserve.position}
        />
        <ListRow
          icon="people"
          title="Held for others"
          detail={HELD_WORDS[heldForOthers.meaning]}
          trailing={<Money cents={heldForOthers.heldForOthers} testId="held-for-others" />}
          testId="row-held"
        />
      </Card>

      {waiting.count > 0 && (
        <Card title="Not in a bucket yet" testId="waiting">
          <ListRow
            icon="tray"
            title={`${waiting.count} waiting in review`}
            detail={
              <>
                {waiting.moneyIn !== 0 && (
                  <>
                    <Money cents={waiting.moneyIn} testId="waiting-in" /> coming in.{' '}
                  </>
                )}
                {waiting.spending !== 0 && (
                  <>
                    <Money cents={waiting.spending} testId="waiting-out" /> going out.
                  </>
                )}
                {waiting.moneyIn === 0 && waiting.spending === 0 && 'Questions to answer. No money is waiting.'}
              </>
            }
            href={pathOf('review')}
            testId="row-waiting"
          />
        </Card>
      )}

      <Card title="Old card" testId="old-card">
        <ListRow
          icon="card"
          title="Debt on the old card"
          detail={view.oldCard < 0 ? "You've paid more than it owed, so this is a credit. It is not part of your buckets." : 'Not part of your buckets.'}
          trailing={<Money cents={view.oldCard} testId="old-card-debt" />}
          testId="row-old-card"
        />
      </Card>
    </>
  );
}
