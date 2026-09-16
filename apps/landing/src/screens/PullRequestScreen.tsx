import { Button, Chip, HLine, Screen, Txt, order } from './primitives';
import { baseline, textWidth, ui } from './theme';
import { useCompact } from './use-compact';

const ACCENT = '#1f8a55';

const LABEL =
  'A GitHub pull request, "Move refunds to store credit", with three checks: ci build and ci tests passed, TrueCourse guard failed quoting the doc sentence "Refunds must return to the original payment method." against the observed "refund issued as store credit", and merging is blocked';

/** A GitHub check icon: a filled circle with a white tick or cross. */
function CheckIcon({ cx, cy, r, ok }: { cx: number; cy: number; r: number; ok: boolean }) {
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

export function PullRequestScreen() {
  const compact = useCompact();
  const W = compact ? 400 : 640;
  const H = compact ? 396 : 400;
  const pad = compact ? 12 : 20;
  const titleSize = compact ? 12.5 : 14;
  const rowSize = compact ? 11.5 : 12;
  const quoteSize = compact ? 11.5 : 12.5;
  const quoteLines = compact
    ? ['Refunds must return to the', 'original payment method.']
    : ['Refunds must return to the original payment method.'];
  const branch = compact
    ? 'northwind/billing · store-credit-refunds → main'
    : 'northwind/billing · feature/store-credit-refunds → main';

  const boxTop = 64;
  const boxLeft = pad;
  const boxRight = W - pad;
  const rowsTop = boxTop + 46;
  const rowH = 32;
  const detailTop = rowsTop + 3 * rowH;
  const nameX = boxLeft + 40;
  const quoteTop = detailTop + 30;
  const quoteH = quoteLines.length * 18 + 8;
  const sourceY = quoteTop + quoteH + 18;
  const observedCy = sourceY + 22;
  const footTop = H - pad - 46;
  const title = 'Move refunds to store credit';

  return (
    <Screen width={W} height={H} label={LABEL} className="screen-pr">
      <Txt x={pad} y={28} size={titleSize} weight={600}>
        {title}
      </Txt>
      <Txt x={pad + textWidth(title, titleSize) + 8} y={28} size={titleSize} fill={ui.muted}>
        #482
      </Txt>
      <Txt x={pad} y={47} size={10.5} fill={ui.muted}>
        {branch}
      </Txt>

      <clipPath id="pr-box">
        <rect x={boxLeft} y={boxTop} width={boxRight - boxLeft} height={H - pad - boxTop} rx={6} />
      </clipPath>
      <g clipPath="url(#pr-box)" className="sc-in pr-foot">
        <rect x={boxLeft} y={footTop} width={boxRight - boxLeft} height={H - pad - footTop} fill={ui.red} opacity={0.06} />
      </g>
      <rect x={boxLeft} y={boxTop} width={boxRight - boxLeft} height={H - pad - boxTop} rx={6} fill="none" stroke={ui.line} />

      <g className="sc-in pr-flip">
        <CheckIcon cx={boxLeft + 22} cy={boxTop + 23} r={7} ok={false} />
        <Txt x={nameX} y={boxTop + 19} size={rowSize} weight={600}>
          Some checks were not successful
        </Txt>
        <Txt x={nameX} y={boxTop + 35} size={10.5} fill={ui.muted}>
          1 failing and 2 successful checks
        </Txt>
      </g>
      <HLine y={rowsTop} x0={boxLeft} x1={boxRight} />

      {[
        { name: 'ci / build', ok: true, right: '2m 14s' },
        { name: 'ci / tests', ok: true, right: '4m 02s' },
      ].map((row, i) => {
        const cy = rowsTop + i * rowH + rowH / 2;
        return (
          <g key={row.name} className="sc-in sc-rise pr-pass" style={order(i)}>
            <CheckIcon cx={boxLeft + 22} cy={cy} r={6.5} ok={row.ok} />
            <Txt x={nameX} y={baseline(cy, rowSize)} size={rowSize} weight={500}>
              {row.name}
            </Txt>
            <Txt x={boxRight - 16} y={baseline(cy, 11)} size={11} fill={ui.muted} anchor="end">
              {row.right}
            </Txt>
            <HLine y={rowsTop + (i + 1) * rowH} x0={boxLeft} x1={boxRight} />
          </g>
        );
      })}

      {(() => {
        const cy = rowsTop + 2 * rowH + rowH / 2;
        const name = 'TrueCourse / guard';
        return (
          <g className="sc-in sc-rise pr-guard">
            <circle cx={boxLeft + 22} cy={cy} r={6.5} fill={ui.amber} className="sc-out pr-flip" />
            <g className="sc-in sc-flip pr-flip">
              <CheckIcon cx={boxLeft + 22} cy={cy} r={6.5} ok={false} />
            </g>
            <Txt x={nameX} y={baseline(cy, rowSize)} size={rowSize} weight={500}>
              {name}
            </Txt>
            <g className="sc-in pr-flip">
              <Txt x={nameX + textWidth(name, rowSize) + 10} y={baseline(cy, 11)} size={11} fill={ui.red}>
                1 failing
              </Txt>
            </g>
            <Txt x={boxRight - 16} y={baseline(cy, 11.5)} size={11.5} fill={ui.link} anchor="end">
              Details
            </Txt>
          </g>
        );
      })()}

      <rect
        className="sc-in pr-hl"
        x={nameX + 8}
        y={quoteTop + 1}
        width={Math.max(...quoteLines.map((line) => textWidth(line, quoteSize))) + 12}
        height={quoteH - 2}
        rx={3}
        fill={ui.highlight}
      />
      <g className="sc-in sc-rise pr-quote">
        <Chip x={nameX} cy={detailTop + 10} label="refund-returns-to-original-method" size={10.5} />
        <rect x={nameX} y={quoteTop} width={3} height={quoteH} rx={1.5} fill={ACCENT} />
        {quoteLines.map((line, i) => (
          <Txt key={line} x={nameX + 14} y={quoteTop + 17 + i * 18} size={quoteSize} italic>
            {line}
          </Txt>
        ))}
        <Txt x={nameX + 14} y={sourceY} size={10.5} fill={ui.muted}>
          docs/billing/refunds.md › Refunds
        </Txt>
      </g>
      <g className="sc-in sc-rise pr-observed">
        <CheckIcon cx={nameX + 6} cy={observedCy} r={5.5} ok={false} />
        <Txt x={nameX + 18} y={baseline(observedCy, 11.5)} size={11.5} weight={600} fill={ui.red}>
          Observed:
        </Txt>
        <Txt x={nameX + 18 + textWidth('Observed:', 11.5) + 6} y={baseline(observedCy, 11.5)} size={11.5}>
          refund issued as store credit
        </Txt>
      </g>

      <HLine y={footTop} x0={boxLeft} x1={boxRight} />
      <g className="sc-in pr-foot">
        <CheckIcon cx={boxLeft + 22} cy={footTop + 23} r={6.5} ok={false} />
        <Txt x={nameX} y={baseline(footTop + 23, 12)} size={12} weight={600}>
          Merging is blocked
        </Txt>
      </g>
      <Button x={boxRight - 14} y={footTop + 10} label="Merge" kind="outline" align="end" disabled />
    </Screen>
  );
}
