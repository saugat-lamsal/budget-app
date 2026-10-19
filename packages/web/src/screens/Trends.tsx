import type { PlaceGroup, TrendsItem, TrendsPart, TrendsPeriod, TrendsView } from '@budget-app/server/views';
import { useState } from 'react';
import type { Load, Reload } from '../app/api.js';
import { BottomSheet, Button, Card, Hero, ListRow, MadeUpPill, Money, Segmented, Skeleton, StateMessage } from '../ui/blocks.js';
import { ChartLegend, LineChart, StackedBars } from '../ui/charts.js';
import { monthDay, shortDate } from '../ui/dates.js';
import { moneyWords } from '../ui/money-format.js';
import { CheckBanner } from './check-banner.js';
import { barWords, dayOfText, paceWords, partName, periodNote, periodRange, periodShort, placeGroupName, sinceText, usualLines } from './trends-text.js';

// The Trends tab (rulebook section 40, QUESTIONS.md A58): Past, what was
// spent each pay period, savings over time and where it went; Now, this pay
// period against your usual and Wants against an even pace. Every number is
// the server's, worked out from the books and the bank history kept from
// before setup day. It only reads and never sends anything. The one main
// number is what was spent so far this pay period.

const PARTS: readonly TrendsPart[] = ['needs', 'wants', 'old-card', 'unsorted'];
type Segment = 'past' | 'now';
type Tracking = Extract<TrendsView, { state: 'tracking' }>;
type Sheet = { readonly kind: 'period'; readonly index: number } | { readonly kind: 'place'; readonly index: number } | null;

export function TrendsScreen({ load, onRetry }: { readonly load: Load<TrendsView>; readonly onRetry: Reload }) {
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="trends">
      {load.status === 'loading' && <TrendsLoading />}
      {load.status === 'error' && (
        <>
          <h1 className="sr-only">Trends</h1>
          <StateMessage icon="alert" tone="danger" title="Couldn't load Trends" detail="Check your connection, then try again." testId="trends-error">
            <Button onClick={() => onRetry()} testId="retry">
              Try again
            </Button>
          </StateMessage>
        </>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && (
        <>
          <h1 className="sr-only">Trends</h1>
          {load.value.madeUpData && <MadeUpPill />}
          <StateMessage icon="trends" title="No trends yet" detail="Trends starts after setup day. It shows what you spent each pay period, your savings over time, and where your money went." testId="trends-not-set-up" />
        </>
      )}
      {load.status === 'ready' && load.value.state === 'tracking' && <TrendsReady view={load.value} />}
    </main>
  );
}

function TrendsLoading() {
  return (
    <div data-testid="trends-loading" style={{ display: 'contents' }}>
      <h1 className="sr-only">Trends</h1>
      <span className="sr-only">Loading Trends</span>
      <div className="hero" aria-hidden="true">
        <Skeleton width="9rem" height="1rem" />
        <Skeleton width="12rem" height="3rem" />
      </div>
      <div className="card card--padded" aria-hidden="true" style={{ display: 'grid', gap: '12px' }}>
        <Skeleton width="50%" height="1rem" />
        <Skeleton width="100%" height="8rem" />
      </div>
    </div>
  );
}

function TrendsReady({ view }: { readonly view: Tracking }) {
  const [segment, setSegment] = useState<Segment>('past');
  const [picked, setPicked] = useState(view.periods.length - 1);
  const [sheet, setSheet] = useState<Sheet>(null);
  const here = view.periods[view.periods.length - 1] as TrendsPeriod;
  const sheetPeriod = sheet?.kind === 'period' ? view.periods[sheet.index] : undefined;
  const sheetPlace = sheet?.kind === 'place' ? view.places.groups[sheet.index] : undefined;
  return (
    <>
      <div className="eyebrow">
        <span data-testid="trends-since">{sinceText(view.historyFrom, view.setupDay)}</span>
        {view.madeUpData && <MadeUpPill />}
      </div>
      <h1 className="screen-title">Trends</h1>

      <CheckBanner check={view.check} />

      <Hero label="Spent this pay period" testId="trends-hero" sub={<span data-testid="trends-hero-sub">{periodRange(here)}, so far. Old card payments left out.</span>}>
        <Money cents={view.now.spentSoFar} hero roll testId="trends-spent-so-far" />
      </Hero>

      <Segmented<Segment>
        label="Show"
        options={[
          { value: 'past', label: 'Past' },
          { value: 'now', label: 'Now' },
        ]}
        value={segment}
        onChange={setSegment}
        testId="trends-segment"
      />

      {segment === 'past' ? (
        <Past
          view={view}
          picked={picked}
          onPick={(index) => {
            setPicked(index);
            setSheet({ kind: 'period', index });
          }}
          onPlace={(index) => setSheet({ kind: 'place', index })}
        />
      ) : (
        <Now view={view} />
      )}

      <BottomSheet open={sheetPeriod !== undefined} title={sheetPeriod === undefined ? 'Pay period' : periodRange(sheetPeriod)} onClose={() => setSheet(null)} testId="period-sheet">
        {sheetPeriod !== undefined && <PeriodDetail period={sheetPeriod} />}
      </BottomSheet>
      <BottomSheet open={sheetPlace !== undefined} title={sheetPlace === undefined ? 'Place' : placeGroupName(sheetPlace)} onClose={() => setSheet(null)} testId="place-sheet">
        {sheetPlace !== undefined && <PlaceDetail group={sheetPlace} />}
      </BottomSheet>
    </>
  );
}

