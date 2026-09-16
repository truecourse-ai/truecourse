import { HLine, Screen, SentenceHighlight, Txt, VLine, order } from './primitives';
import { baseline, textWidth, uiWidth, ui } from './theme';
import { useCompact } from './use-compact';

/** GitHub's light palette, as its pull request page paints it. */
const GH = {
  fg: '#1f2328',
  muted: '#59636e',
  line: '#d0d7de',
  subtle: '#f6f8fa',
  link: '#0969da',
  green: '#1a7f37',
  red: '#cf222e',
  amber: '#bf8700',
  tab: '#fd8c73',
  branch: '#ddf4ff',
  label: '#ddf4ff',
  blocked: '#fff8f8',
} as const;

/**
 * The page's type, GitHub's proportions scaled to sit with the dashboard
 * screens: the title, the body, the small print, the check rows.
 */
const T = { title: 22, body: 12, small: 10.5, row: 11.5, tab: 12 } as const;

const LABEL =
  'A GitHub pull request, "Move refunds to store credit" #482 by ada-okafor into main, with three checks: ci / build and ci / tests passed, TrueCourse / guard failed quoting the doc sentence "Refunds must return to the original payment method." against the observed "refund issued as store credit", and merging is blocked';

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

/** A check still running: GitHub's amber dot. */
function PendingIcon({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return <circle cx={cx} cy={cy} r={r} fill={GH.amber} />;
}

const BRANCH_SIZE = 10.5;

/** A branch name in its light blue capsule. */
function Branch({ x, cy, name }: { x: number; cy: number; name: string }) {
  const w = branchWidth(name);
  return (
    <g>
      <rect x={x} y={cy - 9} width={w} height={18} rx={4} fill={GH.branch} />
      <Txt x={x + 6} y={baseline(cy, BRANCH_SIZE)} size={BRANCH_SIZE} fill={GH.link}>
        {name}
      </Txt>
    </g>
  );
}

function branchWidth(name: string): number {
  return uiWidth(name, BRANCH_SIZE) + 12;
}

/** A count in a tab's grey capsule. */
function Count({ x, cy, n }: { x: number; cy: number; n: number }) {
  const w = 17;
  return (
    <g>
      <rect x={x} y={cy - 7.5} width={w} height={15} rx={7.5} fill="rgba(31, 35, 40, 0.08)" />
      <Txt x={x + w / 2} y={baseline(cy, 10)} size={10} weight={500} fill={GH.fg} anchor="middle">
        {String(n)}
      </Txt>
    </g>
  );
}

const TABS: { label: string; short: string; n: number }[] = [
  { label: 'Conversation', short: 'Conversation', n: 4 },
  { label: 'Commits', short: 'Commits', n: 3 },
  { label: 'Checks', short: 'Checks', n: 3 },
  { label: 'Files changed', short: 'Files', n: 6 },
];

const TABS_H = 36;

/** The page's tab row, Conversation open, the counts beside each label. */
function Tabs({ x, y, right, compact }: { x: number; y: number; right: number; compact: boolean }) {
  const padX = compact ? 10 : 12;
  const cy = y + 18;
  let cursor = x;
  return (
    <g>
      {TABS.map((tab, i) => {
        const label = compact ? tab.short : tab.label;
        const left = cursor;
        const labelW = uiWidth(label, T.tab, i === 0 ? 600 : 400);
        const w = padX + labelW + (compact ? 0 : 22) + padX;
        cursor += w;
        return (
          <g key={tab.label}>
            <Txt x={left + padX} y={baseline(cy, T.tab)} size={T.tab} weight={i === 0 ? 600 : 400} fill={GH.fg}>
              {label}
            </Txt>
            {!compact && <Count x={left + padX + labelW + 5} cy={cy} n={tab.n} />}
            {i === 0 && <rect x={left} y={y + TABS_H - 2} width={w} height={2} fill={GH.tab} />}
          </g>
        );
      })}
      <HLine y={y + TABS_H} x0={x} x1={right} color={GH.line} />
    </g>
  );
}

/** The pull request's opening comment: the author's line and the description. */
function Comment({ x, y, w, compact }: { x: number; y: number; w: number; compact: boolean }) {
  const headH = 30;
  const body = compact
    ? ['Refunds now land as store credit so the', 'customer can spend it right away.']
    : ['Refunds now land as store credit so the customer can spend it right away.'];
  const h = headH + 14 + body.length * 17 + 12;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill={ui.bg} stroke={GH.line} />
      <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={headH - 1} rx={6} fill={GH.subtle} />
      <rect x={x + 0.5} y={y + headH - 6} width={w - 1} height={6} fill={GH.subtle} />
      <HLine y={y + headH} x0={x} x1={x + w} color={GH.line} />
      <circle cx={x + 20} cy={y + headH / 2} r={8} fill="#d8dee4" />
      <Txt x={x + 34} y={baseline(y + headH / 2, T.small + 0.5)} size={T.small + 0.5} weight={600} fill={GH.fg}>
        ada-okafor
      </Txt>
      <Txt x={x + 34 + uiWidth('ada-okafor', T.small + 0.5, 600) + 5} y={baseline(y + headH / 2, T.small + 0.5)} size={T.small + 0.5} fill={GH.muted}>
        commented 2 hours ago
      </Txt>
      {body.map((line, i) => (
        <Txt key={line} x={x + 14} y={baseline(y + headH + 22 + i * 17, T.body)} size={T.body} fill={GH.fg}>
          {line}
        </Txt>
      ))}
    </g>
  );
}

