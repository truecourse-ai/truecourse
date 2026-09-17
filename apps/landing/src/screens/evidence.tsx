import { HEADER_H, HLine, StatusWord, Txt, order } from './primitives';
import { baseline, textWidth, uiWidth, ui } from './theme';

/** The flow the whole story follows, and its one web run. */
export const FLOW_ID = 'refund-returns-to-original-method';

interface Step {
  n: number;
  command: string;
  took: string;
  ok: boolean;
}

export const STEPS: Step[] = [
  { n: 1, command: 'open /billing/invoices/inv_1042', took: '1.2s', ok: true },
  { n: 2, command: 'click "Refund", fill amount 40.00', took: '0.4s', ok: true },
  { n: 3, command: 'click "Issue refund"', took: '0.9s', ok: true },
  { n: 4, command: 'expect "Refunded to Visa 4242"', took: '0.3s', ok: false },
];

export const EXPECTED = 'Refunded to Visa 4242';
export const ACTUAL = 'Issued as store credit';

export const TRANSCRIPT: string[] = [
  '12:04:18  open /billing/invoices/inv_1042  200',
  '12:04:19  click "Refund"  fill amount 40.00',
  '12:04:20  click "Issue refund"  banner "Store credit issued"',
  '12:04:21  expect "Refunded to Visa 4242"  found "Issued as store credit"',
];

/** A step's mark: the product's dot at row size, with a tick or a cross. */
export function Mark({ cx, cy, ok, r = 6 }: { cx: number; cy: number; ok: boolean; r?: number }) {
  const k = r * 0.45;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={ok ? ui.emerald : ui.red} />
      <g stroke="#fff" strokeWidth={r * 0.28} strokeLinecap="round" strokeLinejoin="round" fill="none">
        {ok ? (
          <path d={`M${cx - k} ${cy} l${k * 0.7} ${k * 0.7} l${k * 1.3} ${-k * 1.4}`} />
        ) : (
          <>
            <line x1={cx - k} y1={cy - k} x2={cx + k} y2={cy + k} />
            <line x1={cx + k} y1={cy - k} x2={cx - k} y2={cy + k} />
          </>
        )}
      </g>
    </g>
  );
}

/** The section label every panel of the test view wears above its frame. */
export function PanelLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <Txt x={x} y={baseline(y, 10)} size={10} weight={600} fill={ui.muted} upper>
      {text}
    </Txt>
  );
}

/** The flow's header: its id, its status, and the facts under it. */
export function FlowHeader({ x, y, compact }: { x: number; y: number; compact: boolean }) {
  const size = compact ? 12.5 : 13.5;
  return (
    <g>
      <Txt x={x} y={baseline(y, size)} size={size} weight={600}>
        {FLOW_ID}
      </Txt>
      <StatusWord x={x + uiWidth(FLOW_ID, size, 600) + 12} cy={y} tone="failure" word="Failed" size={11.5} />
      <Txt x={x} y={baseline(y + 18, 10.5)} size={10.5} fill={ui.muted}>
        {compact ? 'Web · northwind/billing' : 'Web · northwind/billing · 2 sections · last run 12 min ago'}
      </Txt>
    </g>
  );
}

/** The verdict band: the status word, where it broke, and the one next thing. */
export function VerdictBand({ x, y, w, compact }: { x: number; y: number; w: number; compact: boolean }) {
  const h = 40;
  const cy = y + h / 2;
  const text = compact
    ? 'Broke at step 4 · the refund landed as store credit'
    : 'Broke at step 4 · Next: return the refund to the original payment method, not store credit';
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={ui.red} opacity={0.07} />
      <rect x={x} y={y} width={3} height={h} rx={1.5} fill={ui.red} />
      <StatusWord x={x + 14} cy={cy} tone="failure" word="Failed" size={11.5} />
      <Txt x={x + 14 + 14 + uiWidth('Failed', 11.5, 500) + 12} y={baseline(cy, 11)} size={11} fill={ui.fg}>
        {text}
      </Txt>
    </g>
  );
}

