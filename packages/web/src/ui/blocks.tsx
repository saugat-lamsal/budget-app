import type { BucketLevel, Cents } from '@budget-app/money';
import { useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
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
export function Money({ cents, hero = false, stale = false, signed = false, testId }: { readonly cents: Cents; readonly hero?: boolean; readonly stale?: boolean; readonly signed?: boolean; readonly testId?: string | undefined }) {
  // A list of money in and money out shows a plus on what came in, so the
  // direction is in the amount itself, not only in a color.
  const text = signed && cents > 0 ? `+${moneyText(cents)}` : moneyText(cents);
  const negative = cents < 0;
  return (
    <span
      className={`money${hero ? ' money--hero' : ''}${negative ? ' is-negative' : ''}${stale ? ' money--stale' : ''}`}
      data-money=""
      data-testid={testId}
      aria-label={negative ? moneyWords(cents) : signed && cents > 0 ? `plus ${moneyWords(cents)}` : undefined}
      style={hero ? ({ '--chars': text.length } as CSSProperties) : undefined}
    >
      {hero ? <HeroText text={text} /> : text}
    </span>
  );
}

// The main number: the cents smaller and quieter. The text is the same
// characters, so it reads and copies as the one amount.
function HeroText({ text }: { readonly text: string }) {
  const dot = text.lastIndexOf('.');
  if (dot === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, dot)}
      <span className="money__cents">{text.slice(dot)}</span>
    </>
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
  const className = `row${icon === undefined ? ' row--plain' : ''}${trailing === undefined ? '' : ' row--trailing'}`;
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

// A link that looks like a button: it goes to another screen of the app.
export function LinkButton({ children, href, variant = 'primary', wide = false, testId }: { readonly children: ReactNode; readonly href: string; readonly variant?: 'primary' | 'secondary'; readonly wide?: boolean; readonly testId?: string | undefined }) {
  return (
    <a className={`button button--${variant}${wide ? ' button--wide' : ''}`} href={href} data-testid={testId}>
      {children}
    </a>
  );
}

// ----- Status label: a word and an icon, so color is never the only signal -----

export type Status = 'low' | 'empty' | 'overdue' | 'pending' | 'under-target' | 'in-target' | 'over-target' | 'changes' | 'changed';

const STATUS: Readonly<Record<Status, { readonly word: string; readonly icon: IconName; readonly tone: Tone }>> = {
  low: { word: 'Low', icon: 'low', tone: 'warning' },
  empty: { word: 'Empty', icon: 'empty', tone: 'danger' },
  overdue: { word: 'Overdue', icon: 'alert', tone: 'danger' },
  pending: { word: 'Pending', icon: 'clock', tone: 'info' },
  'under-target': { word: 'Under target', icon: 'low', tone: 'info' },
  'in-target': { word: 'In the target', icon: 'check', tone: 'info' },
  'over-target': { word: 'Over target', icon: 'alert', tone: 'warning' },
  changes: { word: 'Changes', icon: 'swap', tone: 'info' },
  // A32 (13.7): the item is not what the screen showed before it read its numbers again.
  changed: { word: 'Changed', icon: 'alert', tone: 'warning' },
};

export function StatusLabel({ status, testId }: { readonly status: Status; readonly testId?: string | undefined }) {
  const s = STATUS[status];
  return (
    <span className={`status status--${s.tone}`} data-status={status} data-testid={testId}>
      <Icon name={s.icon} size={12} />
      {s.word}
    </span>
  );
}

// ----- Bucket bar -----

// What is left in a bucket, against what it started the pay period with
// (10.1). Low and empty say so in words (10.1, 10.2).
export function BucketBar({ name, left, startedWith, level, href, testId }: { readonly name: string; readonly left: Cents; readonly startedWith: Cents; readonly level: BucketLevel; readonly href?: string; readonly testId?: string | undefined }) {
  const fill = barFill(left, startedWith);
  // With an address, the whole bar is a link to what went in and out of the bucket.
  const Tag = href === undefined ? 'div' : 'a';
  return (
    <Tag className={`bucket${href === undefined ? '' : ' bucket--link'}`} data-testid={testId} data-level={level} {...(href === undefined ? {} : { href })}>
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
        {href !== undefined && (
          <span className="row__chevron">
            <Icon name="chevron" size={16} />
          </span>
        )}
      </div>
      <div className="bar" aria-hidden="true">
        <div className={`bar__fill${level === 'ok' ? '' : ` bar__fill--${level}`}`} style={{ width: `${(fill * 100).toFixed(2)}%` }} />
      </div>
    </Tag>
  );
}

// ----- The light behind every screen (base.css, blocks.css) -----

// Drawn once, fixed, and it takes no touch. It is decoration only.
export function Backdrop() {
  return (
    <>
      <div className="ambient" aria-hidden="true">
        <div className="ambient__blob ambient__blob--a" />
        <div className="ambient__blob ambient__blob--b" />
        <div className="ambient__blob ambient__blob--c" />
      </div>
      <div className="statusbar" aria-hidden="true" />
    </>
  );
}

// ----- Tiles: buckets and counts side by side -----

// A section of tiles under a small title (Home).
export function Tiles({ title, children, testId }: { readonly title: string; readonly children: ReactNode; readonly testId?: string | undefined }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-testid={testId}>
      <h2 id={id} className="section-title">
        {title}
      </h2>
      <div className="tiles-wrap">
        <div className="tiles">{children}</div>
      </div>
    </section>
  );
}

