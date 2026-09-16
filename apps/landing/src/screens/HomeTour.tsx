import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useProgress } from '@/lib/useProgress';
import { RunView } from './evidence';
import {
  HEADER_H,
  HLine,
  PageHeader,
  Screen,
  SentenceHighlight,
  Sidebar,
  SIDEBAR_W,
  StatusWord,
  Txt,
  VLine,
  order,
  type NavPage,
} from './primitives';
import { TONE, baseline, textWidth, uiWidth, ui, type Tone } from './theme';
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

/** Where the plot of the chart sits inside its box, and the point the pointer clicks. */
function plotOf(box: Box, compact: boolean) {
  const plotTop = compact ? 50 : 34;
  const plot = { x: box.x, y: box.y + plotTop, w: box.w, h: box.h - plotTop - 26 };
  const px = (i: number) => plot.x + (i / (DAYS.length - 1)) * plot.w;
  const py = (v: number) => plot.y + plot.h - (v / MAX) * plot.h;
  const i = DAYS.length - 2;
  const d = DAYS[i]!.values;
  const sum = total(d);
  return { plot, px, py, click: { x: px(i), y: (py(sum) + py(sum - d.failed)) / 2 } };
}

/**
 * Flows over time: one band per status, stacked. The wipe reveals the plot
 * from the first run to the latest, and the readout names the day its front
 * has reached, the way the app's readout follows the pointer.
 */