type Shot = 'invoice' | 'form' | 'confirm' | 'fail';

/**
 * The Northwind billing app at thumbnail size: a browser frame around the
 * page the step left. Four pages, drawn in a 160 by 100 box and scaled.
 */
function BillingPage({ kind }: { kind: Shot }) {
  const banner = kind === 'confirm' || kind === 'fail';
  return (
    <g>
      <rect width={160} height={100} fill="#fff" />
      <rect width={160} height={12} fill="#f3f4f6" />
      <circle cx={7} cy={6} r={2} fill="#d1d5db" />
      <circle cx={13} cy={6} r={2} fill="#d1d5db" />
      <rect x={22} y={3.5} width={90} height={5} rx={2.5} fill="#e5e7eb" />
      <rect x={0} y={12} width={38} height={88} fill="#fafafa" />
      <rect x={6} y={20} width={22} height={3} rx={1.5} fill="#1a1a1a" />
      <rect x={6} y={29} width={18} height={2.5} rx={1.25} fill="#9ca3af" />
      <rect x={6} y={35} width={20} height={2.5} rx={1.25} fill="#9ca3af" />
      <rect x={6} y={41} width={14} height={2.5} rx={1.25} fill="#9ca3af" />
      <rect x={46} y={20} width={44} height={4} rx={2} fill="#1a1a1a" />
      <rect x={46} y={27} width={28} height={2.5} rx={1.25} fill="#9ca3af" />
      {kind === 'invoice' && (
        <g>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x={46} y={38 + i * 11} width={60} height={2.5} rx={1.25} fill="#6b7280" />
              <rect x={128} y={38 + i * 11} width={20} height={2.5} rx={1.25} fill="#6b7280" />
              <line x1={46} y1={45 + i * 11} x2={150} y2={45 + i * 11} stroke="#eee" />
            </g>
          ))}
          <rect x={120} y={84} width={30} height={9} rx={2} fill="#1a1a1a" />
          <rect x={126} y={87.5} width={18} height={2} rx={1} fill="#fff" />
        </g>
      )}
      {kind === 'form' && (
        <g>
          <rect x={46} y={38} width={20} height={2.5} rx={1.25} fill="#6b7280" />
          <rect x={46} y={43} width={104} height={11} rx={2} fill="#fff" stroke="#d1d5db" />
          <text x={50} y={51.5} fontSize={6} fill="#1a1a1a" fontFamily="var(--font-ui)">
            40.00
          </text>
          <rect x={46} y={60} width={24} height={2.5} rx={1.25} fill="#6b7280" />
          <rect x={46} y={65} width={104} height={11} rx={2} fill="#fff" stroke="#d1d5db" />
          <rect x={50} y={69} width={40} height={3} rx={1.5} fill="#9ca3af" />
          <rect x={112} y={84} width={38} height={9} rx={2} fill="#1a1a1a" />
          <rect x={120} y={87.5} width={22} height={2} rx={1} fill="#fff" />
        </g>
      )}
      {banner && (
        <g>
          <rect x={46} y={38} width={104} height={16} rx={2} fill={kind === 'fail' ? '#fee2e2' : '#dcefe5'} />
          <circle cx={53} cy={46} r={2.5} fill={kind === 'fail' ? ui.red : ui.emerald} />
          <text x={59} y={48} fontSize={5.5} fill="#1a1a1a" fontFamily="var(--font-ui)">
            {kind === 'fail' ? 'Issued as store credit' : 'Store credit issued'}
          </text>
          <rect x={46} y={62} width={70} height={2.5} rx={1.25} fill="#6b7280" />
          <rect x={46} y={69} width={50} height={2.5} rx={1.25} fill="#9ca3af" />
          <rect x={46} y={76} width={60} height={2.5} rx={1.25} fill="#9ca3af" />
        </g>
      )}
    </g>
  );
}

