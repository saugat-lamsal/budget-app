import type { Cents } from '@budget-app/money';
import { useLayoutEffect, useRef, type CSSProperties } from 'react';

// The charts, on the Trends tab only (design rules). Each one draws numbers
// the server worked out and the screen also says in words: a bar is a button
// whose label says every amount, and a line's card says where it ends. They
// grow and draw in quickly (base.css turns it off with reduced motion).

export type ChartTone = 'needs' | 'wants' | 'old-card' | 'unsorted' | 'savings' | 'mom' | 'pace';

export interface BarPart {
  readonly tone: ChartTone;
  readonly cents: Cents;
}

export interface Bar {
  readonly key: string;
  // Under the bar: "9/25".
  readonly label: string;
  // Everything it shows, for a screen reader.
  readonly words: string;
  readonly parts: readonly BarPart[];
  // 40.1: read from the bank history, not the books: drawn lighter, and said in words.
  readonly lighter: boolean;
  readonly selected: boolean;
}

// Stacked bars, one a pay period, oldest on the left. Only what was spent is drawn (a part that
// came out below zero, money back, is said in words but not drawn).
export function StackedBars({ bars, label, onPick, testId }: { readonly bars: readonly Bar[]; readonly label: string; readonly onPick: (key: string) => void; readonly testId?: string | undefined }) {
  const drawn = (b: Bar): Cents => b.parts.reduce((sum, p) => sum + Math.max(0, p.cents), 0);
  const most = Math.max(1, ...bars.map(drawn));
  // Each bar is a 44-point tap target, so more than fit across a phone scroll
  // sideways; it opens at the newest, on the right.
  const row = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = row.current;
    if (el !== null) el.scrollLeft = el.scrollWidth;
  }, [bars.length]);
  return (
    <div className="pbars" role="group" aria-label={label} data-testid={testId} ref={row}>
      {bars.map((bar, i) => {
        const height = (drawn(bar) / most) * 100;
        return (
          <button
            key={bar.key}
            type="button"
            className={`pbar${bar.lighter ? ' pbar--lighter' : ''}${bar.selected ? ' is-selected' : ''}`}
            aria-label={bar.words}
            aria-pressed={bar.selected}
            onClick={() => onPick(bar.key)}
            data-testid={`${testId ?? 'bar'}-${bar.key}`}
            style={{ '--i': i } as CSSProperties}
          >
            <span className="pbar__plot" aria-hidden="true">
              <span className="pbar__stack" style={{ height: `${height}%` }} data-height={height.toFixed(2)}>
                {bar.parts
                  .filter((p) => p.cents > 0)
                  .map((p) => (
                    <span key={p.tone} className={`pbar__part chart--${p.tone}`} style={{ flexGrow: p.cents }} />
                  ))}
              </span>
            </span>
            <span className="pbar__label" aria-hidden="true">
              {bar.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface Line {
  readonly key: string;
  readonly tone: ChartTone;
  readonly values: readonly Cents[];
  readonly dashed?: boolean;
}

// Lines over the same days or points, left to right. length is how many
// points wide the chart is (a line can stop early, as Wants does at today).
// What it shows is in label and in the words around it.
export function LineChart({ lines, length, label, testId }: { readonly lines: readonly Line[]; readonly length: number; readonly label: string; readonly testId?: string | undefined }) {
  const W = 320;
  const H = 120;
  const PAD = 6;
  const all = lines.flatMap((l) => l.values);
  const top = Math.max(1, ...all);
  const bottom = Math.min(0, ...all);
  const x = (i: number): number => (length <= 1 ? W / 2 : PAD + (i / (length - 1)) * (W - 2 * PAD));
  const y = (v: number): number => PAD + ((top - v) / (top - bottom)) * (H - 2 * PAD);
  const path = (values: readonly Cents[]): string => values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <svg className="linechart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} data-testid={testId}>
      {bottom < 0 && <line className="linechart__zero" x1={0} x2={W} y1={y(0)} y2={y(0)} />}
      {lines.map((l) =>
        l.values.length === 0 ? null : (
          <g key={l.key} data-testid={testId === undefined ? undefined : `${testId}-${l.key}`} data-values={l.values.join(',')}>
            {l.values.length === 1 ? (
              <circle className={`linechart__dot chart--${l.tone}`} cx={x(0)} cy={y(l.values[0] as number)} r={3.5} />
            ) : (
              <path className={`linechart__line chart--${l.tone}${l.dashed === true ? ' linechart__line--dashed' : ''}`} d={path(l.values)} pathLength={l.dashed === true ? undefined : 1} />
            )}
            {l.dashed !== true && l.values.length > 1 && <circle className={`linechart__dot chart--${l.tone}`} cx={x(l.values.length - 1)} cy={y(l.values[l.values.length - 1] as number)} r={3.5} />}
          </g>
        ),
      )}
    </svg>
  );
}

// Which color is which, in words.
export function ChartLegend({ items }: { readonly items: readonly { readonly tone: ChartTone; readonly label: string; readonly dashed?: boolean }[] }) {
  return (
    <ul className="legend">
      {items.map((item) => (
        <li key={item.label} className="legend__item">
          <span className={`legend__swatch chart--${item.tone}${item.dashed === true ? ' legend__swatch--dashed' : ''}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