// A bucket as a tile: the same facts as the bucket bar (what is left, against
// what it started the pay period with, Low and Empty in words), with the same
// test ids. The tall one stands beside two short ones.
export function BucketTile({ name, left, startedWith, level, href, tall = false, testId }: { readonly name: string; readonly left: Cents; readonly startedWith: Cents; readonly level: BucketLevel; readonly href: string; readonly tall?: boolean; readonly testId?: string | undefined }) {
  const fill = barFill(left, startedWith);
  return (
    <a className={`tile${tall ? ' tile--tall' : ''}`} href={href} data-testid={testId} data-level={level}>
      <span className="tile__top">
        <span className="tile__name">{name}</span>
        {level !== 'ok' && <StatusLabel status={level} />}
      </span>
      <span className="tile__figure">
        <span className="tile__amount" style={{ '--chars': moneyText(left).length } as CSSProperties}>
          <Money cents={left} testId={testId === undefined ? undefined : `${testId}-left`} />
        </span>
        <span className="tile__of">
          left of <Money cents={startedWith} testId={testId === undefined ? undefined : `${testId}-of`} />
        </span>
        <span className="bar" aria-hidden="true">
          <span className={`bar__fill${level === 'ok' ? '' : ` bar__fill--${level}`}`} style={{ display: 'block', width: `${(fill * 100).toFixed(2)}%` }} />
        </span>
      </span>
    </a>
  );
}

