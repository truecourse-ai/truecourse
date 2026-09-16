import type { ReactNode } from 'react';
import { GitBranch, Globe, type LucideIcon } from 'lucide-react';
import type { IconType } from 'react-icons';
import { SiConfluence, SiGoogledrive, SiJira, SiLinear, SiNotion, SiSlack } from 'react-icons/si';
import { OneDriveIcon } from '@/components/OneDriveIcon';
import {
  Button,
  DIALOG_BODY,
  DialogFrame,
  Dim,
  HEADER_H,
  HLine,
  PageHeader,
  Screen,
  SearchBox,
  Sidebar,
  SIDEBAR_W,
  TableHead,
  Tally,
  Txt,
  VLine,
  buttonWidth,
  cellX,
  type Col,
} from './primitives';
import { baseline, textWidth, ui } from './theme';
import { useCompact } from './use-compact';

interface IconAt {
  x: number;
  y: number;
  size: number;
}

const outline = (Icon: LucideIcon) => (at: IconAt) => (
  <Icon x={at.x} y={at.y} width={at.size} height={at.size} color={ui.muted} strokeWidth={1.75} />
);
const brand = (Icon: IconType) => (at: IconAt) => <Icon x={at.x} y={at.y} size={at.size} color={ui.muted} />;

/** The kinds a source can be, as the product's add dialog lists them. */
const KINDS: { label: string; icon: (at: IconAt) => ReactNode }[] = [
  { label: 'Repository', icon: outline(GitBranch) },
  { label: 'Documentation site', icon: outline(Globe) },
  { label: 'Jira', icon: brand(SiJira) },
  { label: 'Confluence', icon: brand(SiConfluence) },
  { label: 'Google Drive', icon: brand(SiGoogledrive) },
  { label: 'OneDrive', icon: (at) => <OneDriveIcon x={at.x} y={at.y} size={at.size} color={ui.muted} /> },
  { label: 'Notion', icon: brand(SiNotion) },
  { label: 'Linear', icon: brand(SiLinear) },
  { label: 'Slack', icon: brand(SiSlack) },
];

const DOCS: { title: string; source: string }[] = [
  { title: 'Refunds', source: 'Northwind Docs' },
  { title: 'Invoices and credit notes', source: 'Northwind Docs' },
  { title: 'Billing cycles', source: 'Northwind Docs' },
  { title: 'Tax by customer country', source: 'Northwind Docs' },
  { title: 'Store credit', source: 'northwind/billing' },
  { title: 'Trials', source: 'northwind/checkout' },
];

/** The one sentence the story follows, as the reader pane wraps it. */
const REQUIREMENT = ['Refunds must return to the original', 'payment method.'];

const ROW_H = 38;
const HEAD_Y = 88;
const KIND_ROW = 24;
const LABEL =
  'The Context page of the TrueCourse dashboard with the document "Refunds" open beside the document list, a source just added and synced through the Add context dialog (Repository, Documentation site, Jira, Confluence, Google Drive, OneDrive, Notion, Linear, Slack), and the sentence "Refunds must return to the original payment method." highlighted';

/** The workspace's two actions, right-aligned in the page header. */
function HeaderActions({ right }: { right: number }) {
  const addW = buttonWidth('Add context');
  return (
    <g>
      <Button x={right} y={9} label="Add context" align="end" />
      <Button x={right - addW - 8} y={9} label="Scan" kind="outline" align="end" />
    </g>
  );
}

/**
 * The dialog's primary button through the connect: the label, then a moment
 * syncing, then synced with a tick. One width for all three, so nothing shifts.
 */
function AddAndSync({ right, y }: { right: number; y: number }) {
  const w = buttonWidth('Add and sync');
  const h = 28;
  const left = right - w;
  const cx = left + w / 2;
  const cy = y + h / 2;
  const label = (text: string, x: number) => (
    <Txt x={x} y={baseline(cy, 11)} size={11} weight={500} fill={ui.onPrimary} anchor="middle">
      {text}
    </Txt>
  );
  const markX = cx - 24;
  return (
    <g>
      <rect x={left} y={y} width={w} height={h} rx={4} fill={ui.primary} />
      <g className="sc-out sc-press">{label('Add and sync', cx)}</g>
      <g className="sc-out sc-done">
        <g className="sc-in sc-press">
          <circle
            className="sc-spin"
            cx={markX}
            cy={cy}
            r={5}
            fill="none"
            stroke={ui.onPrimary}
            strokeWidth={1.6}
            strokeDasharray="20 12"
            strokeLinecap="round"
          />
          {label('Syncing', cx + 8)}
        </g>
      </g>
      <g className="sc-in sc-done">
        <path
          d={`M${markX - 4} ${cy} l3 3 l6 -6`}
          fill="none"
          stroke={ui.onPrimary}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {label('Synced', cx + 8)}
      </g>
    </g>
  );
}

