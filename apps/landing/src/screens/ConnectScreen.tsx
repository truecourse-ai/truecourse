import { SiGithub } from 'react-icons/si';
import { CodePage, REPOS, codePageSize } from './CodeScreen';
import {
  Button,
  Chip,
  DIALOG_BODY,
  DialogFrame,
  Dim,
  HLine,
  StatusWord,
  Tick,
  Txt,
  buttonWidth,
  chipWidth,
} from './primitives';
import { baseline, textWidth, ui } from './theme';
import { useCompact } from './use-compact';

/** What the installation can see: two picked, two more on offer, two already connected. */
const OFFERED: { name: string; picked?: boolean; tag: 'private' | 'public' | 'connected' }[] = [
  { name: 'northwind/customer-portal', picked: true, tag: 'private' },
  { name: 'northwind/api-gateway', picked: true, tag: 'private' },
  { name: 'northwind/mobile', tag: 'private' },
  { name: 'northwind/design-system', tag: 'public' },
  { name: 'northwind/billing', tag: 'connected' },
  { name: 'northwind/checkout', tag: 'connected' },
];

const REPO_ROW = 24;
const LABEL =
  'The Code page of the TrueCourse dashboard with the Connect a repository dialog on its Repositories step: the northwind GitHub installation is connected, and of the six repositories it can see, customer-portal and api-gateway are ticked';

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
      steps={['Provider', 'Repositories', 'Context', 'Confirm']}
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

      <Button x={right} y={footY} h={28} label="Continue" align="end" />
      <Button x={right - buttonWidth('Continue') - 8} y={footY} h={28} label="Back" kind="outline" align="end" />
    </DialogFrame>
  );
}

/** The Code page with the connect dialog over it: two repositories about to join the four already on it. */
export function ConnectScreen() {
  const compact = useCompact();
  const { W, H } = codePageSize(compact);
  return (
    <CodePage compact={compact} repos={REPOS.slice(0, 4)} label={LABEL} className="screen-connect">
      <Dim width={W} height={H} />
      {compact ? (
        <ConnectDialog x={50} y={36} w={400} pad={20} size={10.5} />
      ) : (
        <ConnectDialog x={290} y={56} w={460} pad={24} size={11} />
      )}
    </CodePage>
  );
}
