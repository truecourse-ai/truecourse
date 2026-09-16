import type { ReactNode } from 'react';
import { useProgress } from '@/lib/useProgress';
import {
  HEADER_H,
  HLine,
  PageHeader,
  Sidebar,
  SIDEBAR_W,
  StatusWord,
  Txt,
  VLine,
  order,
  statusWordWidth,
} from './primitives';
import { TONE, baseline, textWidth, ui, type Tone } from './theme';
import { useCompact } from './use-compact';

type FlowStatus = 'succeeded' | 'failed' | 'blocked' | 'notTestable' | 'neverRun';

/** The five words in the order the Home strip counts them. */
const STATUS: { key: FlowStatus; word: string; tone: Tone }[] = [
  { key: 'succeeded', word: 'Succeeded', tone: 'success' },
  { key: 'failed', word: 'Failed', tone: 'failure' },
  { key: 'blocked', word: 'Blocked', tone: 'blocked' },
  { key: 'notTestable', word: 'Not testable', tone: 'neutral' },
  { key: 'neverRun', word: 'Never run', tone: 'unproven' },
];

/** Bottom first: what is proved is the ground, the worst news sits on top. */
const STACK: FlowStatus[] = ['succeeded', 'neverRun', 'notTestable', 'blocked', 'failed'];

type Values = Record<FlowStatus, number>;

const day = (date: string, s: number, nr: number, nt: number, b: number, f: number) => ({
  date,
  values: { succeeded: s, neverRun: nr, notTestable: nt, blocked: b, failed: f } as Values,
});

/** Two weeks of daily runs: flows arrive, and what they prove grows. */
const DAYS = [
  day('Sep 2', 6, 18, 3, 2, 1),
  day('Sep 3', 9, 17, 3, 2, 1),
  day('Sep 4', 14, 14, 4, 2, 2),
  day('Sep 5', 18, 12, 4, 3, 2),
  day('Sep 6', 23, 10, 4, 3, 2),
  day('Sep 7', 27, 9, 5, 2, 3),
  day('Sep 8', 31, 8, 5, 2, 2),
  day('Sep 9', 34, 8, 5, 3, 2),
  day('Sep 10', 38, 6, 5, 3, 2),
  day('Sep 11', 41, 5, 6, 3, 3),
  day('Sep 12', 44, 4, 6, 2, 3),
  day('Sep 13', 47, 3, 6, 2, 3),
  day('Sep 14', 49, 3, 6, 2, 3),
  day('Sep 15', 51, 2, 6, 2, 3),
];

const total = (v: Values) => STATUS.reduce((n, s) => n + v[s.key], 0);
const MAX = Math.max(...DAYS.map((d) => total(d.values)));