// ----- Past -----

function Past({ view, picked, onPick, onPlace }: { readonly view: Tracking; readonly picked: number; readonly onPick: (index: number) => void; readonly onPlace: (index: number) => void }) {
  const selected = view.periods[Math.min(picked, view.periods.length - 1)] as TrendsPeriod;
  const note = periodNote(selected);
  const anyBefore = view.periods.some((p) => p.beforeSetup !== 'none');
  return (
    <>
      <Card title="Spent each pay period" padded testId="trends-periods">
        <div className="trend-total">
          <span data-testid="period-range">{periodRange(selected)}</span>
          <span className="trend-total__amount">
            <Money cents={selected.total} roll testId="period-total" />
          </span>
        </div>
        {note !== null && (
          <p className="trend-note" data-testid="period-note">
            {note}
          </p>
        )}
        <StackedBars
          label="Spent each pay period. Tap a pay period to see what is in it."
          testId="period-bar"
          onPick={(key) => onPick(Number(key))}
          bars={view.periods.map((p, i) => ({
            key: String(i),
            label: periodShort(p),
            words: barWords(p),
            parts: PARTS.map((part) => ({ tone: part, cents: p.spent[part] })),
            lighter: p.beforeSetup === 'all',
            selected: p === selected,
          }))}
        />
        <ChartLegend items={PARTS.map((part) => ({ tone: part, label: partName(part) }))} />
        <div className="list" data-testid="period-parts">
          {PARTS.map((part) => (
            <ListRow key={part} title={partName(part)} trailing={<Money cents={selected.spent[part]} testId={`period-part-${part}`} />} testId={`period-part-row-${part}`} />
          ))}
        </div>
        {anyBefore && <p className="trend-note">Pay periods before setup day ({monthDay(view.setupDay)}) are read from the bank&rsquo;s history by today&rsquo;s rules, drawn lighter. Your books do not change.</p>}
      </Card>

      <Savings view={view} />

      <Card title="Where it went · last 90 days" padded testId="trends-places">
        {view.places.groups.length === 0 ? (
          <p className="trend-note" data-testid="places-empty">
            Nothing spent in the last 90 days.
          </p>
        ) : (
          <>
            <div className="list">
              {view.places.groups.map((g, i) => (
                <ListRow
                  key={`${g.kind}-${g.name}`}
                  title={placeGroupName(g)}
                  detail={
                    <span className="place-bar" aria-hidden="true">
                      <span className="place-bar__fill" style={{ display: 'block', width: `${share(g.amount, view.places.groups)}%` }} />
                    </span>
                  }
                  trailing={<Money cents={g.amount} testId={`place-amount-${i}`} />}
                  onClick={() => onPlace(i)}
                  testId={`place-${i}`}
                />
              ))}
            </div>
            <div className="trend-total" style={{ marginTop: 'var(--space-3)' }}>
              <span>
                In all, {monthDay(view.places.from)} – {monthDay(view.places.to)}
              </span>
              <Money cents={view.places.total} testId="places-total" />
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function share(amount: number, groups: readonly PlaceGroup[]): number {
  const most = Math.max(1, ...groups.map((g) => g.amount));
  return Math.max(0, Math.min(100, (amount / most) * 100));
}

function Savings({ view }: { readonly view: Tracking }) {
  const now = view.savings[view.savings.length - 1];
  if (now === undefined) return null;
  const first = view.savings[0] ?? now;
  return (
    <Card title="Savings" padded testId="trends-savings">
      <div className="list">
        <ListRow title="Savings" trailing={<Money cents={now.savings} testId="savings-now" />} />
        <ListRow title="Mom reserve" trailing={<Money cents={now.momReserve} testId="mom-now" />} />
      </div>
      <LineChart
        testId="savings-chart"
        length={view.savings.length}
        label={`Savings from ${moneyWords(first.savings)} on ${monthDay(first.date)} to ${moneyWords(now.savings)} now; the mom reserve from ${moneyWords(first.momReserve)} to ${moneyWords(now.momReserve)}.`}
        lines={[
          { key: 'savings', tone: 'savings', values: view.savings.map((p) => p.savings) },
          { key: 'mom', tone: 'mom', values: view.savings.map((p) => p.momReserve), dashed: true },
        ]}
      />
      <ChartLegend
        items={[
          { tone: 'savings', label: 'Savings' },
          { tone: 'mom', label: 'Mom reserve', dashed: true },
        ]}
      />
      <p className="trend-note">Since setup day ({monthDay(view.setupDay)}), at the end of each pay period. Nothing before: the buckets did not exist then.</p>
    </Card>
  );
}

// ----- Now -----

function Now({ view }: { readonly view: Tracking }) {
  const w = view.now.wants;
  const words = paceWords(w.pace);
  const usual = usualLines(view.now.usual, view.now.day);
  const length = Math.max(w.line.length, w.pace.state === 'pace' ? w.pace.points.length : 0);
  return (
    <>
      <Card title="Wants against an even pace" padded testId="trends-pace">
        <ListRow icon={words.icon} tone={words.tone} title={<span data-testid="pace-words">{words.title}</span>} detail={<span data-testid="pace-day">{dayOfText(w.day, w.days)}</span>} />
        <LineChart
          testId="pace-chart"
          length={length}
          label={`Wants left each day of this pay period, ending at ${moneyWords(w.left)} today${w.pace.state === 'pace' ? `, against an even pace that leaves ${moneyWords(w.pace.today)} today` : ''}.`}
          lines={[
            ...(w.pace.state === 'pace' ? [{ key: 'pace', tone: 'pace' as const, values: w.pace.points.map((p) => p.left), dashed: true }] : []),
            { key: 'wants', tone: 'wants', values: w.line.map((p) => p.left) },
          ]}
        />
        <ChartLegend
          items={[
            { tone: 'wants', label: 'Wants left' },
            ...(w.pace.state === 'pace' ? [{ tone: 'pace' as const, label: 'Even pace', dashed: true }] : []),
          ]}
        />
        <div className="list">
          <ListRow title="Wants holds now" trailing={<Money cents={w.left} testId="pace-left" />} />
          {w.pace.state === 'pace' && <ListRow title="An even pace leaves today" trailing={<Money cents={w.pace.today} testId="pace-today" />} />}
          <ListRow title="Wants started this pay period with" trailing={<Money cents={w.startedWith} testId="pace-started" />} />
        </div>
        <p className="trend-note">Spending waiting in Review is not in Wants until it is sorted, so this is not safe to spend.</p>
      </Card>

      <Card title="This pay period against your usual" padded testId="trends-usual">
        <div className="list">
          <ListRow title={`So far, day ${view.now.day}`} trailing={<Money cents={view.now.spentSoFar} testId="usual-so-far" />} />
          {view.now.usual.state === 'known' && (
            <>
              <ListRow title={`Usual by day ${view.now.day}`} trailing={<Money cents={view.now.usual.byToday} testId="usual-by-today" />} />
              <ListRow title="A whole pay period usually" trailing={<Money cents={view.now.usual.whole} testId="usual-whole" />} />
            </>
          )}
        </div>
        <p className="trend-note" data-testid="usual-note">
          {view.now.usual.state === 'known' ? usual[2] : `${usual[0]} ${usual[1]}`}
        </p>
      </Card>
    </>
  );
}

// ----- What is behind a bar, or a place -----

function Items({ items, testId }: { readonly items: readonly TrendsItem[]; readonly testId: string }) {
  if (items.length === 0) return <p className="sheet__note">Nothing spent.</p>;
  return (
    <div className="list" data-testid={testId}>
      {items.map((item) => (
        <ListRow
          key={`${item.id}-${item.part}`}
          title={item.description === '' ? 'No longer in your books' : item.description}
          detail={`${shortDate(item.date)} · ${partName(item.part)}${item.beforeSetup ? ' · before setup day' : ''}`}
          trailing={<Money cents={item.amount} testId={`${testId}-amount-${item.id}-${item.part}`} />}
          testId={`${testId}-${item.id}-${item.part}`}
        />
      ))}
    </div>
  );
}

function PeriodDetail({ period }: { readonly period: TrendsPeriod }) {
  const note = periodNote(period);
  return (
    <>
      {note !== null && <p className="sheet__note">{note}</p>}
      <div className="list">
        {PARTS.map((part) => (
          <ListRow key={part} title={partName(part)} trailing={<Money cents={period.spent[part]} testId={`sheet-part-${part}`} />} />
        ))}
        <ListRow title="In all" trailing={<Money cents={period.total} testId="sheet-total" />} />
      </div>
      <Items items={period.items} testId="sheet-item" />
    </>
  );
}

function PlaceDetail({ group }: { readonly group: PlaceGroup }) {
  return (
    <>
      <div className="list">
        <ListRow title="In the last 90 days" trailing={<Money cents={group.amount} testId="place-sheet-total" />} />
      </div>
      <Items items={group.items} testId="place-item" />
    </>
  );
}
