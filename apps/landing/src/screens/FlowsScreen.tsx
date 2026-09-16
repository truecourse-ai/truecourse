import { FLOW_ID, RunView } from './evidence';
import {
  Chip,
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
  chipWidth,
  order,
  type Col,
} from './primitives';
import { baseline, textWidth, ui, type Tone } from './theme';
import { useCompact } from './use-compact';

interface Flow {
  title: string;
  tone: Tone;
  word: string;
  drivers: string[];
  sections: number;
}

const FLOWS: Flow[] = [
  { title: FLOW_ID, tone: 'failure', word: 'Failed', drivers: ['Web'], sections: 2 },
  { title: 'invoice-totals-are-integer-cents', tone: 'success', word: 'Succeeded', drivers: ['API'], sections: 1 },
  { title: 'partial-refund-within-ninety-days', tone: 'success', word: 'Succeeded', drivers: ['API'], sections: 2 },
  { title: 'overdue-invoice-sends-reminder', tone: 'blocked', word: 'Blocked', drivers: ['API', 'Web'], sections: 1 },
  { title: 'credit-note-reverses-invoice', tone: 'success', word: 'Succeeded', drivers: ['API'], sections: 3 },
  { title: 'vat-applied-per-customer-country', tone: 'success', word: 'Succeeded', drivers: ['API'], sections: 2 },
  { title: 'trial-ends-without-a-card-on-file', tone: 'unproven', word: 'Never run', drivers: ['Web'], sections: 1 },
  { title: 'invoice-due-date-follows-terms', tone: 'success', word: 'Succeeded', drivers: ['API'], sections: 1 },
  { title: 'reminder-sent-three-days-before-due', tone: 'success', word: 'Succeeded', drivers: ['API'], sections: 2 },
  { title: 'credit-note-emails-the-customer', tone: 'success', word: 'Succeeded', drivers: ['Web'], sections: 1 },
];

const TALLY = [
  { tone: 'failure' as const, count: 1, word: 'Failed' },
  { tone: 'blocked' as const, count: 1, word: 'Blocked' },
  { tone: 'unproven' as const, count: 1, word: 'Never run' },
  { tone: 'success' as const, count: 7, word: 'Succeeded' },
];

/** The order the rows arrive in: the refund flow, the story's row, lands last. */
const ROW_ORDER: number[] = (() => {
  const story = FLOWS.findIndex((flow) => flow.title === FLOW_ID);
  const rest = FLOWS.map((_, i) => i).filter((i) => i !== story);
  const sequence = [...rest, story];
  return FLOWS.map((_, i) => sequence.indexOf(i));
})();

/** The highlight the failed row wears for a beat as it lands, and is opened on. */
function Beat({ x, top, title }: { x: number; top: number; title: string }) {
  return (
    <rect
      className="sc-beat"
      x={x - 8}
      y={top + 6}
      width={textWidth(title, 12) + 16}
      height={ROW_H - 12}
      rx={4}
      fill={ui.failTint}
    />
  );
}

const FILTER_Y = 80;
const HEAD_Y = 112;
const ROW_H = 36;
const LABEL =
  'The Flows page of the TrueCourse dashboard filtered to northwind/billing: seven flows with their status, then the run of refund-returns-to-original-method opened from its row: a replay tile and step screenshots of the Northwind billing app, the failing one marked, and the transcript ending in found Issued as store credit';

/** The filter row: the label, the one selected pill, the dashed Add filter control. */
function FilterRow({ x, right }: { x: number; right: number }) {
  const cy = FILTER_Y + 16;
  const pill = 'Repository · northwind/billing';
  const pillW = textWidth(pill, 10) + 30;
  const addX = x + 46 + pillW + 6;
  const addW = textWidth('Add filter', 10) + 30;
  return (
    <g>
      <Txt x={x} y={baseline(cy, 10)} size={10} fill={ui.muted} upper>
        Filter
      </Txt>
      <rect x={x + 46} y={cy - 10} width={pillW} height={20} rx={10} fill={ui.soft} />
      <Txt x={x + 54} y={baseline(cy, 10)} size={10} weight={500}>
        {pill}
      </Txt>
      <g stroke={ui.fg} strokeWidth={1.2} strokeLinecap="round">
        <line x1={x + 46 + pillW - 15} y1={cy - 3} x2={x + 46 + pillW - 9} y2={cy + 3} />
        <line x1={x + 46 + pillW - 9} y1={cy - 3} x2={x + 46 + pillW - 15} y2={cy + 3} />
      </g>
      <rect x={addX} y={cy - 10} width={addW} height={20} rx={10} fill="none" stroke={ui.line} strokeDasharray="3 2" />
      <g stroke={ui.muted} strokeWidth={1.2} strokeLinecap="round">
        <line x1={addX + 9} y1={cy} x2={addX + 15} y2={cy} />
        <line x1={addX + 12} y1={cy - 3} x2={addX + 12} y2={cy + 3} />
      </g>
      <Txt x={addX + 20} y={baseline(cy, 10)} size={10} weight={500} fill={ui.muted}>
        Add filter
      </Txt>
      <HLine y={HEAD_Y} x0={x - 24} x1={right} />
    </g>
  );
}

