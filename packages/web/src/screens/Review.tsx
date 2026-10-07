import { parseDollars, type Cents, type PickTo, type ReviewDetail } from '@budget-app/money';
import type { ChoiceOf, ChoicePart, ChoiceRequest, ReviewView } from '@budget-app/server/views';
import { useRef, useState, type ReactNode } from 'react';
import { newDecisionId, sendChoice, type Load, type Reload } from '../app/api.js';
import { BottomSheet, Button, ButtonRow, Card, Decision, Hero, HeroCount, ListRow, MadeUpPill, Money, Notice, Skeleton, StateMessage, TextField, ToggleRow } from '../ui/blocks.js';
import { longDate, shortDate } from '../ui/dates.js';
import { moneyText } from '../ui/money-format.js';
import { ACCOUNT_NAMES, BUCKET_NAMES, doneText, groupTitle, pickLabel, reasonText, sortedWords, titleOf } from './review-text.js';

// Review: everything waiting for him to decide, one tap each. Every choice
// shown is one the money math offers for that kind of item (the server sends
// them with the item); the screen decides nothing. A tap sends the choice
// and the server's money math does the rest. The same decision sent twice
// changes nothing the second time, a refused choice changes nothing and says
// why, and anything final asks first.

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
type Kind = ReviewDetail['item']['type'];

// One decision, made once: its number stays the same for every retry of it.
interface Pending {
  readonly id: string;
  readonly item: string;
  readonly label: string;
  readonly kind: Kind;
  readonly choice: ChoiceOf;
  readonly always?: { readonly contains: string };
  readonly confirmed?: boolean;
  // What the confirm step says.
  readonly ask?: ReactNode;
}

type Sheet = { readonly item: string; readonly step: 'choose' } | { readonly item: string; readonly step: 'confirm'; readonly pending: Pending };

interface Said {
  readonly tone: 'ok' | 'warning' | 'danger';
  readonly text: string;
  // Sending failed for want of a signal: the same decision can be sent again.
  readonly retry?: Pending;
}

function ReviewReady({ view, reload, onChanged }: { readonly view: Tracking; readonly reload: Reload; readonly onChanged: Reload }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [sending, setSending] = useState(false);
  // A second tap before the screen has redrawn must not send a second request.
  const lock = useRef(false);

  const byId = new Map(view.items.map((d) => [d.item.id, d]));
  const open = sheet === null ? undefined : byId.get(sheet.item);

  // Closing the sheet by hand drops a refusal he has read. The sheet also
  // closes by itself when a choice goes through (or the item was already
  // dealt with): that must not wipe what was just said.
  const closeSheet = (): void => {
    if (sheet === null) return;
    setSheet(null);
    setSaid(null);
  };

  // A sheet opened later does not show what was said about the last thing.
  const openSheet = (id: string): void => {
    setSaid(null);
    setSheet({ item: id, step: 'choose' });
  };

  const submit = (pending: Pending): void => {
    if (lock.current) return;
    lock.current = true;
    setSending(true);
    setSaid(null);
    const request: ChoiceRequest = {
      id: pending.id,
      item: pending.item,
      choice: pending.choice,
      ...(pending.always === undefined ? {} : { always: pending.always }),
      ...(pending.confirmed === true ? { confirmed: true } : {}),
    };
    sendChoice(request).then(
      (answer) => {
        lock.current = false;
        setSending(false);
        if (answer.ok) {
          setSheet(null);
          setSaid({ tone: 'ok', text: doneText(pending.label, pending.kind, answer.done) });
        } else if (answer.code === 'not-waiting') {
          setSheet(null);
          setSaid({ tone: 'warning', text: `${pending.label}: ${answer.why}` });
        } else {
          // Refused: nothing changed. Back to the choices, with the reason.
          setSheet((current) => (current === null ? null : { item: current.item, step: 'choose' }));
          setSaid({ tone: 'danger', text: answer.why });
          return;
        }
        reload('after');
        onChanged('after');
      },
      () => {
        lock.current = false;
        setSending(false);
        setSaid({ tone: 'danger', text: "Couldn't save that. Check your connection and try again. Nothing is counted twice.", retry: pending });
      },
    );
  };

  // A choice is made: final ones ask first, the rest are sent at once.
  const choose = (detail: ReviewDetail, choice: ChoiceOf, extra: { always?: { contains: string }; ask?: ReactNode; final?: boolean } = {}): void => {
    const pending: Pending = {
      id: newDecisionId(),
      item: detail.item.id,
      label: titleOf(detail.item),
      kind: detail.item.type,
      choice,
      ...(extra.always === undefined ? {} : { always: extra.always }),
      ...(extra.ask === undefined ? {} : { ask: extra.ask }),
    };
    if (extra.final === true || extra.always !== undefined) {
      setSaid(null);
      setSheet({ item: detail.item.id, step: 'confirm', pending });
    } else submit(pending);
  };

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

      <BottomSheet open={sheet !== null && open !== undefined} title={open === undefined ? 'Choices' : titleOf(open.item)} onClose={closeSheet} testId="review-sheet">
        {open !== undefined && sheet !== null && (
          <div key={open.item.id} style={{ display: 'contents' }}>
            {said !== null && <SaidNotice said={said} sending={sending} onRetry={submit} onDismiss={() => setSaid(null)} />}
            {/* The choices stay put (hidden) while it asks, so what was typed is still there after Cancel. */}
            <div hidden={sheet.step !== 'choose'} style={sheet.step === 'choose' ? { display: 'contents' } : undefined}>
              <Choices detail={open} busy={sending} onChoose={choose} />
            </div>
            {sheet.step === 'confirm' && <Confirm pending={sheet.pending} busy={sending} onYes={() => submit({ ...sheet.pending, confirmed: true })} onBack={() => setSheet({ item: open.item.id, step: 'choose' })} />}
          </div>
        )}
      </BottomSheet>
    </>
  );
}

