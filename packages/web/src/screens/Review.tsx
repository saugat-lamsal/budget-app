import type { PickTo, ReviewDetail } from '@budget-app/money';
import type { ReviewView } from '@budget-app/server/views';
import { newDecisionId, type Load, type Reload } from '../app/api.js';
import { Button, ButtonRow, Card, Decision, Hero, HeroCount, MadeUpPill, Money, Skeleton, StateMessage } from '../ui/blocks.js';
import { longDate, shortDate } from '../ui/dates.js';
import { ChoiceSheet, LeftoverDecision, LikelyPurchases, SaidNotice, askFor, subjectOfReview, useChoiceFlow, type Choose, type Kind, type Pending, type Target } from './choose.js';
import { ACCOUNT_NAMES, groupTitle, pickLabel, reasonText, titleOf } from './review-text.js';

// Review: everything waiting for him to decide, one tap each. Every choice
// shown is one the money math offers for that kind of item (the server sends
// them with the item); the screen decides nothing. A tap sends the choice
// and the server's money math does the rest. The same decision sent twice
// changes nothing the second time, a refused choice changes nothing and says
// why, and anything final asks first. The choosing itself is shared with the
// lists of what went in and out of a bucket (choose.tsx).

export function ReviewScreen({ load, onRetry, onChanged }: { readonly load: Load<ReviewView>; readonly onRetry: Reload; readonly onChanged: Reload }) {
  return (
    <main className="screen" aria-busy={load.status === 'loading'} data-testid="review">
      <h1 className="sr-only">Review</h1>
      {load.status === 'loading' && <ReviewLoading />}
      {load.status === 'error' && (
        <StateMessage icon="alert" tone="danger" title="Couldn't load what is waiting" detail="Check your connection, then try again." testId="review-error">
          <Button onClick={() => onRetry()} testId="retry">
            Try again
          </Button>
        </StateMessage>
      )}
      {load.status === 'ready' && load.value.state === 'not-set-up' && (
        <>
          {load.value.madeUpData && <MadeUpPill />}
          <StateMessage icon="bank" title="Nothing to review yet" detail="Setup day reads your bank balances and lets you hand out your starting money. New activity waits here after that." testId="review-not-set-up" />
        </>
      )}
      {load.status === 'ready' && load.value.state === 'tracking' && <ReviewReady view={load.value} reload={onRetry} onChanged={onChanged} />}
    </main>
  );
}

function ReviewLoading() {
  return (
    <div data-testid="review-loading" style={{ display: 'contents' }}>
      <span className="sr-only">Loading what is waiting</span>
      <div className="hero" aria-hidden="true">
        <Skeleton width="9rem" height="1rem" />
        <Skeleton width="5rem" height="3rem" />
        <Skeleton width="14rem" height="1rem" />
      </div>
      <div className="card card--padded" aria-hidden="true" style={{ display: 'grid', gap: '12px' }}>
        <Skeleton width="60%" height="1rem" />
        <Skeleton width="80%" height="1rem" />
        <Skeleton width="50%" height="1rem" />
      </div>
    </div>
  );
}

type Tracking = Extract<ReviewView, { state: 'tracking' }>;

const targetOf = (detail: ReviewDetail): Target => ({ id: detail.item.id, label: titleOf(detail.item), kind: detail.item.type });

function ReviewReady({ view, reload, onChanged }: { readonly view: Tracking; readonly reload: Reload; readonly onChanged: Reload }) {
  const flow = useChoiceFlow({ resort: false, reload, onChanged });
  const { sheet, said, sending, setSaid, submit, choose, openSheet } = flow;

  const byId = new Map(view.items.map((d) => [d.item.id, d]));
  const open = sheet === null ? undefined : byId.get(sheet.item);

  const groups: { readonly type: Kind; readonly items: ReviewDetail[] }[] = [];
  for (const d of view.items) {
    const last = groups.at(-1);
    if (last?.type === d.item.type) last.items.push(d);
    else groups.push({ type: d.item.type, items: [d] });
  }

  const waiting = view.items.length;
  return (
    <>
      <div className="eyebrow">
        <span>{longDate(view.today)}</span>
        {view.madeUpData && <MadeUpPill />}
      </div>

      {said !== null && sheet === null && <SaidNotice said={said} sending={sending} onRetry={submit} onDismiss={() => setSaid(null)} sticky />}

      <Hero
        label="Waiting in review"
        testId="review-hero"
        sub={
          waiting === 0 ? (
            "You're all caught up."
          ) : view.heldBack > 0 ? (
            <span>
              <Money cents={view.heldBack} testId="held-back" /> held back from safe to spend until sorted.
            </span>
          ) : view.heldBack < 0 ? (
            // Money back that has not been sorted yet adds to safe to spend (11.1).
            <span>
              Safe to spend is <Money cents={-view.heldBack} testId="raised-by" /> higher until sorted.
            </span>
          ) : (
            'Nothing is held back from safe to spend.'
          )
        }
      >
        <HeroCount count={waiting} testId="review-count" />
      </Hero>

      {waiting === 0 && <StateMessage icon="check" title="Nothing is waiting" detail="New activity that needs a decision shows up here." testId="review-empty" />}

      {groups.map((group) => (
        <Card key={group.type} title={groupTitle(group.type)} testId={`group-${group.type}`}>
          {group.items.map((d) => (
            <ItemCard key={d.item.id} detail={d} busy={sending} onChoose={choose} onSend={submit} onMore={() => openSheet(d.item.id)} />
          ))}
        </Card>
      ))}

      <ChoiceSheet flow={flow} itemId={open?.item.id} subject={open === undefined ? undefined : (subjectOfReview(open) ?? undefined)} title={open === undefined ? 'Choices' : titleOf(open.item)} testId="review-sheet" />
    </>
  );
}

