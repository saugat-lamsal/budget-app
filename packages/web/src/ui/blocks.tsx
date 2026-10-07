import type { BucketLevel, Cents } from '@budget-app/money';
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { barFill } from './bar-fill.js';
import { Icon, type IconName } from './Icon.js';
import { moneyText, moneyWords } from './money-format.js';

// The shared building blocks (CLAUDE.md design rules). Screens are made of
// these and the tokens in tokens.css; no screen makes up its own.

export type Tone = 'info' | 'warning' | 'danger' | 'ok';

// ----- Money -----

// Every amount on every screen. Tabular digits, a real minus sign, and the
// negative color on top of the sign, never instead of it. A stale amount
// (one that could not be checked today) is greyed, and the screen says why.
export function Money({ cents, hero = false, stale = false, testId }: { readonly cents: Cents; readonly hero?: boolean; readonly stale?: boolean; readonly testId?: string | undefined }) {
  const text = moneyText(cents);
  const negative = cents < 0;
  return (
    <span
      className={`money${hero ? ' money--hero' : ''}${negative ? ' is-negative' : ''}${stale ? ' money--stale' : ''}`}
      data-money=""
      data-testid={testId}
      aria-label={negative ? moneyWords(cents) : undefined}
      style={hero ? ({ '--chars': text.length } as CSSProperties) : undefined}
    >
      {text}
    </span>
  );
}

// ----- Card -----

export function Card({ title, padded = false, children, testId }: { readonly title?: string; readonly padded?: boolean; readonly children: ReactNode; readonly testId?: string | undefined }) {
  const id = useId();
  return (
    <section aria-labelledby={title === undefined ? undefined : id} data-testid={testId}>
      {title !== undefined && (
        <h2 id={id} className="section-title">
          {title}
        </h2>
      )}
      <div className={`card${padded ? ' card--padded' : ''}`}>{children}</div>
    </section>
  );
}

// ----- List row -----

interface ListRowProps {
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  readonly icon?: IconName;
  readonly tone?: Tone;
  readonly trailing?: ReactNode;
  // A row that goes somewhere is a link; one that opens something here is a button.
  readonly href?: string;
  readonly onClick?: () => void;
  readonly testId?: string | undefined;
}

export function ListRow({ title, detail, icon, tone = 'info', trailing, href, onClick, testId }: ListRowProps) {
  const inner = (
    <>
      {icon !== undefined && (
        <span className={`row__icon${tone === 'info' ? '' : ` row__icon--${tone}`}`}>
          <Icon name={icon} size={18} />
        </span>
      )}
      <span className="row__text">
        <span className="row__title">{title}</span>
        {detail !== undefined && <span className="row__detail">{detail}</span>}
      </span>
      {trailing !== undefined && <span className="row__trailing">{trailing}</span>}
      {(href !== undefined || onClick !== undefined) && (
        <span className="row__chevron">
          <Icon name="chevron" size={16} />
        </span>
      )}
    </>
  );
  const className = `row${icon === undefined ? ' row--plain' : ''}`;
  if (href !== undefined) {
    return (
      <a className={className} href={href} data-testid={testId}>
        {inner}
      </a>
    );
  }
  if (onClick !== undefined) {
    return (
      <button type="button" className={className} onClick={onClick} data-testid={testId}>
        {inner}
      </button>
    );
  }
  return (
    <div className={className} data-testid={testId}>
      {inner}
    </div>
  );
}

// ----- Button -----

export function Button({
  children,
  onClick,
  variant = 'primary',
  wide = false,
  disabled = false,
  testId,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly variant?: 'primary' | 'secondary' | 'plain';
  readonly wide?: boolean;
  // Not while something is being saved.
  readonly disabled?: boolean;
  readonly testId?: string | undefined;
}) {
  return (
    <button type="button" className={`button button--${variant}${wide ? ' button--wide' : ''}`} onClick={onClick} disabled={disabled} data-testid={testId}>
      {children}
    </button>
  );
}

// ----- Status label: a word and an icon, so color is never the only signal -----

export type Status = 'low' | 'empty' | 'overdue' | 'pending' | 'under-target' | 'in-target' | 'over-target';

const STATUS: Readonly<Record<Status, { readonly word: string; readonly icon: IconName; readonly tone: Tone }>> = {
  low: { word: 'Low', icon: 'low', tone: 'warning' },
  empty: { word: 'Empty', icon: 'empty', tone: 'danger' },
  overdue: { word: 'Overdue', icon: 'alert', tone: 'danger' },
  pending: { word: 'Pending', icon: 'clock', tone: 'info' },
  'under-target': { word: 'Under target', icon: 'low', tone: 'info' },
  'in-target': { word: 'In the target', icon: 'check', tone: 'info' },
  'over-target': { word: 'Over target', icon: 'alert', tone: 'warning' },
};

