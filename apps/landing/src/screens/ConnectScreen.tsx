import { SiGithub } from 'react-icons/si';
import { CodePage, REPOS, codePageSize } from './CodeScreen';
import {
  Button,
  Chip,
  DIALOG_BODY,
  DialogFrame,
  Dim,
  HEADER_H,
  HLine,
  SearchBox,
  SIDEBAR_W,
  StatusWord,
  TableHead,
  Tally,
  Tick,
  Txt,
  buttonWidth,
  cellX,
  chipWidth,
  order,
  type Col,
} from './primitives';
import { baseline, textWidth, ui, uiWidth } from './theme';
import { useCompact } from './use-compact';

/** What the installation can see: two picked, two more on offer, two already connected. */
const OFFERED: { name: string; picked?: boolean; tag: 'private' | 'public' | 'connected' }[] = [
  { name: 'northwind/billing', picked: true, tag: 'private' },
  { name: 'northwind/customer-portal', picked: true, tag: 'private' },
  { name: 'northwind/api-gateway', tag: 'private' },
  { name: 'northwind/design-system', tag: 'public' },
  { name: 'northwind/checkout', tag: 'connected' },
  { name: 'northwind/ledger', tag: 'connected' },
];

type Surface = 'API' | 'Web' | 'CLI';
type Kind = 'Operation' | 'Screen' | 'Command';

interface Interface {
  method?: 'GET' | 'POST';
  title: string;
  hint: string;
  surface: Surface;
  kind: Kind;
  tests: number;
}

/** What setup derived from northwind/billing: its routes, its pages, its one command. */
const INTERFACES: Interface[] = [
  { method: 'POST', title: '/refunds', hint: 'Issue a refund for a charge', surface: 'API', kind: 'Operation', tests: 4 },
  { method: 'GET', title: '/refunds/:id', hint: 'Read one refund', surface: 'API', kind: 'Operation', tests: 2 },
  { method: 'GET', title: '/invoices/:id', hint: 'Read one invoice', surface: 'API', kind: 'Operation', tests: 6 },
  { method: 'POST', title: '/invoices/:id/credit-notes', hint: 'Credit an invoice', surface: 'API', kind: 'Operation', tests: 3 },
  { title: 'Refunds', hint: '/billing/refunds', surface: 'Web', kind: 'Screen', tests: 3 },
  { title: 'Invoice', hint: '/billing/invoices/:id', surface: 'Web', kind: 'Screen', tests: 2 },
  { title: 'billing reconcile', hint: 'Settle the day’s ledger', surface: 'CLI', kind: 'Command', tests: 1 },
];

/** The verb's own colour, as the Interfaces tab paints it. */
const METHOD_COLOR: Record<NonNullable<Interface['method']>, string> = {
  GET: '#2f7fb8',
  POST: '#2f8f5b',
};

const REPO_ROW = 24;
const ROW_H = 36;
const LABEL =
  'The Code page of the TrueCourse dashboard: the Connect a repository dialog picks northwind/billing and northwind/customer-portal from the northwind GitHub installation and connects them, and the page then shows the Interfaces tab of northwind/billing with the seven interfaces setup derived: four API operations, two web screens and one CLI command';

/**
 * The dialog's primary button through the connect: the label, then a moment
 * connecting, then connected with a tick. One width for all three, so nothing shifts.
 */
/** The mark (a spinner, then a tick) and its word are one centred block. */
const MARK = 10;
const MARK_GAP = 7;
const CONNECT_W = buttonWidth('Connecting') + MARK + MARK_GAP;

function ConnectAndFinish({ right, y }: { right: number; y: number }) {
  const wordW = uiWidth('Connecting', 11, 500);
  const w = CONNECT_W;
  const h = 28;
  const left = right - w;
  const cx = left + w / 2;
  const cy = y + h / 2;
  const label = (text: string, x: number) => (
    <Txt x={x} y={baseline(cy, 11)} size={11} weight={500} fill={ui.onPrimary} anchor="middle">
      {text}
    </Txt>
  );
  const wordX = cx + (MARK + MARK_GAP) / 2;
  const markX = wordX - wordW / 2 - MARK_GAP - MARK / 2;
  return (
    <g>
      <rect x={left} y={y} width={w} height={h} rx={4} fill={ui.primary} />
      <g className="sc-out sc-press">{label('Connect', cx)}</g>
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
          {label('Connecting', wordX)}
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
        {label('Connected', wordX)}
      </g>
    </g>
  );
}