// ----- One waiting item -----

// The two choices shown on the item itself: the suggested one first, then
// the usual ones in order. The rest are under "More choices".
const USUAL: readonly PickTo[] = ['paycheck', 'other-income', 'needs', 'wants', 'savings'];

function quickPicks(detail: ReviewDetail): { readonly to: PickTo; readonly final: boolean }[] {
  const o = detail.options;
  if (o.type !== 'sort') return [];
  const suggestion = detail.item.type === 'spending' ? detail.item.suggestion : null;
  const order = [...(suggestion === null ? [] : [suggestion]), ...USUAL];
  const found: { to: PickTo; final: boolean }[] = [];
  for (const to of order) {
    const pick = o.picks.find((p) => p.to === to);
    if (pick !== undefined && !found.some((f) => f.to === to)) found.push({ to, final: pick.final });
  }
  return found.slice(0, 2);
}

function ItemCard({
  detail,
  busy,
  onChoose,
  onSend,
  onMore,
}: {
  readonly detail: ReviewDetail;
  readonly busy: boolean;
  readonly onChoose: Choose;
  readonly onSend: (pending: Pending) => void;
  readonly onMore: () => void;
}) {
  const { item, options } = detail;
  const testId = `item-${item.id}`;
  const where = detail.account === null ? '' : ` · ${ACCOUNT_NAMES[detail.account]}`;

  if (item.type === 'leftover' && options.type === 'leftover') return <LeftoverDecision detail={detail} busy={busy} onChoose={onChoose} />;

  if (item.type === 'old-card-purchase') {
    return (
      <Decision
        testId={testId}
        title={titleOf(item)}
        amount={<Money cents={item.amount} testId="item-amount" />}
        detail={`${reasonText(item)} · ${shortDate(item.date)}${where}`}
        status={detail.pending ? 'pending' : undefined}
        actions={
          <Button
            wide
            disabled={busy}
            testId="acknowledge"
            onClick={() => onSend({ id: newDecisionId(), item: item.id, label: titleOf(item), kind: item.type, choice: { acknowledge: true } })}
          >
            Got it
          </Button>
        }
      >
        <p className="decision__detail">It raises the old card debt. It touches a bucket only when you pay it.</p>
      </Decision>
    );
  }

  if ((item.type === 'spending' || item.type === 'money-in') && options.type === 'sort') {
    const kind = item.type;
    const picks = quickPicks(detail);
    const subject = subjectOfReview(detail);
    return (
      <Decision
        testId={testId}
        title={titleOf(item)}
        amount={<Money cents={item.amount} testId="item-amount" />}
        detail={`${reasonText(item)} · ${shortDate(item.date)}${where}`}
        status={detail.pending ? 'pending' : undefined}
        actions={
          <>
            <ButtonRow>
              {picks.map((pick, i) => (
                <Button
                  key={pick.to}
                  variant={i === 0 ? 'primary' : 'secondary'}
                  disabled={busy}
                  testId={`pick-${pick.to}`}
                  onClick={() => onChoose(targetOf(detail), { to: pick.to }, { final: pick.final, ask: askFor(detail.paycheckPreview, item.date, pick.to) })}
                >
                  {pickLabel(kind, pick.to, true)}
                </Button>
              ))}
            </ButtonRow>
            <Button variant="plain" wide onClick={onMore} disabled={busy} testId="more">
              More choices
            </Button>
          </>
        }
      >
        {item.type === 'money-in' && subject !== null && (subject.refund || subject.likely.length > 0) && <LikelyPurchases subject={subject} busy={busy} onChoose={onChoose} />}
      </Decision>
    );
  }
  return null;
}
