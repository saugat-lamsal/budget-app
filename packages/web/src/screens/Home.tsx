import type { SelfCheck } from '@budget-app/money';
import type { Attention, HomeView } from '@budget-app/server/views';
import { useState } from 'react';
import type { Load } from '../app/api.js';
import { pathOf } from '../app/routes.js';
import { Banner, BottomSheet, BucketBar, Button, Card, ListRow, Money, Skeleton, StateMessage, StatusLabel } from '../ui/blocks.js';
import { longDate, shortDate } from '../ui/dates.js';
import { Icon } from '../ui/Icon.js';
import { dueText, paydayText, waitingText } from './home-text.js';

// Home: safe to spend is the one main number. Below it, what needs
// attention, then needs and wants as compact bars.

export function HomeScreen({ load, onRetry }: { readonly load: Load<HomeView>; readonly onRetry: () => void }) {
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="home">
      <h1 className="sr-only">Home</h1>
      {load.status === 'loading' && <HomeLoading />}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't load your numbers" detail="Check your connection, then try again." testId="home-error">
          <Button onClick={onRetry} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && (
        <>
          {load.value.madeUpData && <MadeUpData />}
          <StateMessage
            icon="bank"
            title="Not set up yet"
            detail="Setup day reads your bank balances and lets you hand out your starting money. Your numbers show here after that."
            testId="home-not-set-up"
          />
        </>
      )}
      {load.status === 'ready' && load.value.state === 'tracking' && <HomeReady view={load.value} />}
    </main>
  );
}

function MadeUpData() {
  return (
    <span className="pill" data-testid="made-up">
      <Icon name="info" size={12} />
      Made-up data
    </span>
  );
}