function Drivers({ x, cy, drivers }: { x: number; cy: number; drivers: string[] }) {
  let cursor = x;
  return (
    <g>
      {drivers.map((d) => {
        const at = cursor;
        cursor += chipWidth(d) + 4;
        return <Chip key={d} x={at} cy={cy} label={d} />;
      })}
    </g>
  );
}

/**
 * Step 3's story: the flows of northwind/billing land, the refund flow last
 * and lit, and its run opens in place with its step screenshots and transcript.
 */
export function FlowsScreen() {
  const compact = useCompact();
  return compact ? <Compact /> : <Full />;
}

function Full() {
  const W = 1040;
  const H = 560;
  const cols: Col[] = [
    { label: 'Flow', left: SIDEBAR_W + 12, right: 580 },
    { label: 'Status', left: 580, right: 690 },
    { label: 'Drivers', left: 690, right: 800 },
    { label: 'Repository', left: 800, right: 960 },
    { label: 'Sections', left: 960, right: W, align: 'end' },
  ];
  const [flow, status, drivers, repo, sections] = cols as [Col, Col, Col, Col, Col];
  return (
    <Screen width={W} height={H} label={LABEL} className="screen-flows">
      <Sidebar height={H} active="Flows" />
      <PageHeader x={SIDEBAR_W} right={W} title="Flows" />
      <g className="sc-out fl-leave">
        <SearchBox x={SIDEBAR_W + 24} y={HEADER_H + 8} width={W - SIDEBAR_W - 48} placeholder="Search flows" />
        <FilterRow x={SIDEBAR_W + 24} right={W} />
        <TableHead y={HEAD_Y} columns={cols} />
        {FLOWS.map((row, i) => {
          const top = HEAD_Y + 28 + i * ROW_H;
          const cy = top + ROW_H / 2;
          return (
            <g key={row.title}>
              {ROW_ORDER[i] === FLOWS.length - 1 && <Beat x={cellX(flow)} top={top} title={row.title} />}
              <g className="sc-in sc-row" style={order(ROW_ORDER[i]!)}>
                <Txt x={cellX(flow)} y={baseline(cy, 12)} size={12}>
                  {row.title}
                </Txt>
                <StatusWord x={cellX(status)} cy={cy} tone={row.tone} word={row.word} />
                <Drivers x={cellX(drivers)} cy={cy} drivers={row.drivers} />
                <Txt x={cellX(repo)} y={baseline(cy, 11)} size={11} fill={ui.muted}>
                  northwind/billing
                </Txt>
                <Txt x={cellX(sections)} y={baseline(cy, 12)} size={12} anchor="end">
                  {String(row.sections)}
                </Txt>
              </g>
              <HLine y={top + ROW_H} x0={SIDEBAR_W} x1={W} color="#f0f0f0" />
            </g>
          );
        })}
        <Tally y={H - 36} x={SIDEBAR_W + 24} right={W} items={TALLY} total="10 of 52" />
      </g>
      <RunView W={W} x0={SIDEBAR_W} compact={false} id="flows" cls="sc-in fl-run" />
    </Screen>
  );
}

function Compact() {
  const W = 500;
  const H = 560;
  const cols: Col[] = [
    { label: 'Flow', left: 4, right: 340 },
    { label: 'Status', left: 340, right: W },
  ];
  const [flow, status] = cols as [Col, Col];
  return (
    <Screen width={W} height={H} label={LABEL} className="screen-flows">
      <PageHeader x={0} right={W} title="Flows" titleX={16} />
      <g className="sc-out fl-leave">
        <SearchBox x={16} y={HEADER_H + 8} width={W - 32} placeholder="Search flows" />
        <FilterRow x={16} right={W} />
        <TableHead y={HEAD_Y} columns={cols} />
        {FLOWS.map((row, i) => {
          const top = HEAD_Y + 28 + i * ROW_H;
          const cy = top + ROW_H / 2;
          return (
            <g key={row.title}>
              {ROW_ORDER[i] === FLOWS.length - 1 && <Beat x={cellX(flow)} top={top} title={row.title} />}
              <g className="sc-in sc-row" style={order(ROW_ORDER[i]!)}>
                <Txt x={cellX(flow)} y={baseline(cy, 12)} size={12}>
                  {row.title}
                </Txt>
                <StatusWord x={cellX(status)} cy={cy} tone={row.tone} word={row.word} />
              </g>
              <HLine y={top + ROW_H} x0={0} x1={W} color="#f0f0f0" />
            </g>
          );
        })}
        <Tally y={H - 36} x={16} right={W} items={TALLY} total="10 of 52" />
      </g>
      <RunView W={W} x0={0} compact id="flows" cls="sc-in fl-run" />
    </Screen>
  );
}