/** The comment's height at either layout, for the page to lay out under it. */
function commentHeight(compact: boolean): number {
  return 30 + 14 + (compact ? 2 : 1) * 17 + 12;
}

/** The right column: reviewers, assignees, labels, as the page lists them. */
function Sidebar({ x, y, w }: { x: number; y: number; w: number }) {
  const rows: [string, string, boolean][] = [
    ['Reviewers', 'No reviews', false],
    ['Assignees', 'No one', false],
    ['Labels', 'billing', true],
    ['Milestone', 'No milestone', false],
  ];
  return (
    <g>
      {rows.map(([title, value, chip], i) => {
        const top = y + i * 52;
        return (
          <g key={title}>
            <Txt x={x} y={baseline(top + 8, T.small)} size={T.small} weight={600} fill={GH.muted}>
              {title}
            </Txt>
            {chip ? (
              <g>
                <rect x={x} y={top + 20} width={uiWidth(value, T.small) + 14} height={17} rx={8.5} fill={GH.label} />
                <Txt x={x + 7} y={baseline(top + 28.5, T.small)} size={T.small} weight={500} fill={GH.link}>
                  {value}
                </Txt>
              </g>
            ) : (
              <Txt x={x} y={baseline(top + 28.5, T.small)} size={T.small} fill={GH.muted}>
                {value}
              </Txt>
            )}
            <HLine y={top + 44} x0={x} x1={x + w} color={GH.line} />
          </g>
        );
      })}
    </g>
  );
}

const HEAD_H = 46;
const ROW_H = 32;
const FOOT_H = 52;
const QUOTE_LINE = 17;
const ICON_R = 6.5;

function quoteLinesOf(compact: boolean): string[] {
  return compact ? ['Refunds must return to the original', 'payment method.'] : ['Refunds must return to the original payment method.'];
}

/** The merge box's height at either layout. */
function mergeBoxHeight(compact: boolean): number {
  const quoteH = quoteLinesOf(compact).length * QUOTE_LINE + 6;
  return HEAD_H + 3 * ROW_H + 30 + quoteH + 12 + 20 + 22 + FOOT_H;
}

/**
 * The merge box, in GitHub's type: the checks header, one row per check, the
 * failing check's own summary under its row, and the merge footer.
 */
