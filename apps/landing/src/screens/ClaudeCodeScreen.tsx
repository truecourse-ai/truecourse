import { FLOW_ID } from './evidence';
import { HLine, Screen, Txt } from './primitives';
import { baseline, uiWidth, ui } from './theme';
import { useCompact } from './use-compact';

/** The terminal's palette: Claude Code in a dark terminal window. */
const T = {
  bg: '#1b1d21',
  bar: '#24272d',
  fg: '#e8ebef',
  muted: '#8b949e',
  bullet: '#5ce39a',
  minus: '#f85149',
  plus: '#3fb950',
  prompt: '#c9d1d9',
} as const;

/** GitHub's light palette, the same the pull request screen paints with. */
const GH = {
  fg: '#1f2328',
  muted: '#59636e',
  line: '#d0d7de',
  subtle: '#f6f8fa',
  link: '#0969da',
  green: '#1a7f37',
  red: '#cf222e',
  blocked: '#fff8f8',
  passed: '#f6fff8',
} as const;

type Kind = 'prompt' | 'tool' | 'result' | 'minus' | 'plus' | 'note' | 'blank';

interface Line {
  kind: Kind;
  text: string;
  /** The beat this line arrives on: lines of one beat land together. */
  beat: number;
}

const LINES: Line[] = [
  { kind: 'prompt', text: 'fix the failing TrueCourse flows', beat: 0 },
  { kind: 'blank', text: '', beat: 0 },
  { kind: 'tool', text: 'truecourse - failing_flows (MCP)', beat: 1 },
  { kind: 'result', text: `${FLOW_ID}  failed`, beat: 1 },
  { kind: 'note', text: 'expected "Refunded to Visa 4242", found "Issued as store credit"', beat: 1 },
  { kind: 'blank', text: '', beat: 1 },
  { kind: 'tool', text: 'Update(src/billing/refund.ts)', beat: 2 },
  { kind: 'result', text: 'Updated src/billing/refund.ts with 1 addition and 1 removal', beat: 2 },
  { kind: 'minus', text: '-    return issueStoreCredit(charge, amount);', beat: 2 },
  { kind: 'plus', text: '+    return refundToOriginalMethod(charge, amount);', beat: 2 },
  { kind: 'blank', text: '', beat: 2 },
  { kind: 'tool', text: 'truecourse - run_flow (MCP)', beat: 3 },
  { kind: 'result', text: `${FLOW_ID}  succeeded  4 steps  2.8s`, beat: 3 },
  { kind: 'blank', text: '', beat: 3 },
  { kind: 'tool', text: 'Refunds return to the original payment method again. Pushed to feature/store-credit-refunds.', beat: 4 },
];

const LABEL =
  'Claude Code in a terminal: asked to fix the failing TrueCourse flows, it reads refund-returns-to-original-method over MCP, edits src/billing/refund.ts to refund to the original payment method, runs the flow again and it succeeds; beside it the pull request check TrueCourse / guard turns green and merging is unblocked';