const SHOTS: { kind: Shot; label: string; failing?: boolean }[] = [
  { kind: 'invoice', label: 'Step 1' },
  { kind: 'form', label: 'Step 2' },
  { kind: 'confirm', label: 'Step 3' },
  { kind: 'fail', label: 'Step 4', failing: true },
];

/**
 * The filmstrip: the Replay tile first, then one tile per captured step, the
 * failing one marked. Each tile is a framed thumbnail of the billing app.
 */
export function Filmstrip({
  id,
  x,
  y,
  w,
  compact,
  cls,
}: {
  id: string;
  x: number;
  y: number;
  w: number;
  compact: boolean;
  cls: string;
}) {
  const tiles = compact ? [null, ...SHOTS.slice(2)] : [null, ...SHOTS];
  const gap = 12;
  const tileW = (w - gap * (tiles.length - 1)) / tiles.length;
  const tileH = tileW * 0.625;
  const scale = tileW / 160;
  return (
    <g>
      {tiles.map((tile, i) => {
        const left = x + i * (tileW + gap);
        const failing = tile?.failing;
        return (
          <g key={tile?.label ?? 'replay'} className={cls} style={order(i)}>
            <clipPath id={`${id}-tile-${i}`}>
              <rect x={left} y={y} width={tileW} height={tileH} rx={4} />
            </clipPath>
            <g clipPath={`url(#${id}-tile-${i})`}>
              <g transform={`translate(${left} ${y}) scale(${scale})`}>
                <BillingPage kind={tile?.kind ?? 'invoice'} />
              </g>
              {tile === null && (
                <g>
                  <rect x={left} y={y} width={tileW} height={tileH} fill="#000" opacity={0.42} />
                  <circle cx={left + tileW / 2} cy={y + tileH / 2} r={13} fill="rgba(255,255,255,0.92)" />
                  <path
                    d={`M${left + tileW / 2 - 4} ${y + tileH / 2 - 6} l11 6 l-11 6 z`}
                    fill="#1a1a1a"
                  />
                </g>
              )}
            </g>
            <rect
              x={left}
              y={y}
              width={tileW}
              height={tileH}
              rx={4}
              fill="none"
              stroke={failing ? ui.red : ui.line}
              strokeWidth={failing ? 1.5 : 1}
            />
            {failing && <Mark cx={left + tileW - 10} cy={y + 10} ok={false} r={6} />}
            <Txt x={left} y={baseline(y + tileH + 12, 10.5)} size={10.5} weight={500} fill={tile ? ui.fg : ui.muted}>
              {tile?.label ?? 'Replay'}
            </Txt>
            {tile === null && (
              <Txt x={left + uiWidth('Replay', 10.5) + 8} y={baseline(y + tileH + 12, 10)} size={10} fill={ui.muted}>
                session.webm
              </Txt>
            )}
          </g>
        );
      })}
    </g>
  );
}

/** The height the filmstrip takes, tiles and their labels. */
export function filmstripHeight(w: number, compact: boolean): number {
  const n = compact ? 3 : 5;
  const tileW = (w - 12 * (n - 1)) / n;
  return tileW * 0.625 + 22;
}

export const STEP_ROW = 24;
export const OPEN_ROW_EXTRA = 40;

/**
 * The steps, one dense line each: mark, number, kind, command, duration. The
 * failing step stands open with its expected and actual lines.
 */