function MergeBox({ x, y, w, compact }: { x: number; y: number; w: number; compact: boolean }) {
  const iconX = x + 18;
  const nameX = x + 36;
  const right = x + w;
  const rowsTop = y + HEAD_H;
  const detailTop = rowsTop + 3 * ROW_H;
  const quoteLines = quoteLinesOf(compact);
  const quoteTop = detailTop + 30;
  const quoteH = quoteLines.length * QUOTE_LINE + 6;
  const sourceCy = quoteTop + quoteH + 12;
  const observedCy = sourceCy + 20;
  const footTop = observedCy + 22;
  const h = mergeBoxHeight(compact);
  const btnW = compact ? 76 : 142;
  const btnLabel = compact ? 'Merge' : 'Merge pull request';
  return (
    <g>
      <clipPath id="pr-box">
        <rect x={x} y={y} width={w} height={h} rx={6} />
      </clipPath>
      <g clipPath="url(#pr-box)">
        <rect x={x} y={rowsTop} width={w} height={3 * ROW_H} fill={GH.subtle} />
        <g className="sc-in pr-foot">
          <rect x={x} y={footTop} width={w} height={FOOT_H} fill={GH.blocked} />
        </g>
      </g>
      <rect x={x} y={y} width={w} height={h} rx={6} fill="none" stroke={GH.line} />

      <g className="sc-out pr-flip">
        <PendingIcon cx={iconX} cy={y + 18} r={ICON_R} />
        <Txt x={nameX} y={baseline(y + 16, T.body)} size={T.body} weight={600} fill={GH.fg}>
          Some checks haven&apos;t completed yet
        </Txt>
        <Txt x={nameX} y={baseline(y + 31, T.small)} size={T.small} fill={GH.muted}>
          1 in progress and 2 successful checks
        </Txt>
      </g>
      <g className="sc-in pr-flip">
        <CheckIcon cx={iconX} cy={y + 18} r={ICON_R} ok={false} />
        <Txt x={nameX} y={baseline(y + 16, T.body)} size={T.body} weight={600} fill={GH.fg}>
          Some checks were not successful
        </Txt>
        <Txt x={nameX} y={baseline(y + 31, T.small)} size={T.small} fill={GH.muted}>
          1 failing and 2 successful checks
        </Txt>
      </g>
      <HLine y={rowsTop} x0={x} x1={right} color={GH.line} />

      {[
        { name: 'ci / build', note: 'Successful in 2m 14s' },
        { name: 'ci / tests', note: 'Successful in 4m 02s' },
      ].map((row, i) => {
        const cy = rowsTop + i * ROW_H + ROW_H / 2;
        return (
          <g key={row.name}>
            <g className="sc-in sc-rise pr-pass" style={order(i)}>
              <CheckIcon cx={iconX} cy={cy} r={ICON_R} ok />
              <Txt x={nameX} y={baseline(cy, T.row)} size={T.row} weight={600} fill={GH.fg}>
                {row.name}
              </Txt>
              {!compact && (
                <Txt x={nameX + uiWidth(row.name, T.row, 600) + 8} y={baseline(cy, T.small)} size={T.small} fill={GH.muted}>
                  {row.note}
                </Txt>
              )}
              <Txt x={right - 14} y={baseline(cy, T.small)} size={T.small} fill={GH.link} anchor="end">
                Details
              </Txt>
            </g>
            <HLine y={rowsTop + (i + 1) * ROW_H} x0={x} x1={right} color={GH.line} />
          </g>
        );
      })}

      {(() => {
        const cy = rowsTop + 2 * ROW_H + ROW_H / 2;
        const name = 'TrueCourse / guard';
        const noteX = nameX + uiWidth(name, T.row, 600) + 8;
        return (
          <g className="sc-in sc-rise pr-guard">
            <g className="sc-out pr-flip">
              <PendingIcon cx={iconX} cy={cy} r={ICON_R} />
              {!compact && (
                <Txt x={noteX} y={baseline(cy, T.small)} size={T.small} fill={GH.muted}>
                  In progress
                </Txt>
              )}
            </g>
            <g className="sc-in sc-flip pr-flip">
              <CheckIcon cx={iconX} cy={cy} r={ICON_R} ok={false} />
            </g>
            <Txt x={nameX} y={baseline(cy, T.row)} size={T.row} weight={600} fill={GH.fg}>
              {name}
            </Txt>
            <g className="sc-in pr-flip">
              <Txt x={noteX} y={baseline(cy, T.small)} size={T.small} fill={GH.red}>
                1 failing
              </Txt>
            </g>
            <Txt x={right - 14} y={baseline(cy, T.small)} size={T.small} fill={GH.link} anchor="end">
              Details
            </Txt>
          </g>
        );
      })()}
      <HLine y={detailTop} x0={x} x1={right} color={GH.line} />

      <g className="sc-in pr-hl">
        <SentenceHighlight x={nameX + 4} y={quoteTop + 12.5} size={T.row} lines={quoteLines} lineH={QUOTE_LINE} />
      </g>
      <g className="sc-in sc-rise pr-quote">
        <rect x={nameX} y={detailTop + 8} width={textWidth('refund-returns-to-original-method', 10) + 12} height={17} rx={4} fill={GH.subtle} stroke={GH.line} />
        <Txt x={nameX + 6} y={baseline(detailTop + 16.5, 10)} size={10} weight={500} fill={GH.fg}>
          refund-returns-to-original-method
        </Txt>
        {quoteLines.map((line, i) => (
          <Txt key={line} x={nameX + 4} y={quoteTop + 12.5 + i * QUOTE_LINE} size={T.row} italic fill={GH.fg}>
            {line}
          </Txt>
        ))}
        <Txt x={nameX + 14} y={baseline(sourceCy, T.small)} size={T.small} fill={GH.muted}>
          docs/billing/refunds.md › Payment method
        </Txt>
      </g>
      <g className="sc-in sc-rise pr-observed">
        <CheckIcon cx={nameX + 6} cy={observedCy} r={5.5} ok={false} />
        <Txt x={nameX + 17} y={baseline(observedCy, T.row)} size={T.row} weight={600} fill={GH.red}>
          Observed:
        </Txt>
        <Txt x={nameX + 17 + uiWidth('Observed:', T.row, 600) + 7} y={baseline(observedCy, T.row)} size={T.row} fill={GH.fg}>
          refund issued as store credit
        </Txt>
      </g>

      <HLine y={footTop} x0={x} x1={right} color={GH.line} />
      <g className="sc-in pr-foot">
        <CheckIcon cx={iconX} cy={footTop + 19} r={ICON_R} ok={false} />
        <Txt x={nameX} y={baseline(footTop + 17, T.body)} size={T.body} weight={600} fill={GH.fg}>
          Merging is blocked
        </Txt>
        <Txt x={nameX} y={baseline(footTop + 33, T.small)} size={T.small} fill={GH.muted}>
          {compact ? 'All checks must pass.' : 'The base branch requires all checks to pass before merging.'}
        </Txt>
      </g>
      <g opacity={0.55}>
        <rect x={right - 14 - btnW} y={footTop + 13} width={btnW} height={26} rx={6} fill={GH.subtle} stroke={GH.line} />
        <Txt x={right - 14 - btnW / 2 - 7} y={baseline(footTop + 26, T.row)} size={T.row} weight={500} fill={GH.fg} anchor="middle">
          {btnLabel}
        </Txt>
        <path
          d={`M${right - 28} ${footTop + 24.5} l3.5 3.5 l3.5 -3.5`}
          fill="none"
          stroke={GH.fg}
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </g>
  );
}

