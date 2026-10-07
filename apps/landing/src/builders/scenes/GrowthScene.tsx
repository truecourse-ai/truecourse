import { easeOut, span, useClock, useNarrow } from '../motion';
import { Stage } from '../Stage';

/**
 * The hero told in numbers: a year of an example business's dashboard. Once
 * in view, the revenue line draws itself month by month, flat and jagged with
 * problems marked in red, until the AI CTO starts; from there it climbs, the
 * problems turn into fixes, cancellations shrink and the three numbers above
 * count up with the line. It plays once and holds on the finished year.
 */

const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];
const REVENUE = [2100, 1850, 2300, 1700, 2050, 2400, 3000, 3700, 4300, 5000, 5800, 6700];
const ISSUES = [8, 10, 11, 13, 14, 9, 6, 4, 3, 2, 1, 1];
const CUSTOMERS = [48, 46, 50, 44, 47, 55, 68, 82, 95, 108, 120, 130];
const CANCELLED = [9, 11, 8, 12, 10, 6, 4, 3, 2, 2, 1, 1];
/** The month the AI CTO started. */
const START = 5;

/**
 * What happened along the way. A problem is labelled centred on its dot, a fix
 * above it and ending at it, so every label sits clear of the line.
 */
const EVENTS: { at: number; good: boolean; label: string; dy: number }[] = [
  { at: 1, good: false, label: 'Checkout down', dy: -30 },
  { at: 3, good: false, label: 'Bad release', dy: 26 },
  { at: 6, good: true, label: 'Fixed at 2:24 AM', dy: -30 },
  { at: 8, good: true, label: 'Stopped a bad release', dy: -30 },
];

/** The card's width in stage pixels: wide beside the headline, narrower on a phone so its text stays readable. */
const WIDE = 560;
const NARROW = 480;
const PLOT = 200;
const TOP = 30;
const MAX = 7500;
/** Where month `i` sits across a chart `w` wide. */
const xScale = (w: number) => (i: number) => 14 + (i * (w - 28)) / (MONTHS.length - 1);
const y = (v: number) => PLOT - (v / MAX) * (PLOT - TOP);

/** The value of a monthly series at a fractional month. */
function at(series: number[], pos: number) {
  const i = Math.min(Math.floor(pos), series.length - 2);
  return series[i]! + (series[i + 1]! - series[i]!) * (pos - i);
}

/** The line through months `a`..`b`, drawn as far as `pos`. */
function line(x: (i: number) => number, a: number, b: number, pos: number) {
  if (pos <= a) return '';
  const end = Math.min(b, pos);
  const pts: string[] = [];
  for (let i = a; i <= Math.floor(end); i++) pts.push(`${x(i).toFixed(1)},${y(REVENUE[i]!).toFixed(1)}`);
  if (end % 1) pts.push(`${x(end).toFixed(1)},${y(at(REVENUE, end)).toFixed(1)}`);
  return `M${pts.join('L')}`;
}

const money = (v: number) => `$${(Math.round(v / 10) * 10).toLocaleString('en-US')}`;
const pillWidth = (text: string) => text.length * 6.6 + 18;

const DRAW_FROM = 0.6;
const DRAW_TO = 6.6;