/** The counts at a point of the run, between two days. */
function valuesAt(progress: number): Values {
  const at = progress * (DAYS.length - 1);
  const i0 = Math.floor(at);
  const i1 = Math.min(DAYS.length - 1, i0 + 1);
  const f = at - i0;
  const out = {} as Values;
  for (const s of STATUS) {
    const a = DAYS[i0]!.values[s.key];
    const b = DAYS[i1]!.values[s.key];
    out[s.key] = Math.round(a + (b - a) * f);
  }
  return out;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const STROKE = 'rgba(17, 24, 39, 0.18)';

/** A window of the composition: its own shadow, corner radius and border. */
function Panel({ id, box, children }: { id: string; box: Box; children: ReactNode }) {
  return (
    <g>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={10} fill={ui.bg} filter="url(#hero-shadow)" />
      <clipPath id={id}>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={10} />
      </clipPath>
      <g clipPath={`url(#${id})`}>
        <g transform={`translate(${box.x} ${box.y})`}>{children}</g>
      </g>
      <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={10} fill="none" stroke={STROKE} />
    </g>
  );
}

/** Today's numbers: the succeeded share, then every status, each a cell of one strip. */
function StatStrip({ box, cols, values }: { box: Box; cols: number; values: Values }) {
  const sum = total(values);
  const share = Math.round((values.succeeded / sum) * 100);
  const cellW = box.w / cols;
  const rows = Math.ceil((STATUS.length + 1) / cols);
  const cellH = box.h / rows;
  const cell = (i: number) => ({ x: box.x + (i % cols) * cellW, y: box.y + Math.floor(i / cols) * cellH });
  const numY = (top: number) => baseline(top + 24, 22);
  const subCy = (top: number) => top + 44;
  const first = cell(0);
  return (
    <g>
      <Txt x={first.x + 14} y={numY(first.y)} size={22} weight={600}>
        {`${share}%`}
      </Txt>
      <Txt x={first.x + 14} y={baseline(subCy(first.y), 9.5)} size={9.5} fill={ui.muted}>
        {`${values.succeeded} of ${sum} flows succeeded`}
      </Txt>
      {STATUS.map((s, i) => {
        const at = cell(i + 1);
        return (
          <g key={s.key}>
            <Txt x={at.x + 14} y={numY(at.y)} size={22} weight={600}>
              {String(values[s.key])}
            </Txt>
            <circle cx={at.x + 18} cy={subCy(at.y)} r={3.5} fill={TONE[s.tone]} />
            <Txt x={at.x + 26} y={baseline(subCy(at.y), 10)} size={10} fill={ui.muted}>
              {s.word}
            </Txt>
          </g>
        );
      })}
      {Array.from({ length: cols - 1 }, (_, i) => (
        <VLine key={`v${i}`} x={box.x + (i + 1) * cellW} y0={box.y} y1={box.y + box.h} />
      ))}
      {Array.from({ length: rows }, (_, r) => (
        <HLine key={`h${r}`} y={box.y + (r + 1) * cellH} x0={box.x} x1={box.x + box.w} />
      ))}
    </g>
  );
}

/** The chart's periods, as the filter idiom's chips, the current one pressed. */
function Periods({ x, cy }: { x: number; cy: number }) {
  let cursor = x;
  return (
    <g>
      {['7d', '30d', '90d', 'All'].map((label) => {
        const w = textWidth(label, 9) + 12;
        const on = label === '30d';
        const left = cursor;
        cursor += w + 4;
        return (
          <g key={label}>
            <rect x={left} y={cy - 8} width={w} height={16} rx={8} fill={on ? ui.primary : ui.soft} />
            <Txt x={left + w / 2} y={baseline(cy, 9)} size={9} weight={500} fill={on ? ui.onPrimary : ui.fg} anchor="middle">
              {label}
            </Txt>
          </g>
        );
      })}
    </g>
  );
}

/** The legend, worst first, ending at `right`. */
function Legend({ right, cy }: { right: number; cy: number }) {
  let cursor = right;
  return (
    <g>
      {[...STACK].reverse().map((key) => {
        const s = STATUS.find((item) => item.key === key)!;
        const w = 12 + textWidth(s.word, 10);
        cursor -= w;
        const left = cursor;
        cursor -= 14;
        return (
          <g key={key}>
            <circle cx={left + 3.5} cy={cy} r={3.5} fill={TONE[s.tone]} />
            <Txt x={left + 12} y={baseline(cy, 10)} size={10} fill={ui.muted}>
              {s.word}
            </Txt>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Flows over time: one band per status, stacked. The wipe reveals the plot
 * from the first run to the latest, and the readout names the day its front
 * has reached, the way the app's readout follows the pointer.
 */
function FlowsOverTime({ box, progress, compact }: { box: Box; progress: number; compact: boolean }) {
  const plotTop = compact ? 50 : 34;
  const plot = { x: box.x, y: box.y + plotTop, w: box.w, h: box.h - plotTop - 26 };
  const px = (i: number) => plot.x + (i / (DAYS.length - 1)) * plot.w;
  const py = (v: number) => plot.y + plot.h - (v / MAX) * plot.h;
  const tops: number[][] = [];
  let below = DAYS.map(() => 0);
  for (const key of STACK) {
    const top = DAYS.map((d, i) => below[i]! + d.values[key]);
    tops.push(top);
    below = top;
  }
  const areas = STACK.map((key, si) => {
    const top = tops[si]!;
    const bottom = si === 0 ? DAYS.map(() => 0) : tops[si - 1]!;
    const up = DAYS.map((_, i) => `${px(i).toFixed(1)},${py(top[i]!).toFixed(1)}`);
    const down = DAYS.map((_, i) => `${px(i).toFixed(1)},${py(bottom[i]!).toFixed(1)}`).reverse();
    const tone = STATUS.find((s) => s.key === key)!.tone;
    return { key, fill: TONE[tone], path: `M${up.join(' L')} L${down.join(' L')} Z`, edge: `M${up.join(' L')}` };
  });
  const labelCy = box.y + 12;
  const labelEnd = box.x + textWidth('Flows over time', 10) + 8;
  const day = DAYS[Math.round(progress * (DAYS.length - 1))]!;
  const middle = DAYS[Math.floor((DAYS.length - 1) / 2)]!;
  return (
    <g>
      <Txt x={box.x} y={baseline(labelCy, 10)} size={10} fill={ui.muted} upper>
        Flows over time
      </Txt>
      {!compact && <Periods x={labelEnd + 6} cy={labelCy} />}
      {progress < 1 && (
        <Txt x={labelEnd + (compact ? 4 : 126)} y={baseline(labelCy, 10)} size={10} fill={ui.muted}>
          {day.date}
        </Txt>
      )}
      <Legend right={box.x + box.w} cy={compact ? labelCy + 18 : labelCy} />
      <clipPath id="hero-wipe">
        <rect x={plot.x} y={plot.y - 2} width={plot.w * progress} height={plot.h + 4} />
      </clipPath>
      <g clipPath="url(#hero-wipe)">
        {areas.map((a) => (
          <path key={a.key} d={a.path} fill={a.fill} />
        ))}
        {areas.map((a) => (
          <path key={`${a.key}-edge`} d={a.edge} fill="none" stroke={ui.bg} strokeWidth={2} />
        ))}
      </g>
      <Txt x={plot.x} y={plot.y + plot.h + 16} size={9.5} fill={ui.muted}>
        {DAYS[0]!.date}
      </Txt>
      <Txt x={plot.x + plot.w / 2} y={plot.y + plot.h + 16} size={9.5} fill={ui.muted} anchor="middle">
        {middle.date}
      </Txt>
      <Txt x={plot.x + plot.w} y={plot.y + plot.h + 16} size={9.5} fill={ui.muted} anchor="end">
        {DAYS[DAYS.length - 1]!.date}
      </Txt>
    </g>
  );
}

/** The Home page: the strip of today's numbers over the trend. */
function HomePanel({ box, compact, progress }: { box: Box; compact: boolean; progress: number }) {
  const x0 = compact ? 0 : SIDEBAR_W;
  const pad = compact ? 16 : 24;
  const stripH = compact ? 104 : 64;
  const chartTop = HEADER_H + stripH + 16;
  return (
    <Panel id="hero-home" box={box}>
      {!compact && <Sidebar height={box.h} active="Home" />}
      <PageHeader x={x0} right={box.w} title="Home" titleX={x0 + pad} />
      <StatStrip box={{ x: x0, y: HEADER_H, w: box.w - x0, h: stripH }} cols={compact ? 3 : 6} values={valuesAt(progress)} />
      <FlowsOverTime
        box={{ x: x0 + pad, y: chartTop, w: box.w - x0 - 2 * pad, h: box.h - chartTop - 8 }}
        progress={progress}
        compact={compact}
      />
    </Panel>
  );
}

type Coverage = 'proved' | 'failed' | 'blocked';

const COVERAGE: Record<Coverage, { word: string; tone: Tone }> = {
  proved: { word: 'Proved', tone: 'success' },
  failed: { word: 'Failed', tone: 'failure' },
  blocked: { word: 'Blocked', tone: 'blocked' },
};

interface Section {
  heading: string;
  lines: string[];
  status: Coverage;
}

const SECTIONS: Section[] = [
  {
    heading: 'Refund window',
    lines: ['Partial refunds are allowed within ninety days', 'of the charge.'],
    status: 'proved',
  },
  {
    heading: 'Payment method',
    lines: ['Refunds must return to the original payment', 'method.'],
    status: 'failed',
  },
  {
    heading: 'Approvals',
    lines: ['Refunds above five hundred dollars need a second', 'approval from finance.'],
    status: 'blocked',
  },
  {
    heading: 'Credit notes',
    lines: ['A refunded invoice keeps its number and receives', 'a credit note.'],
    status: 'proved',
  },
  {
    heading: 'Store credit',
    lines: ['Store credit is offered only when the customer', 'asks for it.'],
    status: 'proved',
  },
];

const NOT_RUN = { word: 'Not run', tone: 'neutral' as Tone };

/**
 * One section of the document, twice: the grey Not run it starts as, which
 * goes, and the coloured reading it settles to. The band and the tint are the
 * app's; the dot and word sit in the right gutter.
 */
function DocSection({
  index,
  section,
  x,
  y,
  w,
  h,
}: {
  index: number;
  section: Section;
  x: number;
  y: number;
  w: number;
  h: number;
}) {
  const state = COVERAGE[section.status];
  const gutter = (word: string) => x + w - statusWordWidth(word, 10.5);
  const layer = (reading: { word: string; tone: Tone }, tinted: boolean) => (
    <g>
      {tinted && <rect x={x} y={y} width={w} height={h} rx={4} fill={TONE[reading.tone]} opacity={0.08} />}
      <rect x={x} y={y} width={3} height={h} rx={1.5} fill={TONE[reading.tone]} />
      <StatusWord x={gutter(reading.word)} cy={y + 14} tone={reading.tone} word={reading.word} size={10.5} />
    </g>
  );
  return (
    <g>
      <g className="sc-out hd-grey" style={order(index)}>
        {layer(NOT_RUN, false)}
      </g>
      <g className="sc-in hd-lit" style={order(index)}>
        {layer(state, true)}
      </g>
      <Txt x={x + 12} y={baseline(y + 14, 11.5)} size={11.5} weight={600}>
        {section.heading}
      </Txt>
      {section.lines.map((line, i) => (
        <Txt key={line} x={x + 12} y={baseline(y + 30 + i * 13, 10.5)} size={10.5} fill={ui.fg}>
          {line}
        </Txt>
      ))}
    </g>
  );
}

/** The document, painted by section, as Context opens it. */
function DocPanel({ box }: { box: Box }) {
  const pad = 16;
  const top = 64;
  const gap = 6;
  const sectionH = 54;
  return (
    <Panel id="hero-doc" box={box}>
      <Txt x={pad} y={baseline(22, 12.5)} size={12.5} weight={600}>
        Refunds and credit notes
      </Txt>
      <g stroke={ui.muted} strokeWidth={1.4} strokeLinecap="round">
        <line x1={box.w - pad - 8} y1={18} x2={box.w - pad} y2={26} />
        <line x1={box.w - pad} y1={18} x2={box.w - pad - 8} y2={26} />
      </g>
      <Txt x={pad} y={40} size={10} fill={ui.muted}>
        Northwind Docs · docs/billing/refunds.md
      </Txt>
      <HLine y={52} x0={0} x1={box.w} />
      {SECTIONS.map((section, i) => (
        <DocSection
          key={section.heading}
          index={i}
          section={section}
          x={pad}
          y={top + i * (sectionH + gap)}
          w={box.w - 2 * pad}
          h={sectionH}
        />
      ))}
    </Panel>
  );
}

const LABEL =
  'The TrueCourse dashboard: the Home page with 51 of 64 flows succeeded and the flows-over-time chart, and in front of it the document "Refunds and credit notes" with each section marked Proved, Failed or Blocked';

/**
 * The hero: the Home page and, in front of it, one document lit by coverage.
 * The chart and the counts run on `visible`; the sections settle on the same
 * signal through the screen's motion classes.
 */
export function HomeScreen({ visible }: { visible: boolean }) {
  const compact = useCompact();
  const progress = useProgress(visible, 500, 1800);
  const W = compact ? 500 : 1040;
  const H = compact ? 672 : 522;
  const home: Box = compact ? { x: 0, y: 0, w: 500, h: 340 } : { x: 60, y: 0, w: 980, h: 380 };
  const doc: Box = compact ? { x: 20, y: 300, w: 460, h: 372 } : { x: 0, y: 150, w: 380, h: 372 };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="screen-home"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={LABEL}
      style={{ fontFamily: 'var(--font-ui)' }}
    >
      <defs>
        <filter id="hero-shadow" x="-10%" y="-10%" width="120%" height="135%">
          <feDropShadow dx="0" dy="16" stdDeviation="16" floodColor="#111827" floodOpacity="0.16" />
        </filter>
      </defs>
      <HomePanel box={home} compact={compact} progress={progress} />
      <DocPanel box={doc} />
    </svg>
  );
}