export function PullRequestScreen() {
  const compact = useCompact();
  return compact ? <Compact /> : <Full />;
}

function Full() {
  const W = 1040;
  const pad = 28;
  const mainW = 660;
  const sideX = pad + mainW + 36;
  const titleY = 38;
  const stateCy = 66;
  const tabsY = 88;
  const bodyTop = tabsY + TABS_H + 20;
  const commentH = commentHeight(false);
  const boxY = bodyTop + commentH + 20;
  const H = boxY + mergeBoxHeight(false) + pad;
  const title = 'Move refunds to store credit';
  const wants = 'ada-okafor wants to merge 3 commits into';
  const wantsEnd = pad + 54 + uiWidth(wants, T.body);
  const fromX = wantsEnd + 5 + branchWidth('main') + 5;
  return (
    <Screen width={W} height={H} label={LABEL} className="screen-pr">
      <Txt x={pad} y={titleY} size={T.title} fill={GH.fg}>
        {title}
      </Txt>
      <Txt x={pad + uiWidth(title, T.title) + 7} y={titleY} size={T.title} fill={GH.muted}>
        #482
      </Txt>
      <rect x={pad} y={stateCy - 11} width={46} height={22} rx={11} fill={GH.green} />
      <Txt x={pad + 23} y={baseline(stateCy, T.row)} size={T.row} weight={500} fill="#fff" anchor="middle">
        Open
      </Txt>
      <Txt x={pad + 54} y={baseline(stateCy, T.body)} size={T.body} fill={GH.muted}>
        {wants}
      </Txt>
      <Branch x={wantsEnd + 5} cy={stateCy} name="main" />
      <Txt x={fromX} y={baseline(stateCy, T.body)} size={T.body} fill={GH.muted}>
        from
      </Txt>
      <Branch x={fromX + uiWidth('from', T.body) + 5} cy={stateCy} name="feature/store-credit-refunds" />
      <Tabs x={pad} y={tabsY} right={W - pad} compact={false} />
      <Comment x={pad} y={bodyTop} w={mainW} compact={false} />
      <VLine x={pad + 18} y0={bodyTop + commentH} y1={boxY} color={GH.line} />
      <MergeBox x={pad} y={boxY} w={mainW} compact={false} />
      <Sidebar x={sideX} y={bodyTop} w={W - pad - sideX} />
    </Screen>
  );
}