export function Steps({
  x,
  y,
  w,
  cls,
  compact,
  opened = true,
}: {
  x: number;
  y: number;
  w: number;
  cls: string;
  compact: boolean;
  /** Whether the failing step stands open with its expected and actual lines. */
  opened?: boolean;
}) {
  const right = x + w;
  const size = compact ? 11 : 11.5;
  return (
    <g>
      {STEPS.map((step, i) => {
        const top = y + i * STEP_ROW;
        const cy = top + STEP_ROW / 2;
        const open = opened && !step.ok;
        return (
          <g key={step.n} className={cls} style={order(i)}>
            {open && <rect x={x} y={top} width={w} height={STEP_ROW + OPEN_ROW_EXTRA} rx={4} fill={ui.red} opacity={0.06} />}
            <Mark cx={x + 12} cy={cy} ok={step.ok} />
            <Txt x={x + 28} y={baseline(cy, size)} size={size} fill={ui.muted}>
              {String(step.n)}
            </Txt>
            <Txt x={x + 42} y={baseline(cy, 10)} size={10} weight={500} fill={ui.muted}>
              web
            </Txt>
            <Txt x={x + 70} y={baseline(cy, size)} size={size}>
              {step.command}
            </Txt>
            <Txt x={right - 8} y={baseline(cy, 10.5)} size={10.5} fill={ui.muted} anchor="end">
              {step.took}
            </Txt>
            {open && (
              <g>
                <Txt x={x + 42} y={baseline(top + STEP_ROW + 12, 10)} size={10} weight={600} fill={ui.muted} upper>
                  expected
                </Txt>
                <Txt x={x + 116} y={baseline(top + STEP_ROW + 12, size)} size={size}>
                  {EXPECTED}
                </Txt>
                <Txt x={x + 42} y={baseline(top + STEP_ROW + 30, 10)} size={10} weight={600} fill={ui.muted} upper>
                  actual
                </Txt>
                <Mark cx={x + 121} cy={top + STEP_ROW + 30} ok={false} r={5} />
                <Txt x={x + 132} y={baseline(top + STEP_ROW + 30, size)} size={size} fill={ui.red}>
                  {ACTUAL}
                </Txt>
              </g>
            )}
            <HLine y={top + STEP_ROW + (open ? OPEN_ROW_EXTRA : 0)} x0={x} x1={right} color="#f0f0f0" />
          </g>
        );
      })}
    </g>
  );
}

export const STEPS_H = STEPS.length * STEP_ROW + OPEN_ROW_EXTRA;

/** The claim sentences the flow proves, in order, the failed one marked. */
export const MILESTONES: { text: string; ok: boolean }[] = [
  { text: 'Partial refunds are allowed within ninety days of the charge.', ok: true },
  { text: 'Refunds must return to the original payment method.', ok: false },
];

export const MILESTONE_ROW = 22;

export function Milestones({ x, y, compact }: { x: number; y: number; compact: boolean }) {
  const size = compact ? 11 : 11.5;
  return (
    <g>
      {MILESTONES.map((m, i) => {
        const cy = y + i * MILESTONE_ROW + MILESTONE_ROW / 2;
        return (
          <g key={m.text}>
            <rect x={x} y={cy - 8} width={22} height={16} rx={3} fill={ui.soft} />
            <Txt x={x + 11} y={baseline(cy, 9.5)} size={9.5} weight={600} anchor="middle">
              {`M${i + 1}`}
            </Txt>
            <Txt x={x + 30} y={baseline(cy, size)} size={size} fill={m.ok ? ui.fg : ui.red}>
              {m.text}
            </Txt>
          </g>
        );
      })}
    </g>
  );
}

export const DRAWER_ROW = 28;