function SaidNotice({ said, sending, onRetry, onDismiss, sticky = false }: { readonly said: Said; readonly sending: boolean; readonly onRetry: (pending: Pending) => void; readonly onDismiss: () => void; readonly sticky?: boolean }) {
  const retry = said.retry;
  return (
    <Notice
      tone={said.tone}
      icon={said.tone === 'ok' ? 'check' : 'alert'}
      sticky={sticky}
      testId="notice"
      action={
        retry !== undefined ? (
          <Button variant="secondary" onClick={() => onRetry(retry)} testId="notice-retry">
            {sending ? 'Saving…' : 'Try again'}
          </Button>
        ) : (
          <Button variant="plain" onClick={onDismiss} testId="notice-dismiss">
            OK
          </Button>
        )
      }
    >
      {said.text}
    </Notice>
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
  readonly onChoose: (detail: ReviewDetail, choice: ChoiceOf, extra?: { always?: { contains: string }; ask?: ReactNode; final?: boolean }) => void;
  readonly onSend: (pending: Pending) => void;
  readonly onMore: () => void;
}) {
  const { item, options } = detail;
  const testId = `item-${item.id}`;
  const where = detail.account === null ? '' : ` · ${ACCOUNT_NAMES[detail.account]}`;

  if (item.type === 'leftover' && options.type === 'leftover') {
    const bucket = BUCKET_NAMES[item.bucket] ?? item.bucket;
    return (
      <Decision
        testId={testId}
        title={titleOf(item)}
        amount={<Money cents={item.amount} testId="item-amount" />}
        detail={`${reasonText(item)} · ${shortDate(item.date)}`}
        actions={
          <ButtonRow>
            {options.answers.map((answer) => (
              <Button
                key={answer}
                variant={answer === 'roll-over' ? 'primary' : 'secondary'}
                disabled={busy}
                testId={`answer-${answer}`}
                onClick={() =>
                  onChoose(detail, { leftover: answer }, {
                    final: true,
                    ask: answer === 'roll-over' ? `Keep ${moneyText(item.amount)} in ${bucket} for this pay period?` : `Move ${moneyText(item.amount)} from ${bucket} to Savings?`,
                  })
                }
              >
                {answer === 'roll-over' ? 'Roll over' : 'Move to savings'}
              </Button>
            ))}
          </ButtonRow>
        }
      >
        <p className="decision__detail">Keep it in {bucket} for this pay period, or move it to Savings. Either answer is final.</p>
      </Decision>
    );
  }

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
                  onClick={() => onChoose(detail, { to: pick.to }, { final: pick.final, ask: askFor(detail, pick.to) })}
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
        {item.type === 'money-in' && item.reason === 'refund' && <LikelyPurchases detail={detail} />}
      </Decision>
    );
  }
  return null;
}

// What "are you sure" says for a final pick: for my paycheck, the split it would get.
function askFor(detail: ReviewDetail, to: PickTo): ReactNode {
  if (to !== 'paycheck' || detail.paycheckPreview === null) return undefined;
  const p = detail.paycheckPreview;
  return (
    <>
      <p>
        This starts a new pay period on {shortDate(detail.item.date)}, the day it arrived. A paycheck can't be undone here.
      </p>
      <div className="card">
        <dl className="figures" data-testid="paycheck-preview">
          <dt>Mom reserve</dt>
          <dd>
            <Money cents={p.momReserve} testId="preview-mom" />
          </dd>
          <dt>Savings</dt>
          <dd>
            <Money cents={p.savings} testId="preview-savings" />
          </dd>
          <dt>Needs</dt>
          <dd>
            <Money cents={p.needs} testId="preview-needs" />
          </dd>
          <dt>Wants</dt>
          <dd>
            <Money cents={p.wants} testId="preview-wants" />
          </dd>
        </dl>
      </div>
    </>
  );
}