/** A GitHub check icon: a filled circle with a white tick or cross. */
function CheckIcon({ cx, cy, r, ok }: { cx: number; cy: number; r: number; ok: boolean }) {
  const k = r * 0.45;
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={ok ? GH.green : GH.red} />
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

const LINE_H = 18;

/** The terminal window: a title bar, then the session, one beat at a time. */
function Terminal({ x, y, w, h, size, chars }: { x: number; y: number; w: number; h: number; size: number; chars: number }) {
  const pad = 16;
  const barH = 30;
  const rows: { line: Line; text: string; first: boolean }[] = [];
  for (const line of LINES) {
    const indent = line.kind === 'note' ? 4 : line.kind === 'result' ? 4 : 0;
    const budget = chars - indent;
    const words = line.text.split(' ');
    let current = '';
    let first = true;
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length > budget && current) {
        rows.push({ line, text: current, first });
        current = word;
        first = false;
      } else {
        current = next;
      }
    }
    rows.push({ line, text: current, first });
  }
  const color = (kind: Kind) =>
    kind === 'minus' ? T.minus : kind === 'plus' ? T.plus : kind === 'result' || kind === 'note' ? T.muted : T.fg;
  const lead = (kind: Kind, first: boolean) => {
    if (!first) return { glyph: '', dx: kind === 'prompt' || kind === 'tool' ? 12 : 26 };
    if (kind === 'prompt') return { glyph: '>', dx: 12 };
    if (kind === 'tool') return { glyph: '⏺', dx: 12 };
    if (kind === 'result') return { glyph: '⎿', dx: 26 };
    return { glyph: '', dx: 26 };
  };
  return (
    <g>
      <clipPath id="cc-term">
        <rect x={x} y={y} width={w} height={h} rx={8} />
      </clipPath>
      <g clipPath="url(#cc-term)">
        <rect x={x} y={y} width={w} height={h} fill={T.bg} />
        <rect x={x} y={y} width={w} height={barH} fill={T.bar} />
      </g>
      <circle cx={x + 16} cy={y + barH / 2} r={5} fill="#ff5f57" />
      <circle cx={x + 32} cy={y + barH / 2} r={5} fill="#febc2e" />
      <circle cx={x + 48} cy={y + barH / 2} r={5} fill="#28c840" />
      <text x={x + w / 2} y={baseline(y + barH / 2, 11)} fontSize={11} fill={T.muted} fontFamily="var(--font-mono)" textAnchor="middle">
        claude · northwind/billing
      </text>
      {rows.map((row, i) => {
        const cy = y + barH + pad + i * LINE_H + LINE_H / 2;
        const { glyph, dx } = lead(row.line.kind, row.first);
        const textX = x + pad + dx + (row.line.kind === 'note' && row.first ? 0 : 0);
        return (
          <g key={`${i}-${row.text}`} className={`sc-in cc-beat-${row.line.beat}`}>
            {glyph && (
              <text
                x={x + pad}
                y={baseline(cy, size)}
                fontSize={size}
                fill={row.line.kind === 'tool' ? T.bullet : row.line.kind === 'prompt' ? T.prompt : T.muted}
                fontFamily="var(--font-mono)"
              >
                {glyph}
              </text>
            )}
            <text x={textX} y={baseline(cy, size)} fontSize={size} fill={color(row.line.kind)} fontFamily="var(--font-mono)">
              {row.text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

const HEAD_H = 46;
const ROW_H = 30;
const FOOT_H = 50;
const ICON_R = 6.5;

/** The merge box's height, for the screen to size itself around. */
const MERGE_BOX_H = HEAD_H + 3 * ROW_H + FOOT_H;

/** The pull request's merge box, the guard check turning green and the merge opening up. */
function MergeBox({ x, y, w }: { x: number; y: number; w: number }) {
  const iconX = x + 18;
  const nameX = x + 36;
  const right = x + w;
  const rowsTop = y + HEAD_H;
  const footTop = rowsTop + 3 * ROW_H;
  const guard = 'TrueCourse / guard';
  const noteX = nameX + uiWidth(guard, 11.5, 600) + 8;
  const btnW = 128;
  return (
    <g>
      <Txt x={x} y={baseline(y - 16, 10.5)} size={10.5} fill={GH.muted}>
        Move refunds to store credit #482
      </Txt>
      <clipPath id="cc-box">
        <rect x={x} y={y} width={w} height={MERGE_BOX_H} rx={6} />
      </clipPath>
      <g clipPath="url(#cc-box)">
        <rect x={x} y={rowsTop} width={w} height={3 * ROW_H} fill={GH.subtle} />
        <g className="sc-out cc-flip">
          <rect x={x} y={footTop} width={w} height={FOOT_H} fill={GH.blocked} />
        </g>
        <g className="sc-in cc-flip">
          <rect x={x} y={footTop} width={w} height={FOOT_H} fill={GH.passed} />
        </g>
      </g>
      <rect x={x} y={y} width={w} height={MERGE_BOX_H} rx={6} fill="none" stroke={GH.line} />

      <g className="sc-out cc-flip">
        <CheckIcon cx={iconX} cy={y + 18} r={ICON_R} ok={false} />
        <Txt x={nameX} y={baseline(y + 16, 12)} size={12} weight={600} fill={GH.fg}>
          Some checks were not successful
        </Txt>
        <Txt x={nameX} y={baseline(y + 31, 10.5)} size={10.5} fill={GH.muted}>
          1 failing and 2 successful checks
        </Txt>
      </g>
      <g className="sc-in cc-flip">
        <CheckIcon cx={iconX} cy={y + 18} r={ICON_R} ok />
        <Txt x={nameX} y={baseline(y + 16, 12)} size={12} weight={600} fill={GH.fg}>
          All checks have passed
        </Txt>
        <Txt x={nameX} y={baseline(y + 31, 10.5)} size={10.5} fill={GH.muted}>
          3 successful checks
        </Txt>
      </g>
      <HLine y={rowsTop} x0={x} x1={right} color={GH.line} />

      {['ci / build', 'ci / tests'].map((name, i) => {
        const cy = rowsTop + i * ROW_H + ROW_H / 2;
        return (
          <g key={name}>
            <CheckIcon cx={iconX} cy={cy} r={ICON_R} ok />
            <Txt x={nameX} y={baseline(cy, 11.5)} size={11.5} weight={600} fill={GH.fg}>
              {name}
            </Txt>
            <Txt x={right - 14} y={baseline(cy, 10.5)} size={10.5} fill={GH.link} anchor="end">
              Details
            </Txt>
            <HLine y={rowsTop + (i + 1) * ROW_H} x0={x} x1={right} color={GH.line} />
          </g>
        );
      })}
      {(() => {
        const cy = rowsTop + 2 * ROW_H + ROW_H / 2;
        return (
          <g>
            <g className="sc-out cc-flip">
              <CheckIcon cx={iconX} cy={cy} r={ICON_R} ok={false} />
              <Txt x={noteX} y={baseline(cy, 10.5)} size={10.5} fill={GH.red}>
                1 failing
              </Txt>
            </g>
            <g className="sc-in sc-flip cc-flip">
              <CheckIcon cx={iconX} cy={cy} r={ICON_R} ok />
            </g>
            <g className="sc-in cc-flip">
              <Txt x={noteX} y={baseline(cy, 10.5)} size={10.5} fill={GH.muted}>
                Successful in 2m 48s
              </Txt>
            </g>
            <Txt x={nameX} y={baseline(cy, 11.5)} size={11.5} weight={600} fill={GH.fg}>
              {guard}
            </Txt>
            <Txt x={right - 14} y={baseline(cy, 10.5)} size={10.5} fill={GH.link} anchor="end">
              Details
            </Txt>
          </g>
        );
      })()}
      <HLine y={footTop} x0={x} x1={right} color={GH.line} />

      <g className="sc-out cc-flip">
        <CheckIcon cx={iconX} cy={footTop + 18} r={ICON_R} ok={false} />
        <Txt x={nameX} y={baseline(footTop + 16, 12)} size={12} weight={600} fill={GH.fg}>
          Merging is blocked
        </Txt>
        <Txt x={nameX} y={baseline(footTop + 32, 10.5)} size={10.5} fill={GH.muted}>
          All checks must pass.
        </Txt>
        <g opacity={0.55}>
          <rect x={right - 14 - btnW} y={footTop + 12} width={btnW} height={26} rx={6} fill={GH.subtle} stroke={GH.line} />
          <Txt x={right - 14 - btnW / 2} y={baseline(footTop + 25, 11.5)} size={11.5} weight={500} fill={GH.fg} anchor="middle">
            Merge pull request
          </Txt>
        </g>
      </g>
      <g className="sc-in cc-flip">
        <CheckIcon cx={iconX} cy={footTop + 18} r={ICON_R} ok />
        <Txt x={nameX} y={baseline(footTop + 16, 12)} size={12} weight={600} fill={GH.fg}>
          Ready to merge
        </Txt>
        <Txt x={nameX} y={baseline(footTop + 32, 10.5)} size={10.5} fill={GH.muted}>
          No conflicts with main.
        </Txt>
        <rect x={right - 14 - btnW} y={footTop + 12} width={btnW} height={26} rx={6} fill={GH.green} />
        <Txt x={right - 14 - btnW / 2} y={baseline(footTop + 25, 11.5)} size={11.5} weight={500} fill="#fff" anchor="middle">
          Merge pull request
        </Txt>
      </g>
    </g>
  );
}

/** Step 5: Claude Code fixes the failing flow over MCP, and the check goes green. */
export function ClaudeCodeScreen() {
  const compact = useCompact();
  if (compact) {
    const W = 400;
    const termH = 30 + 32 + 21 * LINE_H;
    const H = termH + 40 + MERGE_BOX_H + 16;
    return (
      <Screen width={W} height={H} label={LABEL} className="screen-cc">
        <rect width={W} height={H} fill={ui.soft} />
        <Terminal x={0} y={0} w={W} h={termH} size={10} chars={54} />
        <rect x={0} y={termH + 16} width={W} height={H - termH - 16} fill={ui.bg} />
        <MergeBox x={12} y={termH + 40} w={W - 24} />
      </Screen>
    );
  }
  const W = 1040;
  // Shorter than the shared canvas on purpose: the merge panel beside the
  // terminal floats in white if this page is stretched to match the others.
  const H = 380;
  const termW = 600;
  return (
    <Screen width={W} height={H} label={LABEL} className="screen-cc">
      <rect width={W} height={H} fill={ui.soft} />
      <Terminal x={0} y={0} w={termW} h={H} size={11} chars={76} />
      <rect x={termW} y={0} width={W - termW} height={H} fill={ui.bg} />
      <MergeBox x={termW + 32} y={(H - MERGE_BOX_H) / 2 + 8} w={W - termW - 64} />
    </Screen>
  );
}