function ConnectDialog({ x, y, w, pad, size }: { x: number; y: number; w: number; pad: number; size: number }) {
  const left = x + pad;
  const right = x + w - pad;
  const inner = w - 2 * pad;
  const lineCy = y + DIALOG_BODY + 8;
  const listTop = lineCy + 18;
  const footY = listTop + OFFERED.length * REPO_ROW + 16;
  const h = footY + 28 + pad - y;
  const instance = 'northwind';
  const instanceEnd = left + 18 + textWidth(instance, 11.5);
  const providerEnd = instanceEnd + 6 + textWidth('· GitHub', 10.5);
  return (
    <DialogFrame
      x={x}
      y={y}
      w={w}
      h={h}
      pad={pad}
      title="Connect a repository"
      steps={['Provider', 'Repositories', 'Confirm']}
      current={1}
    >
      <SiGithub size={12} x={left} y={lineCy - 6} color={ui.fg} />
      <Txt x={left + 18} y={baseline(lineCy, 11.5)} size={11.5}>
        {instance}
      </Txt>
      <Txt x={instanceEnd + 6} y={baseline(lineCy, 10.5)} size={10.5} fill={ui.muted}>
        · GitHub
      </Txt>
      <StatusWord x={providerEnd + 10} cy={lineCy} tone="success" word="Connected" size={10.5} />

      <rect x={left} y={listTop} width={inner} height={OFFERED.length * REPO_ROW} rx={6} fill={ui.bg} stroke={ui.line} />
      {OFFERED.map((row, i) => {
        const cy = listTop + REPO_ROW / 2 + i * REPO_ROW;
        const connected = row.tag === 'connected';
        return (
          <g key={row.name} opacity={connected ? 0.55 : 1}>
            {i > 0 && <HLine y={listTop + i * REPO_ROW} x0={left + 1} x1={left + inner - 1} color="#f0f0f0" />}
            <Tick cx={left + 16} cy={cy} on={Boolean(row.picked)} />
            <Txt x={left + 32} y={baseline(cy, size)} size={size}>
              {row.name}
            </Txt>
            <Chip x={right - 8 - chipWidth(row.tag, 9.5)} cy={cy} label={row.tag} size={9.5} />
          </g>
        );
      })}

      <ConnectAndFinish right={right} y={footY} />
      <Button x={right - CONNECT_W - 8} y={footY} h={28} label="Back" kind="outline" align="end" />
    </DialogFrame>
  );
}

/** The repository's page header: its name, and the tabs with Interfaces open. */
function RepoTabs({ x, right, compact }: { x: number; right: number; compact: boolean }) {
  const tabs = compact ? ['Runs', 'Context', 'Interfaces'] : ['Runs', 'Pipeline', 'Context', 'Interfaces', 'Dependencies', 'Settings'];
  const pad = compact ? 16 : 24;
  const tabY = HEADER_H;
  let cursor = x + pad;
  return (
    <g>
      <SiGithub size={13} x={x + pad} y={HEADER_H / 2 - 6.5} color={ui.fg} />
      <Txt x={x + pad + 20} y={baseline(HEADER_H / 2, 13)} size={13} weight={600}>
        northwind/billing
      </Txt>
      <HLine y={HEADER_H} x0={x} x1={right} />
      {tabs.map((tab) => {
        const w = textWidth(tab, 11.5) + 4;
        const left = cursor;
        const on = tab === 'Interfaces';
        cursor += w + 20;
        return (
          <g key={tab}>
            <Txt x={left + 2} y={baseline(tabY + 17, 11.5)} size={11.5} weight={on ? 600 : 400} fill={on ? ui.fg : ui.muted}>
              {tab}
            </Txt>
            {on && <rect x={left} y={tabY + 32} width={w} height={2} fill={ui.fg} />}
          </g>
        );
      })}
      <HLine y={tabY + 34} x0={x} x1={right} />
    </g>
  );
}