export function GrowthScene() {
  const { ref, t } = useClock(DRAW_TO + 0.6, DRAW_TO + 0.6, true);
  const width = useNarrow() ? NARROW : WIDE;
  const W = width - 48;
  const x = xScale(W);
  const pos = easeOut(span(t, DRAW_FROM, DRAW_TO)) * (MONTHS.length - 1);
  const done = easeOut(span(t, DRAW_TO, DRAW_TO + 0.6));
  const after = line(x, START, MONTHS.length - 1, pos);
  const issues = Math.round(at(ISSUES, pos));

  return (
    <div ref={ref} className="bs-growth">
      <Stage
        width={width}
        height={540}
        label="An example business over a year. Monthly revenue stays flat around $2,000 with outages and bad releases until the AI CTO starts, then climbs to $6,700 as problems get fixed, open issues fall from 14 to 1 and cancellations shrink."
      >
        <div className="bs-dash">
          <div className="bs-dash-head">
            <b>Dana's app</b>
            <span>Example business</span>
          </div>
          <div className="bs-dash-stats">
            <div>
              <span>Monthly revenue</span>
              <b>{money(at(REVENUE, pos))}</b>
              <em className="up" style={{ opacity: done }}>
                +$4,600 a month
              </em>
            </div>
            <div>
              <span>Open issues</span>
              <b className={issues >= 8 ? 'bad' : 'good'}>{issues}</b>
              <em style={{ opacity: done }}>down from 14</em>
            </div>
            <div>
              <span>Customers</span>
              <b>{Math.round(at(CUSTOMERS, pos))}</b>
              <em style={{ opacity: done }}>paying each month</em>
            </div>
          </div>

          <svg className="bs-dash-chart" width={W} height={232} viewBox={`0 0 ${W} 232`}>
            <defs>
              <linearGradient id="bs-growth-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--accent)" stopOpacity="0.22" />
                <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[2000, 4000, 6000].map((v) => (
              <line key={v} className="grid" x1={0} x2={W} y1={y(v)} y2={y(v)} />
            ))}
            <line className="grid" x1={0} x2={W} y1={PLOT} y2={PLOT} />
            {MONTHS.map((m, i) => (
              <text key={m} className="month" x={x(i)} y={PLOT + 20} textAnchor="middle">
                {m}
              </text>
            ))}

            <g>
              <g style={{ opacity: easeOut(span(pos, START - 0.2, START + 0.3)) }}>
                <line className="marker" x1={x(START)} x2={x(START)} y1={8} y2={PLOT} />
                <rect className="marker-pill" x={x(START) - 54} y={0} width={108} height={22} rx={11} />
                <text className="marker-text" x={x(START)} y={15} textAnchor="middle">
                  AI CTO started
                </text>
              </g>
              {after && <path className="area" d={`${after}L${x(pos).toFixed(1)},${PLOT}L${x(START)},${PLOT}Z`} />}
              <path className="before" d={line(x, 0, START, pos)} />
              <path className="after" d={after} />

              {EVENTS.map((e) => {
                const k = easeOut(span(pos, e.at, e.at + 0.35));
                if (k <= 0) return null;
                const cx = x(e.at);
                const cy = y(REVENUE[e.at]!);
                const w = pillWidth(e.label);
                const px = Math.min(W - w - 2, Math.max(2, e.good ? cx - w + 12 : cx - w / 2));
                return (
                  <g key={e.label} className={e.good ? 'good' : 'bad'} style={{ opacity: k }}>
                    <rect className="pill" x={px} y={cy + e.dy - 11} width={w} height={22} rx={11} />
                    <text className="pill-text" x={px + w / 2} y={cy + e.dy + 4} textAnchor="middle">
                      {e.label}
                    </text>
                    <circle className="dot" cx={cx} cy={cy} r={6} />
                    {e.good && <path className="check" d={`M${cx - 3},${cy}l2,2.2l4,-4.4`} />}
                  </g>
                );
              })}
              {pos > 0 && <circle className="head" cx={x(pos)} cy={y(at(REVENUE, pos))} r={4.5} />}
            </g>
          </svg>

          <div className="bs-dash-label">Cancellations per month</div>
          <svg className="bs-dash-bars" width={W} height={84} viewBox={`0 0 ${W} 84`}>
            <line className="grid" x1={0} x2={W} y1={80} y2={80} />
            <g>
              {CANCELLED.map((c, i) => {
                const k = easeOut(span(pos, i - 0.4, i + 0.2));
                const h = (c / 12) * 70 * k;
                return (
                  <rect
                    key={MONTHS[i]}
                    className={i < START ? 'bad' : 'good'}
                    x={x(i) - 11}
                    y={80 - h}
                    width={22}
                    height={h}
                    rx={3}
                  />
                );
              })}
            </g>
          </svg>
        </div>
      </Stage>
    </div>
  );
}