export function StatusLabel({ status }: { readonly status: Status }) {
  const s = STATUS[status];
  return (
    <span className={`status status--${s.tone}`} data-status={status}>
      <Icon name={s.icon} size={12} />
      {s.word}
    </span>
  );
}

// ----- Bucket bar -----

// What is left in a bucket, against what it started the pay period with
// (10.1). Low and empty say so in words (10.1, 10.2).
export function BucketBar({ name, left, startedWith, level, testId }: { readonly name: string; readonly left: Cents; readonly startedWith: Cents; readonly level: BucketLevel; readonly testId?: string | undefined }) {
  const fill = barFill(left, startedWith);
  return (
    <div className="bucket" data-testid={testId} data-level={level}>
      <div className="bucket__line">
        <span className="bucket__name">{name}</span>
        {level !== 'ok' && <StatusLabel status={level} />}
        <span className="bucket__left">
          <Money cents={left} testId={testId === undefined ? undefined : `${testId}-left`} />
          <span className="bucket__of">
            {' '}
            left of <Money cents={startedWith} testId={testId === undefined ? undefined : `${testId}-of`} />
          </span>
        </span>
      </div>
      <div className="bar" aria-hidden="true">
        <div className={`bar__fill${level === 'ok' ? '' : ` bar__fill--${level}`}`} style={{ width: `${(fill * 100).toFixed(2)}%` }} />
      </div>
    </div>
  );
}

// ----- Banner: a state that must not be missed -----

