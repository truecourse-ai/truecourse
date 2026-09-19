import type { ReactNode } from 'react';
import { SiGithub } from 'react-icons/si';
import {
  Button,
  HEADER_H,
  HLine,
  PageHeader,
  Screen,
  SearchBox,
  Sidebar,
  SIDEBAR_W,
  StatusWord,
  TableHead,
  Tally,
  Txt,
  cellX,
  type Col,
} from './primitives';
import { SCREEN_H, TONE, baseline, textWidth, ui, type Tone } from './theme';

/** The five coverage words, worst first, as the Requirements bar orders them. */
const SEGMENTS: { key: keyof Counts; tone: Tone }[] = [
  { key: 'failed', tone: 'failure' },
  { key: 'blocked', tone: 'blocked' },
  { key: 'neverRun', tone: 'unproven' },
  { key: 'succeeded', tone: 'success' },
  { key: 'notTestable', tone: 'neutral' },
];

interface Counts {
  failed: number;
  blocked: number;
  neverRun: number;
  succeeded: number;
  notTestable: number;
}

export interface Repo {
  name: string;
  counts: Counts;
  check: { tone: Tone; word: string; at: string };
  baseline: string;
}

export const REPOS: Repo[] = [
  {
    name: 'northwind/billing',
    counts: { failed: 3, blocked: 2, neverRun: 0, succeeded: 41, notTestable: 6 },
    check: { tone: 'failure', word: 'Failing', at: '12 min ago' },
    baseline: 'main · 2h ago',
  },
  {
    name: 'northwind/checkout',
    counts: { failed: 0, blocked: 1, neverRun: 4, succeeded: 58, notTestable: 3 },
    check: { tone: 'success', word: 'Passing', at: '1h ago' },
    baseline: 'main · 1d ago',
  },
  {
    name: 'northwind/ledger',
    counts: { failed: 1, blocked: 0, neverRun: 9, succeeded: 30, notTestable: 4 },
    check: { tone: 'failure', word: 'Failing', at: '5h ago' },
    baseline: 'main · 3d ago',
  },
  {
    name: 'northwind/notifications',
    counts: { failed: 0, blocked: 0, neverRun: 0, succeeded: 22, notTestable: 2 },
    check: { tone: 'success', word: 'Passing', at: '3h ago' },
    baseline: 'main · 2d ago',
  },
  {
    name: 'northwind/customer-portal',
    counts: { failed: 0, blocked: 3, neverRun: 0, succeeded: 35, notTestable: 1 },
    check: { tone: 'success', word: 'Passing', at: '8h ago' },
    baseline: 'main · 4d ago',
  },
  {
    name: 'northwind/api-gateway',
    counts: { failed: 0, blocked: 0, neverRun: 12, succeeded: 15, notTestable: 2 },
    check: { tone: 'success', word: 'Passing', at: '1d ago' },
    baseline: 'main · 5d ago',
  },
];

function total(counts: Counts): number {
  return SEGMENTS.reduce((n, seg) => n + counts[seg.key], 0);
}

function proven(counts: Counts): string {
  return `${Math.round((counts.succeeded / total(counts)) * 100)}%`;
}

const BAR_W = 120;

/** The segmented bar and the dot tallies beside it, zero buckets left out. */
function Requirements({ x, cy, counts }: { x: number; cy: number; counts: Counts }) {
  const shown = SEGMENTS.filter((seg) => counts[seg.key] > 0);
  const sum = total(counts);
  const usable = BAR_W - 2 * (shown.length - 1);
  let barX = x;
  let dotX = x + BAR_W + 12;
  return (
    <g>
      {shown.map((seg) => {
        const w = Math.max(3, (usable * counts[seg.key]) / sum);
        const at = barX;
        barX += w + 2;
        return <rect key={seg.key} x={at} y={cy - 4} width={w} height={8} rx={1.5} fill={TONE[seg.tone]} />;
      })}
      {shown.map((seg) => {
        const label = String(counts[seg.key]);
        const at = dotX;
        dotX += 12 + textWidth(label, 10) + 10;
        return (
          <g key={seg.key}>
            <circle cx={at + 4} cy={cy} r={4} fill={TONE[seg.tone]} />
            <Txt x={at + 12} y={baseline(cy, 10)} size={10}>
              {label}
            </Txt>
          </g>
        );
      })}
    </g>
  );
}