/** The record's drawers, closed: a chevron and a name, one line each. */
export function Drawers({ x, y, w, names }: { x: number; y: number; w: number; names: string[] }) {
  return (
    <g>
      {names.map((name, i) => {
        const top = y + i * DRAWER_ROW;
        const cy = top + DRAWER_ROW / 2;
        return (
          <g key={name}>
            <HLine y={top} x0={x} x1={x + w} />
            <path
              d={`M${x + 6} ${cy - 3.5} l3.5 3.5 l-3.5 3.5`}
              fill="none"
              stroke={ui.muted}
              strokeWidth={1.3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Txt x={x + 18} y={baseline(cy, 11.5)} size={11.5} weight={500}>
              {name}
            </Txt>
          </g>
        );
      })}
      <HLine y={y + names.length * DRAWER_ROW} x0={x} x1={x + w} />
    </g>
  );
}

/** The footer facts: test, flow, spec, on one line. */
export function FooterFacts({ x, y, compact }: { x: number; y: number; compact: boolean }) {
  const text = compact
    ? `Test ${FLOW_ID}.yaml · Spec docs/billing/refunds.md`
    : `Test scenarios/billing/${FLOW_ID}.yaml · Flow ${FLOW_ID} · Spec docs/billing/refunds.md › Payment method`;
  return (
    <Txt x={x} y={baseline(y, 10.5)} size={10.5} fill={ui.muted}>
      {text}
    </Txt>
  );
}

export const TRANSCRIPT_ROW = 17;

/** The transcript drawer, open: the run's own lines in the product's mono. */
export function Transcript({ x, y, w, cls, lines = TRANSCRIPT.length }: { x: number; y: number; w: number; cls: string; lines?: number }) {
  const h = lines * TRANSCRIPT_ROW + 14;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={4} fill={ui.card} stroke={ui.line} />
      {TRANSCRIPT.slice(0, lines).map((line, i) => {
        const failed = i === TRANSCRIPT.length - 1;
        return (
          <g key={line} className={cls} style={order(i)}>
            <text
              x={x + 12}
              y={baseline(y + 7 + i * TRANSCRIPT_ROW + TRANSCRIPT_ROW / 2, 10)}
              fontSize={10}
              fontFamily="var(--font-mono)"
              fill={failed ? ui.red : ui.fg}
            >
              {line}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function transcriptHeight(lines = TRANSCRIPT.length): number {
  return lines * TRANSCRIPT_ROW + 14;
}

/** The height the run view needs under the page header. */
export function runViewHeight(w: number, compact: boolean): number {
  return 100 + 40 + 18 + 10 + filmstripHeight(w, compact) + 16 + 10 + STEPS_H + 16 + 10 + transcriptHeight() + 16;
}

/**
 * The run of the flow, the one reading the product gives it: the crumb after
 * the page's title, the flow header, the verdict band, the filmstrip, the
 * steps with the failing one open, the transcript. Drawn the same in the hero
 * and in step 3; `cls` wraps it for a screen that fades it in, `id` keeps the
 * filmstrip's clip paths apart.
 */
export function RunView({
  W,
  x0,
  compact,
  id,
  cls,
}: {
  W: number;
  x0: number;
  compact: boolean;
  id: string;
  cls?: string;
}) {
  const pad = compact ? 16 : 24;
  const x = x0 + pad;
  const w = W - x0 - 2 * pad;
  const headY = HEADER_H + 24;
  const bandY = HEADER_H + 56;
  const filmLabelY = bandY + 40 + 18;
  const filmY = filmLabelY + 10;
  const stepsLabelY = filmY + filmstripHeight(w, compact) + 16;
  const stepsY = stepsLabelY + 10;
  const transcriptLabelY = stepsY + STEPS_H + 16;
  return (
    <g className={cls}>
      <rect x={x0} y={HEADER_H + 1} width={W - x0} height={800} fill={ui.bg} />
      <Txt x={x + uiWidth('Flows', 13, 600) + 12} y={baseline(HEADER_H / 2, 10.5)} size={10.5} fill={ui.muted}>
        {compact ? `\u203a  ${FLOW_ID}` : `\u203a  ${FLOW_ID}  \u203a  Run 12 min ago`}
      </Txt>
      <FlowHeader x={x} y={headY} compact={compact} />
      <VerdictBand x={x} y={bandY} w={w} compact={compact} />
      <PanelLabel x={x} y={filmLabelY} text="Filmstrip" />
      <Filmstrip id={id} x={x} y={filmY} w={w} compact={compact} cls="sc-in sc-rise rn-tile" />
      <PanelLabel x={x} y={stepsLabelY} text="Steps" />
      <Steps x={x} y={stepsY} w={w} cls="sc-in rn-step" compact={compact} />
      <PanelLabel x={x} y={transcriptLabelY} text="Transcript" />
      <Transcript x={x} y={transcriptLabelY + 10} w={w} cls="sc-in rn-line" />
    </g>
  );
}