export function Banner({ tone, icon, title, children, testId }: { readonly tone: 'danger' | 'warning'; readonly icon: IconName; readonly title: string; readonly children: ReactNode; readonly testId?: string | undefined }) {
  return (
    <section className={`banner banner--${tone}`} role="alert" aria-label={title} data-testid={testId}>
      <div className="banner__head">
        <Icon name={icon} size={24} />
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

// ----- Bottom sheet -----

// Slides up from the bottom, over the screen. Closes with its button, a tap
// outside it, or Escape. Built on the browser's own dialog, so focus stays
// inside it while it is open.
export function BottomSheet({ open, title, onClose, children, testId }: { readonly open: boolean; readonly title: string; readonly onClose: () => void; readonly children: ReactNode; readonly testId?: string | undefined }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Start at the title, so a screen reader reads the sheet from the top
      // and the close button does not start out highlighted.
      dialog.querySelector<HTMLElement>('.sheet__title')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={id}
      data-testid={testId}
      onClose={onClose}
      onClick={(event) => {
        // A tap on the backdrop lands on the dialog itself, outside the inner box.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet__inner">
        <div className="sheet__grabber" aria-hidden="true" />
        <div className="sheet__head">
          <h2 id={id} className="sheet__title" tabIndex={-1}>
            {title}
          </h2>
          <button type="button" className="button button--plain" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

// ----- Made-up data pill: only the demo shows it -----

export function MadeUpPill() {
  return (
    <span className="pill" data-testid="made-up">
      <Icon name="info" size={12} />
      Made-up data
    </span>
  );
}

// ----- Hero: the one main number of a screen -----

export function Hero({ label, children, sub, testId }: { readonly label: string; readonly children: ReactNode; readonly sub?: ReactNode; readonly testId?: string | undefined }) {
  const id = useId();
  return (
    <section className="hero" aria-labelledby={id} data-testid={testId}>
      <h2 id={id} className="hero__label">
        {label}
      </h2>
      {children}
      {sub !== undefined && <p className="hero__sub">{sub}</p>}
    </section>
  );
}

// The main number when it is a count, not money.
export function HeroCount({ count, testId }: { readonly count: number; readonly testId?: string | undefined }) {
  return (
    <span className="hero__count" data-testid={testId}>
      {count}
    </span>
  );
}

// ----- Target bar: how much against a target range, such as mom this month -----

// The bar fills toward the high end of the range; a tick marks the low end.
// The position is said in words too.
export function TargetBar({
  name,
  amount,
  caption,
  sent,
  low,
  high,
  position,
  testId,
}: {
  readonly name: string;
  readonly amount: ReactNode;
  readonly caption: ReactNode;
  readonly sent: Cents;
  readonly low: Cents;
  readonly high: Cents;
  readonly position: 'under' | 'within' | 'over';
  readonly testId?: string | undefined;
}) {
  const fill = barFill(sent, high);
  const tick = high > 0 ? Math.min(1, Math.max(0, low / high)) : 0;
  return (
    <div className="bucket" data-testid={testId} data-position={position}>
      <div className="bucket__line">
        <span className="bucket__name">{name}</span>
        <span className="bucket__left">{amount}</span>
      </div>
      <div className="bar bar--target" aria-hidden="true">
        <div className="bar__fill" style={{ width: `${(fill * 100).toFixed(2)}%` }} />
        <div className="bar__tick" style={{ left: `${(tick * 100).toFixed(2)}%` }} />
      </div>
      <p className="bucket__caption">{caption}</p>
      <StatusLabel status={position === 'under' ? 'under-target' : position === 'within' ? 'in-target' : 'over-target'} />
    </div>
  );
}

// ----- Notice: a short message that is not a whole screen state -----

export function Notice({
  tone,
  icon,
  children,
  action,
  sticky = false,
  testId,
}: {
  readonly tone: 'ok' | 'warning' | 'danger';
  readonly icon: IconName;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  // Stays in view, under the notch, while the screen scrolls.
  readonly sticky?: boolean;
  readonly testId?: string | undefined;
}) {
  return (
    <div className={`notice notice--${tone}${sticky ? ' notice--sticky' : ''}`} role={tone === 'ok' ? 'status' : 'alert'} data-testid={testId}>
      <Icon name={icon} size={20} />
      <div className="notice__text">{children}</div>
      {action}
    </div>
  );
}

// ----- Toggle row: a switch with words -----

export function ToggleRow({
  label,
  detail,
  checked,
  onChange,
  testId,
}: {
  readonly label: string;
  readonly detail?: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly testId?: string | undefined;
}) {
  const id = useId();
  return (
    <label className="toggle" htmlFor={id}>
      <span className="row__text">
        <span className="row__title">{label}</span>
        {detail !== undefined && <span className="row__detail">{detail}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" className="toggle__input" checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} data-testid={testId} />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
    </label>
  );
}

// ----- Text field -----

export function TextField({
  label,
  value,
  onChange,
  hint,
  money = false,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string;
  // An amount in dollars: the phone shows the number pad.
  readonly money?: boolean;
  readonly testId?: string | undefined;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <input
        id={id}
        className={`field__input${money ? ' field__input--money' : ''}`}
        type="text"
        inputMode={money ? 'decimal' : 'text'}
        autoComplete="off"
        autoCapitalize={money ? 'off' : 'characters'}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        data-testid={testId}
      />
      {hint !== undefined && (
        <p id={`${id}-hint`} className="field__hint">
          {hint}
        </p>
      )}
    </div>
  );
}

// ----- Button row: buttons side by side, wrapping on a narrow screen -----

export function ButtonRow({ children }: { readonly children: ReactNode }) {
  return <div className="button-row">{children}</div>;
}

// ----- Decision: something waiting for him, with what to do about it -----

// A title and amount, a line saying what it is, optional extra content, and
// the buttons to decide. Several sit in one card.
export function Decision({
  title,
  amount,
  detail,
  status,
  children,
  actions,
  testId,
}: {
  readonly title: ReactNode;
  readonly amount?: ReactNode;
  readonly detail: ReactNode;
  readonly status?: Status | undefined;
  readonly children?: ReactNode;
  readonly actions: ReactNode;
  readonly testId?: string | undefined;
}) {
  return (
    <article className="decision" data-testid={testId}>
      <div className="decision__head">
        <h3 className="decision__title">{title}</h3>
        {amount !== undefined && <span className="decision__amount">{amount}</span>}
      </div>
      <p className="decision__detail">
        {status !== undefined && <StatusLabel status={status} />}
        <span>{detail}</span>
      </p>
      {children}
      <div className="decision__actions">{actions}</div>
    </article>
  );
}

// ----- Screen states: loading, empty, error -----

export function StateMessage({ icon, tone = 'info', title, detail, children, testId }: { readonly icon: IconName; readonly tone?: 'info' | 'danger'; readonly title: string; readonly detail?: string; readonly children?: ReactNode; readonly testId?: string | undefined }) {
  return (
    <div className="state" data-testid={testId}>
      <span className={`state__icon${tone === 'danger' ? ' state__icon--danger' : ''}`}>
        <Icon name={icon} size={28} />
      </span>
      <p className="state__title">{title}</p>
      {detail !== undefined && <p className="state__detail">{detail}</p>}
      {children}
    </div>
  );
}

export function Skeleton({ width, height }: { readonly width: string; readonly height: string }) {
  return <div className="skeleton" style={{ width, height }} />;
}