const ROW_H = 38;
const HEAD_Y = 88;

/** The size the page draws at: the full shell, or the phone layout without a sidebar. */
export function codePageSize(compact: boolean): { W: number; H: number } {
  return compact ? { W: 500, H: 400 } : { W: 1040, H: SCREEN_H };
}

/**
 * The Code page: the repository table under the shell, drawn still; a dialog
 * screen puts its own layers in `children`.
 */
export function CodePage({
  compact,
  repos,
  label,
  className,
  children,
}: {
  compact: boolean;
  repos: Repo[];
  label: string;
  className: string;
  children?: ReactNode;
}) {
  const { W, H } = codePageSize(compact);
  const x0 = compact ? 0 : SIDEBAR_W;
  const pad = compact ? 16 : 24;
  const cols: Col[] = compact
    ? [
        { label: 'Repository', left: 4, right: 292 },
        { label: 'Proven', left: 292, right: 348, align: 'end' },
        { label: 'Last check', left: 348, right: W },
      ]
    : [
        { label: 'Repository', left: SIDEBAR_W + 12, right: 448 },
        { label: 'Requirements', left: 448, right: 712 },
        { label: 'Proven', left: 712, right: 768, align: 'end' },
        { label: 'Last check', left: 768, right: 924 },
        { label: 'Baseline', left: 924, right: W },
      ];
  const col = (name: string) => cols.find((c) => c.label === name)!;
  const failing = repos.filter((r) => r.check.tone === 'failure').length;
  return (
    <Screen width={W} height={H} label={label} className={className}>
      {!compact && <Sidebar height={H} active="Code" />}
      <PageHeader x={x0} right={W} title="Code" titleX={x0 + pad} />
      <Button x={W - pad} y={9} label="Connect repository" align="end" />
      <SearchBox x={x0 + pad} y={HEADER_H + 8} width={W - x0 - 2 * pad} placeholder="Search repositories" />
      <TableHead y={HEAD_Y} columns={cols} />
      {repos.map((row, i) => {
        const top = HEAD_Y + 28 + i * ROW_H;
        const cy = top + ROW_H / 2;
        const check = col('Last check');
        const wordEnd = cellX(check) + 14 + textWidth(row.check.word, 11.5) + 8;
        return (
          <g key={row.name}>
            <SiGithub size={13} x={cellX(col('Repository'))} y={cy - 6.5} color={ui.fg} />
            <Txt x={cellX(col('Repository')) + 20} y={baseline(cy, 12)} size={12}>
              {row.name}
            </Txt>
            {!compact && <Requirements x={cellX(col('Requirements'))} cy={cy} counts={row.counts} />}
            <Txt x={cellX(col('Proven'))} y={baseline(cy, 12)} size={12} anchor="end">
              {proven(row.counts)}
            </Txt>
            <StatusWord x={cellX(check)} cy={cy} tone={row.check.tone} word={row.check.word} />
            <Txt x={wordEnd} y={baseline(cy, compact ? 10.5 : 11)} size={compact ? 10.5 : 11} fill={ui.muted}>
              {row.check.at}
            </Txt>
            {!compact && (
              <Txt x={cellX(col('Baseline'))} y={baseline(cy, 11)} size={11} fill={ui.muted}>
                {row.baseline}
              </Txt>
            )}
            <HLine y={top + ROW_H} x0={x0} x1={W} color="#f0f0f0" />
          </g>
        );
      })}
      <Tally
        y={H - 36}
        x={x0 + pad}
        right={W}
        items={[
          { tone: 'failure', count: failing, word: 'Failing' },
          { tone: 'success', count: repos.length - failing, word: 'Passing' },
        ]}
        total={`${repos.length} total`}
      />
      {children}
    </Screen>
  );
}