// 20d, A15: the purchases a refund likely belongs to.
function LikelyPurchases({ detail }: { readonly detail: ReviewDetail }) {
  const list = detail.likelyPurchases;
  return (
    <div className="likely" data-testid="likely">
      <p className="likely__title">Likely purchases</p>
      {list.length === 0 ? (
        <p className="likely__more" data-testid="likely-none">
          No likely purchase found.
        </p>
      ) : (
        <>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {list.map((p) => (
              <li key={p.id} className="likely__item" data-testid={`likely-${p.id}`}>
                <span className="likely__line">
                  <span>{p.description}</span>
                  <Money cents={p.amount} />
                </span>
                <span className="likely__more">
                  {shortDate(p.date)} · {sortedWords(p.sortedTo)}
                  {p.sameName ? ' · Same name' : ''}
                  {p.sameAmount ? ' · Same amount' : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="likely__more">Put the refund back where the purchase came from.</p>
        </>
      )}
    </div>
  );
}

// ----- All the choices, in a sheet -----

function Choices({ detail, busy, onChoose }: { readonly detail: ReviewDetail; readonly busy: boolean; readonly onChoose: (detail: ReviewDetail, choice: ChoiceOf, extra?: { always?: { contains: string }; ask?: ReactNode; final?: boolean }) => void }) {
  const { item, options } = detail;
  const [always, setAlways] = useState(false);
  const [text, setText] = useState(item.type === 'spending' || item.type === 'money-in' ? item.description : '');
  if ((item.type !== 'spending' && item.type !== 'money-in') || options.type !== 'sort') return null;
  const kind = item.type;
  const ruleText = text.trim();
  const rule = always ? { contains: ruleText } : undefined;
  const picks = always ? options.picks.filter((p) => options.always.includes(p.to)) : options.picks;

  return (
    <>
      <div className="card">
        <dl className="figures">
          <dt>{reasonText(item)}</dt>
          <dd>
            <Money cents={item.amount} testId="sheet-amount" />
          </dd>
          <dt>When</dt>
          <dd>{shortDate(item.date)}</dd>
          {detail.account !== null && (
            <>
              <dt>Account</dt>
              <dd>{ACCOUNT_NAMES[detail.account]}</dd>
            </>
          )}
        </dl>
      </div>

      {options.unavailable.map((u) => (
        <Notice key={u.what} tone="warning" icon="info" testId={`unavailable-${u.what}`}>
          {u.why}
        </Notice>
      ))}

      {options.always.length > 0 && (
        <div className="card">
          <ToggleRow label="Always do this" detail="Make a rule so the next one sorts itself." checked={always} onChange={setAlways} testId="always-toggle" />
          {always && (
            <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
              <TextField label="When the description contains" value={text} onChange={setText} hint="Upper and lower case do not matter. A shorter piece, such as the store's name, catches more." testId="always-text" />
            </div>
          )}
        </div>
      )}

      <Card title={always ? 'Always put it in' : 'Put it in'} testId="sheet-picks">
        {picks.map((pick) => (
          <ListRow
            key={pick.to}
            title={pickLabel(kind, pick.to)}
            detail={pick.final ? "This can't be undone here, so you'll be asked to confirm." : undefined}
            onClick={() => {
              if (busy) return;
              if (always && ruleText === '') return;
              onChoose(detail, { to: pick.to }, {
                ...(rule === undefined ? {} : { always: rule }),
                final: pick.final,
                ask: always ? <p>{ruleSentence(detail, ruleText, pickLabel(kind, pick.to))}</p> : askFor(detail, pick.to),
              });
            }}
            testId={`choice-${pick.to}`}
          />
        ))}
      </Card>

      {!always && options.split !== null && <SplitForm detail={detail} buckets={options.split} busy={busy} onChoose={onChoose} />}

      {!always && options.transfer.length > 0 && (
        <Card title="Transfer between my accounts" testId="sheet-transfer">
          {options.transfer.map((account) => (
            <ListRow
              key={account}
              title={kind === 'money-in' ? `From ${ACCOUNT_NAMES[account]}` : `To ${ACCOUNT_NAMES[account]}`}
              detail="No bucket changes. It is money moving between your accounts."
              onClick={() => {
                if (!busy) onChoose(detail, { transfer: account });
              }}
              testId={`choice-transfer-${account}`}
            />
          ))}
        </Card>
      )}

      {always && <p className="sheet__note">A rule picks one bucket. It can't split a purchase or mark a transfer.</p>}
    </>
  );
}

// What a rule would do, in words.
function ruleSentence(detail: ReviewDetail, text: string, label: string): string {
  const item = detail.item;
  const what = item.type === 'money-in' ? 'deposits' : item.type === 'spending' && item.reason === 'person-payment' ? 'payments to people' : 'purchases';
  return `From now on, ${what} whose description contains “${text}” are sorted as: ${label}. Anything waiting that matches is sorted now too.`;
}

function SplitForm({
  detail,
  buckets,
  busy,
  onChoose,
}: {
  readonly detail: ReviewDetail;
  readonly buckets: readonly ('needs' | 'wants' | 'not-mine')[];
  readonly busy: boolean;
  readonly onChoose: (detail: ReviewDetail, choice: ChoiceOf, extra?: { always?: { contains: string }; ask?: ReactNode; final?: boolean }) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const rest = buckets[buckets.length - 1];
  const entered = buckets.slice(0, -1);
  if (rest === undefined) return null;

  // What he typed, as parts. Reading the digits is all that happens here: the
  // money math adds them up, works out "the rest", and refuses what is wrong.
  const read = (): { readonly parts: ChoicePart[] } | { readonly problem: string } => {
    const parts: ChoicePart[] = [];
    for (const bucket of entered) {
      const typed = (values[bucket] ?? '').trim();
      if (typed === '') continue;
      let cents: Cents;
      try {
        cents = parseDollars(typed);
      } catch {
        return { problem: `${BUCKET_NAMES[bucket]}: enter an amount like 4.00` };
      }
      if (cents <= 0) return { problem: `${BUCKET_NAMES[bucket]}: enter more than zero` };
      parts.push({ bucket, amount: cents });
    }
    if (parts.length === 0) return { problem: `Enter an amount for ${entered.map((b) => BUCKET_NAMES[b]).join(' or ')}` };
    parts.push({ bucket: rest, amount: 'rest' });
    return { parts };
  };
  const result = read();
  const typedAnything = entered.some((b) => (values[b] ?? '').trim() !== '');

  return (
    <Card title="Split it" testId="sheet-split">
      <div style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
        {entered.map((bucket) => (
          <TextField key={bucket} label={`${BUCKET_NAMES[bucket]} (dollars)`} money value={values[bucket] ?? ''} onChange={(v) => setValues((current) => ({ ...current, [bucket]: v }))} testId={`split-${bucket}`} />
        ))}
        <p className="field__hint" data-testid="split-rest">
          {BUCKET_NAMES[rest]} gets the rest.
        </p>
        {typedAnything && 'problem' in result && (
          <p className="field__hint" role="alert" data-testid="split-problem">
            {result.problem}
          </p>
        )}
        <Button
          wide
          disabled={busy || 'problem' in result}
          testId="split-submit"
          onClick={() => {
            if ('problem' in result) return;
            onChoose(detail, { split: result.parts });
          }}
        >
          Split it
        </Button>
      </div>
    </Card>
  );
}

// ----- Are you sure -----

function Confirm({ pending, busy, onYes, onBack }: { readonly pending: Pending; readonly busy: boolean; readonly onYes: () => void; readonly onBack: () => void }) {
  const c = pending.choice;
  const yes =
    pending.always !== undefined
      ? 'Yes, always'
      : 'leftover' in c
        ? c.leftover === 'roll-over'
          ? 'Yes, roll it over'
          : 'Yes, move it to savings'
        : 'to' in c && c.to === 'paycheck'
          ? 'Yes, this is my paycheck'
          : 'Yes, do it';
  const title =
    pending.always !== undefined ? 'Make this a rule?' : 'leftover' in c ? 'Answer for good?' : 'to' in c && c.to === 'paycheck' ? 'Start a new pay period?' : 'Are you sure?';
  return (
    <>
      <p className="sheet__title" data-testid="confirm-title">
        {title}
      </p>
      <Notice tone="warning" icon="alert" testId="confirm-ask">
        {pending.ask ?? "This can't be undone here."}
      </Notice>
      <ButtonRow>
        <Button wide disabled={busy} testId="confirm-yes" onClick={onYes}>
          {busy ? 'Saving…' : yes}
        </Button>
        <Button variant="secondary" wide disabled={busy} testId="confirm-cancel" onClick={onBack}>
          Cancel
        </Button>
      </ButtonRow>
    </>
  );
}