// A count as a tile that goes somewhere (what is waiting to be sorted).
export function CountTile({ name, count, go, href, testId }: { readonly name: string; readonly count: number; readonly go: string; readonly href: string; readonly testId?: string | undefined }) {
  return (
    <a className="tile" href={href} data-testid={testId}>
      <span className="tile__top">
        <span className="tile__name">{name}</span>
      </span>
      <span className="tile__count">
        <span className="tile__amount" data-testid={testId === undefined ? undefined : `${testId}-count`}>
          {count}
        </span>
        <span className="tile__go">{go} →</span>
      </span>
    </a>
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
// After a sheet closes, the screen takes no tap for TAP_HOLD_MS. A sheet
// closes the moment its answer comes back, and the rest of a double tap on its
// button then landed on whatever was under it: a Settings row, which opened
// another sheet and took the saved message away, or the Review tab (CI Oct 11,
// WebKit; B194). An invisible cover over the whole screen takes those taps.
export const TAP_HOLD_MS = 500;

function holdTaps(): void {
  const cover = document.createElement('div');
  cover.className = 'tap-hold';
  cover.setAttribute('aria-hidden', 'true');
  document.body.append(cover);
  window.setTimeout(() => cover.remove(), TAP_HOLD_MS);
}

export function BottomSheet({ open, title, onClose, children, testId }: { readonly open: boolean; readonly title: string; readonly onClose: () => void; readonly children: ReactNode; readonly testId?: string | undefined }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  // Opens and closes in the same step that redraws the screen (not a moment
  // later), so a sheet whose job is done never sits open with its button
  // enabled again: a second tap in that moment would send the choice twice
  // (CI, Oct 8, WebKit on Linux).
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Start at the title, so a screen reader reads the sheet from the top
      // and the close button does not start out highlighted.
      dialog.querySelector<HTMLElement>('.sheet__title')?.focus();
    }
    if (!open && dialog.open) {
      dialog.close();
      holdTaps();
    }
  }, [open]);
  // Taken off the screen while open (its screen let it go when the answer
  // came): the same hold.
  useLayoutEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open === true) holdTaps();
    };
  }, []);
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
  kind = 'text',
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string;
  // An amount in dollars: the phone shows the number pad.
  readonly money?: boolean;
  // A whole number (the phone shows the digits), or a date or a time (the
  // phone's own picker). Plain text otherwise.
  readonly kind?: 'text' | 'whole' | 'date' | 'time';
  readonly testId?: string | undefined;
}) {
  const id = useId();
  const picker = kind === 'date' || kind === 'time';
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <input
        id={id}
        className={`field__input${money || kind === 'whole' ? ' field__input--money' : ''}`}
        type={picker ? kind : 'text'}
        inputMode={picker ? undefined : money ? 'decimal' : kind === 'whole' ? 'numeric' : 'text'}
        autoComplete="off"
        autoCapitalize={money || kind !== 'text' ? 'off' : 'characters'}
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

// ----- Select field: one of a few, chosen from the phone's own list -----

export function SelectField({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly testId?: string | undefined;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <select id={id} className="field__input field__input--select" value={value} onChange={(event) => onChange(event.currentTarget.value)} data-testid={testId}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ----- Compare table: two columns of the same things, such as this pay period and the next -----

// Each row has a name and a value in each column; a row whose values differ
// says so in words ("Changes"), so color is never the only signal. When the
// text is large the columns no longer fit side by side, so each row stacks,
// every value with its column's name (blocks.css).
export interface CompareColumn {
  readonly name: string;
  readonly sub?: string;
}

export function CompareTable({
  caption,
  columns,
  rows,
  testId,
}: {
  readonly caption: string;
  readonly columns: readonly [CompareColumn, CompareColumn];
  readonly rows: readonly { readonly label: string; readonly first: ReactNode; readonly second: ReactNode; readonly differs: boolean; readonly testId: string }[];
  readonly testId?: string | undefined;
}) {
  const label = (c: CompareColumn): string => (c.sub === undefined ? c.name : `${c.name}, ${c.sub}`);
  return (
    <div className="compare-wrap">
      <table className="compare" data-testid={testId}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <td />
            {columns.map((c) => (
              <th key={c.name} scope="col">
                {c.name}
                {c.sub !== undefined && <span className="compare__sub">{c.sub}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.testId} data-testid={row.testId} data-differs={row.differs}>
              <th scope="row">{row.label}</th>
              <td data-testid={`${row.testId}-first`} data-label={label(columns[0])}>
                <span className="compare__value">{row.first}</span>
              </td>
              <td data-testid={`${row.testId}-second`} data-label={label(columns[1])}>
                <span className="compare__value">{row.second}</span>
                {row.differs && <StatusLabel status="changes" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ----- Back link: goes back to the screen this one was opened from -----

export function BackLink({ href, label, onBack, testId }: { readonly href: string; readonly label: string; readonly onBack?: () => void; readonly testId?: string | undefined }) {
  return (
    <a
      className="back"
      href={href}
      data-testid={testId}
      onClick={(event) => {
        if (onBack === undefined || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onBack();
      }}
    >
      <Icon name="back" size={18} />
      <span>{label}</span>
    </a>
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
  changed,
  children,
  actions,
  testId,
}: {
  readonly title: ReactNode;
  readonly amount?: ReactNode;
  readonly detail: ReactNode;
  readonly status?: Status | undefined;
  // A32 (13.7): what the item is now, when it changed as the screen read its
  // numbers again ("Changed: now $21.50, posted"). In words, with an icon.
  readonly changed?: string | undefined;
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
      {changed !== undefined && (
        <p className="decision__changed" data-testid="changed">
          <Icon name="alert" size={14} />
          <span>{changed}</span>
        </p>
      )}
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