/** Add context on its Source step: every kind the workspace can read, and the button that adds one. */
function AddContextDialog({ x, y, w, pad }: { x: number; y: number; w: number; pad: number }) {
  const left = x + pad;
  const right = x + w - pad;
  const inner = w - 2 * pad;
  const listTop = y + DIALOG_BODY;
  const footY = listTop + KINDS.length * KIND_ROW + 16;
  const h = footY + 28 + pad - y;
  return (
    <DialogFrame x={x} y={y} w={w} h={h} pad={pad} title="Add context" steps={['Source', 'Scope']} current={0}>
      <rect x={left} y={listTop} width={inner} height={KINDS.length * KIND_ROW} rx={6} fill={ui.bg} stroke={ui.line} />
      {KINDS.map((kind, i) => {
        const cy = listTop + KIND_ROW / 2 + i * KIND_ROW;
        return (
          <g key={kind.label}>
            {i > 0 && <HLine y={listTop + i * KIND_ROW} x0={left + 1} x1={left + inner - 1} color="#f0f0f0" />}
            {kind.icon({ x: left + 11, y: cy - 6, size: 12 })}
            <Txt x={left + 32} y={baseline(cy, 11.5)} size={11.5}>
              {kind.label}
            </Txt>
          </g>
        );
      })}
      <AddAndSync right={right} y={footY} />
      <Button x={right - buttonWidth('Add and sync') - 8} y={footY} h={28} label="Back" kind="outline" align="end" />
    </DialogFrame>
  );
}

/** The two lines, drawn plain in the page and lit once the dialog has gone. */
function Requirement({
  x,
  y,
  size,
  lineH,
  lit,
}: {
  x: number;
  y: number;
  size: number;
  lineH: number;
  lit: boolean;
}) {
  const w = textWidth(REQUIREMENT[0]!, size) + 12;
  const h = (REQUIREMENT.length - 1) * lineH + size + 10;
  return (
    <g className={lit ? 'sc-in sc-hl' : undefined}>
      {lit && <rect x={x - 6} y={y - size - 1} width={w} height={h} rx={4} fill={ui.highlight} />}
      {REQUIREMENT.map((line, i) => (
        <Txt key={line} x={x} y={y + i * lineH} size={size}>
          {line}
        </Txt>
      ))}
    </g>
  );
}

export function ContextScreen() {
  const compact = useCompact();
  return compact ? <Compact /> : <Full />;
}

function Full() {
  const W = 1040;
  const H = 440;
  const MENU_W = 176;
  const content = SIDEBAR_W + MENU_W;
  const READER_X = 752;
  const cols: Col[] = [
    { label: 'Document', left: content + 4, right: 604 },
    { label: 'Source', left: 604, right: READER_X },
  ];
  const [doc, src] = cols as [Col, Col];
  const menu = ['Sources', 'Documents', 'Conflicts'];
  const textX = READER_X + 16;
  const bodySize = 11;
  const lineH = 17;
  const requirementY = 195;
  return (
    <Screen width={W} height={H} label={LABEL} className="screen-context">
      <Sidebar height={H} active="Context" />
      <PageHeader x={SIDEBAR_W} right={W} title="Context" />
      <HeaderActions right={W - 24} />

      <rect x={SIDEBAR_W} y={HEADER_H} width={MENU_W} height={H - HEADER_H} fill={ui.card} />
      <VLine x={content} y0={HEADER_H} y1={H} />
      {menu.map((item, i) => {
        const top = HEADER_H + 12 + i * 30;
        const on = i === 1;
        return (
          <g key={item}>
            {on && <rect x={SIDEBAR_W + 8} y={top} width={MENU_W - 16} height={28} rx={6} fill={ui.activeRow} />}
            <Txt x={SIDEBAR_W + 18} y={baseline(top + 14, 13)} size={13} weight={500} fill={on ? ui.fg : ui.muted}>
              {item}
            </Txt>
          </g>
        );
      })}

      <SearchBox x={content + 12} y={HEADER_H + 8} width={READER_X - content - 24} placeholder="Search documents" />
      <TableHead y={HEAD_Y} columns={cols} />
      {DOCS.map((row, i) => {
        const top = HEAD_Y + 28 + i * ROW_H;
        const cy = top + ROW_H / 2;
        return (
          <g key={row.title}>
            {i === 0 && <rect x={content} y={top} width={READER_X - content} height={ROW_H} fill={ui.card} />}
            <Txt x={cellX(doc)} y={baseline(cy, 12)} size={12}>
              {row.title}
            </Txt>
            <Txt x={cellX(src)} y={baseline(cy, 11)} size={11} fill={ui.muted}>
              {row.source}
            </Txt>
            <HLine y={top + ROW_H} x0={content} x1={READER_X} color="#f0f0f0" />
          </g>
        );
      })}
      <Tally y={H - 36} x={content + 24} right={READER_X} items={[]} total="171 total" />

      <VLine x={READER_X} y0={HEADER_H} y1={H} />
      <Txt x={textX} y={baseline(HEADER_H + 22, 12.5)} size={12.5} weight={600}>
        Refunds
      </Txt>
      <g stroke={ui.muted} strokeWidth={1.4} strokeLinecap="round">
        <line x1={W - 24} y1={HEADER_H + 18} x2={W - 16} y2={HEADER_H + 26} />
        <line x1={W - 16} y1={HEADER_H + 18} x2={W - 24} y2={HEADER_H + 26} />
      </g>
      <Txt x={textX} y={HEADER_H + 40} size={10} fill={ui.muted}>
        Northwind Docs · docs/billing/refunds.md
      </Txt>
      <HLine y={HEADER_H + 52} x0={READER_X} x1={W} />
      <Txt x={textX} y={126} size={13} weight={700}>
        Refunds
      </Txt>
      <Txt x={textX} y={152} size={bodySize}>
        Partial refunds are allowed within
      </Txt>
      <Txt x={textX} y={169} size={bodySize}>
        ninety days of the charge.
      </Txt>
      <Requirement x={textX} y={requirementY} size={bodySize} lineH={lineH} lit={false} />
      <Txt x={textX} y={238} size={bodySize}>
        A refunded invoice keeps its number
      </Txt>
      <Txt x={textX} y={255} size={bodySize}>
        and receives a credit note.
      </Txt>
      <Txt x={textX} y={281} size={bodySize}>
        Store credit is offered only when the
      </Txt>
      <Txt x={textX} y={298} size={bodySize}>
        customer asks for it.
      </Txt>

      <g className="sc-out sc-leave">
        <Dim width={W} height={H} />
        <AddContextDialog x={290} y={56} w={460} pad={24} />
      </g>
      <Requirement x={textX} y={requirementY} size={bodySize} lineH={lineH} lit />
    </Screen>
  );
}