function FlowsOverTime({ box, progress, compact }: { box: Box; progress: number; compact: boolean }) {
  const { plot, px, py } = plotOf(box, compact);
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
      <clipPath id="tour-wipe">
        <rect x={plot.x} y={plot.y - 2} width={plot.w * progress} height={plot.h + 4} />
      </clipPath>
      <g clipPath="url(#tour-wipe)">
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

/** The pointer that walks to the thing the next scene opens, and clicks it. */
function Pointer({
  from,
  to,
  at,
  click,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** When the pointer appears, and when it clicks, from the scene's start. */
  at: number;
  click: number;
}) {
  const vars = {
    ['--x0' as string]: `${from.x}px`,
    ['--y0' as string]: `${from.y}px`,
    ['--x1' as string]: `${to.x}px`,
    ['--y1' as string]: `${to.y}px`,
    ['--pointer-at' as string]: `${at}ms`,
    ['--click-at' as string]: `${click}ms`,
  } as CSSProperties;
  return (
    <g className="tour-pointer" style={vars}>
      <circle className="tour-click" r={14} fill="none" stroke={ui.fg} strokeWidth={1.5} />
      <path
        d="M0 0 L0 15 L4 11.5 L7 17.5 L9.5 16.5 L6.5 10.5 L11 10 Z"
        fill="#fff"
        stroke={ui.fg}
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </g>
  );
}

/** One page of the app: the shell, and the scene's own content in the content area. */
function Page({
  W,
  H,
  compact,
  active,
  title,
  children,
  label,
}: {
  W: number;
  H: number;
  compact: boolean;
  active: NavPage;
  title: string;
  label: string;
  children: ReactNode;
}) {
  const x0 = compact ? 0 : SIDEBAR_W;
  const titleX = x0 + (compact ? 16 : 24);
  return (
    <Screen width={W} height={H} label={label} className="screen-tour">
      {!compact && <Sidebar height={H} active={active} />}
      <PageHeader x={x0} right={W} title={title} titleX={titleX} />
      {children}
    </Screen>
  );
}

/** Scene a: the Home page, its numbers and its trend, and the pointer's click. */
function HomeScene({ W, H, compact, progress }: { W: number; H: number; compact: boolean; progress: number }) {
  const x0 = compact ? 0 : SIDEBAR_W;
  const pad = compact ? 16 : 24;
  const stripH = compact ? 104 : 64;
  const chartTop = HEADER_H + stripH + 16;
  const box = { x: x0 + pad, y: chartTop, w: W - x0 - 2 * pad, h: H - chartTop - 8 };
  const { click } = plotOf(box, compact);
  return (
    <Page W={W} H={H} compact={compact} active="Home" title="Home" label="The Home page: 51 of 64 flows succeeded, and the flows-over-time chart">
      <StatStrip box={{ x: x0, y: HEADER_H, w: W - x0, h: stripH }} cols={compact ? 3 : 6} values={valuesAt(progress)} />
      <FlowsOverTime box={box} progress={progress} compact={compact} />
      <Pointer from={{ x: x0 + box.w * 0.55, y: H - 90 }} to={{ x: click.x - 2, y: click.y - 2 }} at={1300} click={2750} />
    </Page>
  );
}

type Coverage = 'proved' | 'failed' | 'blocked';

const COVERAGE: Record<Coverage, { word: string; tone: Tone }> = {
  proved: { word: 'Proved', tone: 'success' },
  failed: { word: 'Failed', tone: 'failure' },
  blocked: { word: 'Blocked', tone: 'blocked' },
};

const SECTIONS: { heading: string; text: string; status: Coverage }[] = [
  {
    heading: 'Refund window',
    text: 'Partial refunds are allowed within ninety days of the charge, in the currency the invoice was issued in.',
    status: 'proved',
  },
  {
    heading: 'Payment method',
    text: 'Refunds must return to the original payment method. Store credit is offered only when the customer asks for it.',
    status: 'failed',
  },
  {
    heading: 'Approvals',
    text: 'Refunds above five hundred dollars need a second approval from finance before they are issued.',
    status: 'blocked',
  },
  {
    heading: 'Credit notes',
    text: 'A refunded invoice keeps its number and receives a credit note for the refunded amount.',
    status: 'proved',
  },
  {
    heading: 'Notice',
    text: 'The customer is told by email once the refund has been issued, with the credit note attached.',
    status: 'proved',
  },
];

/** The sentence the story follows, the one the failed flow quotes. */
const SENTENCE = 'Refunds must return to the original payment method.';

const NOT_RUN = { word: 'Not run', tone: 'neutral' as Tone };

/** Greedy word wrap at a character budget, as the reader pane breaks a paragraph. */
function wrap(text: string, chars: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > chars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const STATUS_COL = 80;

/** Scene b: the document open in Context, every section judged, the sentence lit. */
function DocScene({ W, H, compact }: { W: number; H: number; compact: boolean }) {
  const x0 = compact ? 0 : SIDEBAR_W;
  const pad = compact ? 16 : 24;
  const x = x0 + pad;
  const w = W - x0 - 2 * pad;
  const size = compact ? 11.5 : 12.5;
  const lineH = compact ? 16 : 17;
  const chars = compact ? 50 : 84;
  const sectionH = compact ? 68 : 70;
  const gap = 8;
  const top = HEADER_H + 64;
  const tallyY = top + SECTIONS.length * sectionH + (SECTIONS.length - 1) * gap + 10;
  const failed = SECTIONS.findIndex((section) => section.status === 'failed');
  const counts = (['proved', 'failed', 'blocked'] as Coverage[]).map((status) => ({
    ...COVERAGE[status],
    count: SECTIONS.filter((s) => s.status === status).length,
  }));
  let cursor = x;
  return (
    <Page W={W} H={H} compact={compact} active="Context" title="Context" label="The document Refunds and credit notes, each of its five sections judged: Refund window proved, Payment method failed, Approvals blocked, Credit notes and Notice proved">
      <Txt x={x} y={baseline(HEADER_H + 22, compact ? 14 : 16)} size={compact ? 14 : 16} weight={600}>
        Refunds and credit notes
      </Txt>
      <Txt x={x} y={baseline(HEADER_H + 42, 10.5)} size={10.5} fill={ui.muted}>
        Northwind Docs · docs/billing/refunds.md · 5 requirements
      </Txt>
      <HLine y={HEADER_H + 54} x0={x0} x1={W} />
      {SECTIONS.map((section, i) => {
        const y = top + i * (sectionH + gap);
        const state = COVERAGE[section.status];
        const layer = (reading: { word: string; tone: Tone }, tinted: boolean) => (
          <g>
            {tinted && <rect x={x} y={y} width={w} height={sectionH} rx={5} fill={TONE[reading.tone]} opacity={0.08} />}
            <rect x={x} y={y} width={3} height={sectionH} rx={1.5} fill={TONE[reading.tone]} />
            <StatusWord x={x + w - STATUS_COL} cy={y + 16} tone={reading.tone} word={reading.word} size={11.5} />
          </g>
        );
        // The judged sentence keeps a line to itself, so its highlight ends with it.
        const lines =
          section.status === 'failed' && section.text.startsWith(SENTENCE)
            ? [SENTENCE, ...wrap(section.text.slice(SENTENCE.length).trim(), chars)]
            : wrap(section.text, chars);
        return (
          <g key={section.heading}>
            <g className="sc-out hd-grey" style={order(i)}>
              {layer(NOT_RUN, false)}
            </g>
            <g className="sc-in hd-lit" style={order(i)}>
              {layer(state, true)}
            </g>
            {section.status === 'failed' && (
              <g className="sc-in hd-hl">
                <SentenceHighlight x={x + 14} y={baseline(y + 34, size)} size={size} lines={[SENTENCE]} />
              </g>
            )}
            <Txt x={x + 14} y={baseline(y + 16, size + 0.5)} size={size + 0.5} weight={600}>
              {section.heading}
            </Txt>
            {lines.map((line, li) => (
              <Txt key={line} x={x + 14} y={baseline(y + 34 + li * lineH, size)} size={size}>
                {line}
              </Txt>
            ))}
          </g>
        );
      })}
      <g className="sc-in hd-tally">
        <HLine y={tallyY} x0={x0} x1={W} />
        {counts.map((c) => {
          const label = `${c.count} ${c.word}`;
          const at = cursor;
          cursor += 14 + textWidth(label, 11) + 16;
          return <StatusWord key={c.word} x={at} cy={tallyY + 20} tone={c.tone} word={label} size={11} />;
        })}
        <Txt x={cursor} y={baseline(tallyY + 20, 11)} size={11} fill={ui.muted}>
          {`${SECTIONS.length} requirements`}
        </Txt>
      </g>
      <Pointer
        from={{ x: x + w * 0.62, y: H - 70 }}
        to={{ x: x + 14 + uiWidth(SENTENCE, size) * 0.55, y: top + failed * (sectionH + gap) + 30 }}
        at={1500}
        click={2900}
      />
    </Page>
  );
}

/** Scene c: the run of the failed flow, the reading step 3 gives it. */
function RunScene({ W, H, compact }: { W: number; H: number; compact: boolean }) {
  return (
    <Page
      W={W}
      H={H}
      compact={compact}
      active="Flows"
      title="Flows"
      label="The run of refund-returns-to-original-method, failed: the verdict band, a replay tile and four step screenshots of the Northwind billing app with the fourth marked failed, the steps with step 4 open on expected Refunded to Visa 4242 against actual Issued as store credit, and the transcript"
    >
      <RunView W={W} x0={compact ? 0 : SIDEBAR_W} compact={compact} id="tour" />
    </Page>
  );
}

const SCENES = ['Home', 'The requirement', 'The run'] as const;
const LAST = SCENES.length - 1;
/** How long each scene holds before the next, from the moment it comes on. */
const HOLD = [3000, 3100];

/**
 * The hero: the dashboard, toured once. Home with the trend and the pointer's
 * click on the failed band, the requirement judged and the pointer's click on
 * the failed one, and the run with the pictures. Dots under the stage jump
 * between scenes; reduced motion and the no-JS page show the run, the still
 * that says most.
 */
export function HomeTour({ visible }: { visible: boolean }) {
  const compact = useCompact();
  const W = compact ? 500 : 1040;
  const H = 560;
  const [scene, setScene] = useState(0);
  const reduced = useRef(false);
  const seen = useRef(new Set<number>());
  const progress = useProgress(visible && scene === 0, 300, 1500);

  useEffect(() => {
    if (!visible) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reduced.current = true;
      setScene(LAST);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || reduced.current || scene >= LAST) return;
    const t = window.setTimeout(() => setScene(scene + 1), HOLD[scene]);
    return () => window.clearTimeout(t);
  }, [visible, scene]);

  if (visible) seen.current.add(scene);

  const scenes = [
    <HomeScene key="home" W={W} H={H} compact={compact} progress={progress} />,
    <DocScene key="doc" W={W} H={H} compact={compact} />,
    <RunScene key="run" W={W} H={H} compact={compact} />,
  ];

  return (
    <div className="tour">
      <div className="tour-stage screen" style={{ aspectRatio: `${W} / ${H}` }}>
        {scenes.map((node, i) => {
          const on = visible && i === scene;
          const done = !on && seen.current.has(i);
          const cls = ['tour-scene', i === LAST && 'still', on && 'on', done && 'done'].filter(Boolean).join(' ');
          return (
            <div key={SCENES[i]} className={cls} aria-hidden={!on && visible ? true : undefined}>
              {node}
            </div>
          );
        })}
      </div>
      <div className="tour-dots" role="tablist" aria-label="Tour scenes">
        {SCENES.map((name, i) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={i === scene}
            aria-label={name}
            className={i === scene ? 'on' : undefined}
            onClick={() => setScene(i)}
          />
        ))}
      </div>
    </div>
  );
}