/** The Interfaces tab of the repository, its rows arriving one after another. */
function InterfacesPage({ compact }: { compact: boolean }) {
  const { W, H } = codePageSize(compact);
  const x0 = compact ? 0 : SIDEBAR_W;
  const pad = compact ? 16 : 24;
  const headY = HEADER_H + 34 + 42;
  const cols: Col[] = compact
    ? [
        { label: 'Interface', left: 4, right: 300 },
        { label: 'Surface', left: 300, right: 380 },
        { label: 'Used by', left: 380, right: W, align: 'end' },
      ]
    : [
        { label: 'Interface', left: SIDEBAR_W + 12, right: 592 },
        { label: 'Surface', left: 592, right: 700 },
        { label: 'Kind', left: 700, right: 820 },
        { label: 'Origin', left: 820, right: 930 },
        { label: 'Used by', left: 930, right: W, align: 'end' },
      ];
  const col = (name: string) => cols.find((c) => c.label === name);
  const rows = compact ? INTERFACES.filter((row) => row.title !== '/refunds/:id') : INTERFACES;
  const kinds = (['Operation', 'Screen', 'Command'] as Kind[]).map((kind) => ({
    tone: 'neutral' as const,
    count: rows.filter((r) => r.kind === kind).length,
    word: kind,
  }));
  return (
    <g className="sc-in sc-page">
      <rect x={x0} y={0} width={W - x0} height={H} fill={ui.bg} />
      <RepoTabs x={x0} right={W} compact={compact} />
      <SearchBox x={x0 + pad} y={HEADER_H + 34 + 8} width={W - x0 - 2 * pad} placeholder="Search interfaces" />
      <TableHead y={headY} columns={cols} />
      {rows.map((row, i) => {
        const top = headY + 28 + i * ROW_H;
        const cy = top + ROW_H / 2;
        const iface = col('Interface')!;
        const titleX = cellX(iface) + (row.method ? 52 : 0);
        return (
          <g key={row.title}>
            <g className="sc-in sc-row" style={order(i)}>
              {row.method && (
                <Txt x={cellX(iface)} y={baseline(cy - 6, 10.5)} size={10.5} weight={700} fill={METHOD_COLOR[row.method]}>
                  {row.method}
                </Txt>
              )}
              <Txt x={titleX} y={baseline(cy - 6, 12)} size={12} weight={row.kind === 'Screen' ? 400 : 500}>
                {row.title}
              </Txt>
              <Txt x={titleX} y={baseline(cy + 9, 10)} size={10} fill={ui.muted}>
                {row.hint}
              </Txt>
              <Chip x={cellX(col('Surface')!)} cy={cy} label={row.surface} size={9.5} />
              {!compact && (
                <Txt x={cellX(col('Kind')!)} y={baseline(cy, 11)} size={11} fill={ui.muted}>
                  {row.kind}
                </Txt>
              )}
              {!compact && <Chip x={cellX(col('Origin')!)} cy={cy} label="derived" size={9.5} />}
              <Txt x={cellX(col('Used by')!)} y={baseline(cy, 11)} size={11} fill={ui.muted} anchor="end">
                {`${row.tests} ${row.tests === 1 ? 'test' : 'tests'}`}
              </Txt>
            </g>
            <HLine y={top + ROW_H} x0={x0} x1={W} color="#f0f0f0" />
          </g>
        );
      })}
      <g className="sc-in sc-tally">
        <Tally y={H - 36} x={x0 + pad} right={W} items={kinds} total={`${rows.length} total`} />
      </g>
    </g>
  );
}

/**
 * Step 2's story: the connect dialog over the Code page picks two
 * repositories, connects them and goes, and the page opens northwind/billing
 * on its Interfaces tab, where the interfaces setup derived fill in.
 */
export function ConnectScreen() {
  const compact = useCompact();
  const { W, H } = codePageSize(compact);
  return (
    <CodePage compact={compact} repos={REPOS.slice(1, 4)} label={LABEL} className="screen-connect">
      <g className="sc-out sc-leave">
        <Dim width={W} height={H} />
        {compact ? (
          <ConnectDialog x={50} y={36} w={400} pad={20} size={10.5} />
        ) : (
          <ConnectDialog x={290} y={56} w={460} pad={24} size={11} />
        )}
      </g>
      <InterfacesPage compact={compact} />
    </CodePage>
  );
}