function Compact() {
  const W = 500;
  const H = 480;
  const textX = 16;
  const bodySize = 11.5;
  const requirementY = 372;
  return (
    <Screen width={W} height={H} label={LABEL} className="screen-context">
      <PageHeader x={0} right={W} title="Context" titleX={16} />
      <HeaderActions right={W - 16} />
      <Txt x={textX} y={baseline(HEADER_H + 22, 12.5)} size={12.5} weight={600}>
        Refunds
      </Txt>
      <Txt x={textX} y={HEADER_H + 40} size={10} fill={ui.muted}>
        Northwind Docs · docs/billing/refunds.md
      </Txt>
      <HLine y={HEADER_H + 52} x0={0} x1={W} />
      <Txt x={textX} y={124} size={13} weight={700}>
        Refunds
      </Txt>
      <Txt x={textX} y={152} size={bodySize}>
        Partial refunds are allowed within ninety days of the
      </Txt>
      <Txt x={textX} y={172} size={bodySize}>
        charge, in the currency the invoice was issued in.
      </Txt>
      <Txt x={textX} y={200} size={bodySize}>
        A refund is approved by the account owner and issued
      </Txt>
      <Txt x={textX} y={220} size={bodySize}>
        within five business days of the request.
      </Txt>
      <Txt x={textX} y={248} size={bodySize}>
        Refunds above five hundred dollars need a second
      </Txt>
      <Txt x={textX} y={268} size={bodySize}>
        approval from finance.
      </Txt>
      <CompactRequirement x={textX} y={requirementY} size={bodySize} lit={false} />
      <Txt x={textX} y={400} size={bodySize}>
        A refunded invoice keeps its number and receives a
      </Txt>
      <Txt x={textX} y={420} size={bodySize}>
        credit note.
      </Txt>

      <g className="sc-out sc-leave">
        <Dim width={W} height={H} />
        <AddContextDialog x={50} y={20} w={400} pad={20} />
      </g>
      <CompactRequirement x={textX} y={requirementY} size={bodySize} lit />
    </Screen>
  );
}

/** The sentence on one line, as the phone layout has room for it. */
function CompactRequirement({ x, y, size, lit }: { x: number; y: number; size: number; lit: boolean }) {
  const line = REQUIREMENT.join(' ');
  return (
    <g className={lit ? 'sc-in sc-hl' : undefined}>
      {lit && <rect x={x - 6} y={y - size - 1} width={textWidth(line, size) + 12} height={size + 10} rx={4} fill={ui.highlight} />}
      <Txt x={x} y={y} size={size}>
        {line}
      </Txt>
    </g>
  );
}
