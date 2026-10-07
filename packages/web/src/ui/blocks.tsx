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
  testId,
}: {
  readonly children: ReactNode;
  readonly onClick: () => void;
  readonly variant?: 'primary' | 'secondary' | 'plain';
  readonly wide?: boolean;
  readonly testId?: string | undefined;
}) {
  return (
    <button type="button" className={`button button--${variant}${wide ? ' button--wide' : ''}`} onClick={onClick} data-testid={testId}>
      {children}
    </button>
  );
}

// ----- Status label: a word and an icon, so color is never the only signal -----

const STATUS: Readonly<Record<'low' | 'empty' | 'overdue', { readonly word: string; readonly icon: IconName; readonly tone: Tone }>> = {
  low: { word: 'Low', icon: 'low', tone: 'warning' },
  empty: { word: 'Empty', icon: 'empty', tone: 'danger' },
  overdue: { word: 'Overdue', icon: 'alert', tone: 'danger' },
};

export function StatusLabel({ status }: { readonly status: 'low' | 'empty' | 'overdue' }) {
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