function Compact() {
  const W = 400;
  const pad = 16;
  const titleY = 32;
  const stateCy = 58;
  const tabsY = 78;
  const bodyTop = tabsY + TABS_H + 16;
  const commentH = commentHeight(true);
  const boxY = bodyTop + commentH + 16;
  const H = boxY + mergeBoxHeight(true) + pad;
  const title = 'Move refunds to store credit';
  const size = 18;
  const branchEnd = pad + 50 + branchWidth('feature/store-credit-refunds');
  return (
    <Screen width={W} height={H} label={LABEL} className="screen-pr">
      <Txt x={pad} y={titleY} size={size} fill={GH.fg}>
        {title}
      </Txt>
      <Txt x={pad + uiWidth(title, size) + 6} y={titleY} size={size} fill={GH.muted}>
        #482
      </Txt>
      <rect x={pad} y={stateCy - 10} width={42} height={20} rx={10} fill={GH.green} />
      <Txt x={pad + 21} y={baseline(stateCy, 11)} size={11} weight={500} fill="#fff" anchor="middle">
        Open
      </Txt>
      <Branch x={pad + 50} cy={stateCy} name="feature/store-credit-refunds" />
      <Txt x={branchEnd + 5} y={baseline(stateCy, 11)} size={11} fill={GH.muted}>
        into
      </Txt>
      <Branch x={branchEnd + 5 + uiWidth('into', 11) + 5} cy={stateCy} name="main" />
      <Tabs x={pad} y={tabsY} right={W - pad} compact />
      <Comment x={pad} y={bodyTop} w={W - 2 * pad} compact />
      <VLine x={pad + 18} y0={bodyTop + commentH} y1={boxY} color={GH.line} />
      <MergeBox x={pad} y={boxY} w={W - 2 * pad} compact />
    </Screen>
  );
}