function HomeLoading() {
  return (
    <div data-testid="home-loading" style={{ display: 'contents' }}>
      <span className="sr-only">Loading your numbers</span>
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

type Tracking = Extract<HomeView, { state: 'tracking' }>;

function HomeReady({ view }: { readonly view: Tracking }) {
  const [sheet, setSheet] = useState<'check' | 'savings' | null>(null);
  const close = (): void => setSheet(null);
  const { safeToSpend, payday } = view;
  const savings = view.attention.find((a) => a.kind === 'move-to-savings');

  const paydayLine = (
    <p className="hero__sub" data-testid="payday">
      <span>{paydayText(payday.days)}</span>
      <span aria-hidden="true">·</span>
      <span>{shortDate(payday.next)}</span>
    </p>
  );

  return (
    <>
      <div className="eyebrow">
        <span>{longDate(view.today)}</span>
        {view.madeUpData && <MadeUpData />}
      </div>

      {safeToSpend.shown ? (
        <section className="hero" aria-labelledby="safe-to-spend-label">
          <h2 id="safe-to-spend-label" className="hero__label">
            Safe to spend
          </h2>
          <Money cents={safeToSpend.amount} hero testId="safe-to-spend" />
          {paydayLine}
        </section>
      ) : safeToSpend.why === 'totals-do-not-match' ? (
        <Banner tone="danger" icon="alert" title="Totals do not match the bank" testId="mismatch">
          <p className="banner__big">
            Off by <Money cents={Math.abs(safeToSpend.check.difference)} testId="mismatch-amount" />
          </p>
          <p className="banner__body">
            The bank shows {safeToSpend.check.difference > 0 ? 'more' : 'less'} than your buckets add up to. Safe to spend is hidden until they match.
          </p>
          <Button variant="secondary" onClick={() => setSheet('check')} testId="see-check">
            See the numbers
          </Button>
          {paydayLine}
        </Banner>
      ) : (
        <Banner tone="warning" icon="alert" title="Can't check against the bank" testId="bank-not-read">
          <p className="banner__body">Safe to spend is hidden until the bank can be read again.</p>
          {paydayLine}
        </Banner>
      )}

      <Card title="Needs attention" testId="attention">
        {view.attention.length === 0 ? (
          <ListRow icon="check" tone="ok" title="Nothing needs you right now" testId="all-clear" />
        ) : (
          view.attention.map((item) => <AttentionRow key={rowKey(item)} item={item} onSavings={() => setSheet('savings')} />)
        )}
      </Card>

      <Card title="This pay period" testId="buckets">
        <BucketBar name="Needs" {...view.buckets.needs} testId="bucket-needs" />
        <BucketBar name="Wants" {...view.buckets.wants} testId="bucket-wants" />
        <ListRow title="All buckets" href={pathOf('buckets')} testId="all-buckets" />
      </Card>

      {!safeToSpend.shown && safeToSpend.why === 'totals-do-not-match' && (
        <BottomSheet open={sheet === 'check'} title="The daily check" onClose={close} testId="check-sheet">
          <CheckFigures check={safeToSpend.check} />
        </BottomSheet>
      )}
      {savings !== undefined && savings.kind === 'move-to-savings' && (
        <BottomSheet open={sheet === 'savings'} title="Money for savings" onClose={close} testId="savings-sheet">
          <div className="card">
            <dl className="figures">
              <dt>Savings plus mom reserve</dt>
              <dd>
                <Money cents={savings.shouldBeInSavings} testId="savings-should" />
              </dd>
              <dt>In the savings account</dt>
              <dd>
                <Money cents={savings.savingsAccountBalance} testId="savings-holds" />
              </dd>
              <dt className="figures__total">Still to move</dt>
              <dd className="figures__total">
                <Money cents={savings.stillToMove} testId="savings-to-move" />
              </dd>
            </dl>
          </div>
          <p className="sheet__note">Move it from checking to savings in your bank's app. This app never moves money.</p>
        </BottomSheet>
      )}
    </>
  );
}

// 12.3: bank side plus money in transit, minus app side.
function CheckFigures({ check }: { readonly check: SelfCheck }) {
  return (
    <>
      <div className="card">
        <dl className="figures">
          <dt>The bank: checking + savings − everyday card</dt>
          <dd>
            <Money cents={check.bankSide} testId="check-bank" />
          </dd>
          <dt>Money on its way between your accounts</dt>
          <dd>
            <Money cents={check.inTransit} testId="check-transit" />
          </dd>
          <dt>Your buckets added up</dt>
          <dd>
            <Money cents={check.appSide} testId="check-app" />
          </dd>
          <dt className="figures__total">Difference</dt>
          <dd className="figures__total">
            <Money cents={check.difference} testId="check-difference" />
          </dd>
        </dl>
      </div>
      <p className="sheet__note">The bank plus money on its way should equal your buckets to the cent. Something the app has not seen, or has counted wrong, makes the difference.</p>
    </>
  );
}

function rowKey(item: Attention): string {
  return item.kind === 'card-due' || item.kind === 'card-overdue' ? `${item.kind}-${item.card}` : item.kind;
}

const CARD_NAMES = { 'everyday-card': 'Everyday card', 'old-card': 'Old card' } as const;

function AttentionRow({ item, onSavings }: { readonly item: Attention; readonly onSavings: () => void }) {
  const testId = `attention-${rowKey(item)}`;
  switch (item.kind) {
    case 'bank-login':
      return <ListRow icon="lock" tone="warning" title="Log in to the bank again" detail="New activity can't come in until you do." testId={testId} />;
    case 'card-overdue':
      return (
        <ListRow
          icon="alert"
          tone="danger"
          title={
            <>
              {CARD_NAMES[item.card]} payment <StatusLabel status="overdue" />
            </>
          }
          detail={
            <>
              Minimum <Money cents={item.minimumPayment} /> was due {shortDate(item.dueDate)}.
            </>
          }
          testId={testId}
        />
      );
    case 'review':
      return (
        <ListRow
          icon="tray"
          title={waitingText(item.waiting)}
          detail={
            item.heldBack > 0 ? (
              <>
                <Money cents={item.heldBack} testId="held-back" /> held back from safe to spend until sorted.
              </>
            ) : (
              'Sort them when you have a minute.'
            )
          }
          href={pathOf('review')}
          testId={testId}
        />
      );
    case 'move-to-savings':
      return (
        <ListRow
          icon="move"
          title={
            <>
              Move <Money cents={item.stillToMove} testId="move-amount" /> to savings
            </>
          }
          detail="Your savings account holds less than it should."
          onClick={onSavings}
          testId={testId}
        />
      );
    case 'card-due':
      return (
        <ListRow
          icon="card"
          title={`${CARD_NAMES[item.card]} ${dueText(item.daysLeft)}`}
          detail={
            item.card === 'everyday-card' ? (
              <>
                {shortDate(item.dueDate)}. Statement <Money cents={item.statementBalance} />, minimum <Money cents={item.minimumPayment} />.
              </>
            ) : (
              <>
                {shortDate(item.dueDate)}. Minimum <Money cents={item.minimumPayment} />.
              </>
            )
          }
          testId={testId}
        />
      );
  }
}
