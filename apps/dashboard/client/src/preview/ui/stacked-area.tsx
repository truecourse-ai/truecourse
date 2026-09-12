/**
 * Several counts over time, stacked: one area per series, painted by the
 * series' status fill, worst on top, a 2px surface line between neighbours so
 * the bands never touch. The bands sit muted until the pointer is over the plot (or it has
 * keyboard focus), then show at full colour. The readout above the plot lists
 * every series at the hovered date (the latest at rest), value first; a
 * crosshair snaps to the nearest point. Full width: the plot is a shape-only
 * SVG stretched to its box, every word is HTML beside it, so nothing
 * stretches but the areas. Keyboard reaches every point once the plot has
 * focus (arrow keys).
 */

import { useId, useMemo, useState, type ReactNode } from 'react';

export interface StackedSeries<K extends string> {
  key: K;
  label: string;
  /** Tailwind fill class, `fill-red-500`. */
  fill: string;
  /** The matching background class for the legend dot, `bg-red-500`. */
  dot: string;
}

export interface StackedPoint<K extends string> {
  /** ISO date. */
  at: string;
  values: Record<K, number>;
}

const W = 1000;
const H = 200;

function dateWord(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function StackedArea<K extends string>({
  label,
  series,
  points,
  onPickSeries,
  controls,
  numbersAtRest = true,
}: {
  label: string;
  /** Bottom first: the first series sits on the baseline. */
  series: StackedSeries<K>[];
  points: StackedPoint<K>[];
  /** A legend word is a door when the surface has somewhere to go with it. */
  onPickSeries?: (key: K) => void;
  /** The chart's own controls (a period picker), on the readout row after the label. */
  controls?: ReactNode;
  /**
   * Whether the readout carries values while nothing is hovered. Off when the
   * surface shows today's numbers elsewhere, so they appear once; the legend's
   * words stay, the values come with the pointer.
   */
  numbersAtRest?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);
  const id = useId();

  const geometry = useMemo(() => {
    const totals = points.map((p) => series.reduce((n, s) => n + (p.values[s.key] ?? 0), 0));
    const max = Math.max(1, ...totals);
    const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W);
    const y = (v: number) => H - (v / max) * H;
    // Cumulative tops per series, bottom first.
    const tops: number[][] = [];
    let below = points.map(() => 0);
    for (const s of series) {
      const top = points.map((p, i) => below[i]! + (p.values[s.key] ?? 0));
      tops.push(top);
      below = top;
    }
    const areas = series.map((s, si) => {
      const top = tops[si]!;
      const bottom = si === 0 ? points.map(() => 0) : tops[si - 1]!;
      const up = points.map((_, i) => `${x(i).toFixed(1)},${y(top[i]!).toFixed(1)}`);
      const down = points.map((_, i) => `${x(i).toFixed(1)},${y(bottom[i]!).toFixed(1)}`).reverse();
      return { key: s.key, fill: s.fill, path: `M${up.join(' L')} L${down.join(' L')} Z`, edge: `M${up.join(' L')}` };
    });
    return { x, y, areas, max };
  }, [points, series]);

  if (points.length === 0) return null;
  const shown = active ?? points.length - 1;
  const point = points[shown]!;

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const share = (e.clientX - rect.left) / rect.width;
    setActive(Math.max(0, Math.min(points.length - 1, Math.round(share * (points.length - 1)))));
  };

  return (
    <section aria-label={label} className="min-w-0">
      {/* The readout: the date at the left, every series' value at that date
          to the right, value before word. At rest it is the latest point, so
          this line is also the legend and the current tally. */}
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        {controls}
        {(active !== null || numbersAtRest) && (
          <span className="text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
            {dateWord(point.at)}
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {[...series].reverse().map((s) => {
            const body = (
              <>
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                {(active !== null || numbersAtRest) && <span className="tabular-nums font-medium text-foreground">{point.values[s.key] ?? 0}</span>}
                {s.label}
              </>
            );
            return onPickSeries ? (
              <button
                key={s.key}
                type="button"
                onClick={() => onPickSeries(s.key)}
                className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
              >
                {body}
              </button>
            ) : (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {body}
              </span>
            );
          })}
        </span>
      </div>
      <div
        className="relative h-48 w-full"
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-desc`}
          tabIndex={0}
          onFocus={() => setActive((current) => current ?? points.length - 1)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setActive(Math.max(0, shown - 1));
            if (e.key === 'ArrowRight') setActive(Math.min(points.length - 1, shown + 1));
          }}
          onBlur={() => setActive(null)}
        >
          <title id={`${id}-title`}>{label}</title>
          <desc id={`${id}-desc`}>
            {points.map((p) => `${dateWord(p.at)}: ${series.map((s) => `${p.values[s.key] ?? 0} ${s.label.toLowerCase()}`).join(', ')}`).join('; ')}
          </desc>
          {/* Muted at rest, full colour under the pointer or keyboard focus:
              the chart is a picture until it is being read. */}
          {geometry.areas.map((a) => (
            <path
              key={a.key}
              d={a.path}
              className={`${a.fill} transition-opacity duration-150 ${active === null ? 'opacity-45' : 'opacity-100'}`}
            />
          ))}
          {/* The surface line between neighbours: the bands never touch. */}
          {geometry.areas.map((a) => (
            <path key={`${a.key}-edge`} d={a.edge} fill="none" className="stroke-background" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        {active !== null && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-px bg-foreground/60"
            style={{ left: `${(geometry.x(active) / W) * 100}%` }}
          />
        )}
      </div>
      {/* The dates: first, middle, last, in HTML so nothing stretches. */}
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{dateWord(points[0]!.at)}</span>
        {points.length > 2 && <span>{dateWord(points[Math.floor((points.length - 1) / 2)]!.at)}</span>}
        <span>{dateWord(points[points.length - 1]!.at)}</span>
      </div>
    </section>
  );
}
