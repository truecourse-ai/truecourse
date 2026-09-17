import type { CSSProperties, ReactNode } from 'react';
import {
  Bell,
  GitBranch,
  Home,
  Layers,
  MousePointer2,
  PanelLeftClose,
  Route,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { TONE, UI_ASCENT, UI_DESCENT, baseline, textWidth, uiWidth, ui, type Tone } from './theme';

export function Screen({
  width,
  height,
  label,
  className,
  children,
}: {
  width: number;
  height: number;
  label: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      style={{ fontFamily: 'var(--font-ui)' }}
    >
      <rect width={width} height={height} fill={ui.bg} />
      {children}
    </svg>
  );
}

export function Txt({
  x,
  y,
  size = 12,
  fill = ui.fg,
  weight = 400,
  anchor = 'start',
  italic = false,
  upper = false,
  children,
}: {
  x: number;
  y: number;
  size?: number;
  fill?: string;
  weight?: 400 | 500 | 600 | 700;
  anchor?: 'start' | 'middle' | 'end';
  italic?: boolean;
  upper?: boolean;
  children: string;
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fill={fill}
      fontWeight={weight}
      textAnchor={anchor}
      fontStyle={italic ? 'italic' : undefined}
      letterSpacing={upper ? '0.06em' : undefined}
    >
      {upper ? children.toUpperCase() : children}
    </text>
  );
}

export function HLine({ y, x0, x1, color = ui.line }: { y: number; x0: number; x1: number; color?: string }) {
  return <line x1={x0} x2={x1} y1={y} y2={y} stroke={color} strokeWidth={1} />;
}

export function VLine({ x, y0, y1, color = ui.line }: { x: number; y0: number; y1: number; color?: string }) {
  return <line x1={x} x2={x} y1={y0} y2={y1} stroke={color} strokeWidth={1} />;
}

/** The stagger index an animated element reads as `--i`. */
export function order(i: number): CSSProperties {
  return { ['--i' as string]: i };
}

/** The status idiom: a coloured dot and a full-contrast word. */
export function StatusWord({
  x,
  cy,
  tone,
  word,
  size = 11.5,
}: {
  x: number;
  cy: number;
  tone: Tone;
  word: string;
  size?: number;
}) {
  return (
    <g>
      <circle cx={x + 4} cy={cy} r={4} fill={TONE[tone]} />
      <Txt x={x + 14} y={baseline(cy, size)} size={size} weight={500}>
        {word}
      </Txt>
    </g>
  );
}

export function statusWordWidth(word: string, size = 11.5): number {
  return 14 + textWidth(word, size);
}

export function buttonWidth(label: string, size = 11): number {
  return textWidth(label, size) + 22;
}

export function Button({
  x,
  y,
  label,
  kind = 'primary',
  size = 11,
  h = 26,
  align = 'start',
  disabled = false,
}: {
  x: number;
  y: number;
  label: string;
  kind?: 'primary' | 'outline';
  size?: number;
  h?: number;
  align?: 'start' | 'end';
  disabled?: boolean;
}) {
  const w = buttonWidth(label, size);
  const left = align === 'end' ? x - w : x;
  const primary = kind === 'primary';
  return (
    <g opacity={disabled ? 0.45 : 1}>
      <rect
        x={left}
        y={y}
        width={w}
        height={h}
        rx={4}
        fill={primary ? ui.primary : ui.bg}
        stroke={primary ? ui.primary : ui.line}
      />
      <Txt
        x={left + w / 2}
        y={baseline(y + h / 2, size)}
        size={size}
        weight={500}
        fill={primary ? ui.onPrimary : ui.fg}
        anchor="middle"
      >
        {label}
      </Txt>
    </g>
  );
}

/**
 * The requirement the story follows, lit where it is quoted. The text never
 * moves: the box grows outward from it, 8px left of the first character and
 * right of the widest line, 4px above the first line's ascent and below the
 * last line's descent. `x` is the text's own x, `y` the first line's baseline.
 */
export function SentenceHighlight({
  x,
  y,
  size,
  lines,
  lineH = size * 1.36,
}: {
  x: number;
  y: number;
  size: number;
  lines: readonly string[];
  lineH?: number;
}) {
  const padX = 8;
  const padY = 4;
  const textTop = y - size * UI_ASCENT;
  const textBottom = y + (lines.length - 1) * lineH + size * UI_DESCENT;
  const textW = Math.max(...lines.map((line) => uiWidth(line, size)));
  const top = textTop - padY;
  const h = textBottom - textTop + 2 * padY;
  const left = x - padX;
  const w = textW + 2 * padX;
  return <rect x={left} y={top} width={w} height={h} rx={3} fill={ui.failTint} />;
}

/** A neutral capsule: a driver name, a marker. Never a status. */
export function Chip({ x, cy, label, size = 10 }: { x: number; cy: number; label: string; size?: number }) {
  const w = chipWidth(label, size);
  return (
    <g>
      <rect x={x} y={cy - 9} width={w} height={18} rx={3} fill={ui.soft} />
      <Txt x={x + w / 2} y={baseline(cy, size)} size={size} weight={500} anchor="middle">
        {label}
      </Txt>
    </g>
  );
}

export function chipWidth(label: string, size = 10): number {
  return textWidth(label, size) + 12;
}

export function SearchBox({
  x,
  y,
  width,
  placeholder,
}: {
  x: number;
  y: number;
  width: number;
  placeholder: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={width} height={26} rx={4} fill={ui.bg} stroke={ui.line} />
      <Txt x={x + 9} y={baseline(y + 13, 11.5)} size={11.5} fill={ui.faint}>
        {placeholder}
      </Txt>
    </g>
  );
}

export interface Col {
  label: string;
  left: number;
  right: number;
  align?: 'end';
}

export function cellX(col: Col): number {
  return col.align === 'end' ? col.right - 12 : col.left + 12;
}

export const HEAD_H = 28;

export function TableHead({ y, columns }: { y: number; columns: readonly Col[] }) {
  const x0 = columns[0]!.left;
  const x1 = columns[columns.length - 1]!.right;
  return (
    <g>
      {columns.map((col, i) => (
        <g key={col.label}>
          {i > 0 && <VLine x={col.left} y0={y + 6} y1={y + HEAD_H - 6} />}
          <Txt
            x={cellX(col)}
            y={baseline(y + HEAD_H / 2, 10)}
            size={10}
            weight={600}
            fill={ui.muted}
            anchor={col.align === 'end' ? 'end' : 'start'}
            upper
          >
            {col.label}
          </Txt>
        </g>
      ))}
      <HLine y={y + HEAD_H} x0={x0} x1={x1} />
    </g>
  );
}

export function Tally({
  y,
  x,
  right,
  items,
  total,
}: {
  y: number;
  x: number;
  right: number;
  items: readonly { tone: Tone; count: number; word: string }[];
  total: string;
}) {
  let cursor = x;
  const cy = y + 18;
  return (
    <g>
      <HLine y={y} x0={x - 24} x1={right} />
      {items
        .filter((item) => item.count > 0)
        .map((item) => {
          const label = `${item.count} ${item.word}`;
          const at = cursor;
          cursor += statusWordWidth(label, 11) + 16;
          return <StatusWord key={item.word} x={at} cy={cy} tone={item.tone} word={label} size={11} />;
        })}
      <Txt x={cursor} y={baseline(cy, 11)} size={11} fill={ui.muted}>
        {total}
      </Txt>
    </g>
  );
}

/** A dialog's stepper: taken segments green, the current one dark, the rest muted. */
export function Stepper({
  x,
  y,
  width,
  steps,
  current,
}: {
  x: number;
  y: number;
  width: number;
  steps: readonly string[];
  current: number;
}) {
  const gap = 8;
  const segW = (width - gap * (steps.length - 1)) / steps.length;
  return (
    <g>
      {steps.map((name, i) => {
        const left = x + i * (segW + gap);
        const fill = i < current ? ui.emerald : i === current ? ui.fg : ui.line;
        return (
          <g key={name}>
            <rect x={left} y={y} width={segW} height={5} rx={2.5} fill={fill} />
            <Txt
              x={left}
              y={y + 20}
              size={10.5}
              weight={i === current ? 500 : 400}
              fill={i === current ? ui.fg : ui.muted}
            >
              {name}
            </Txt>
          </g>
        );
      })}
    </g>
  );
}

/** Where a dialog's body starts, below its title and stepper. */
export const DIALOG_BODY = 92;

/** The dashboard's dialog: a white sheet with a title, a close mark and a stepper. */
export function DialogFrame({
  x,
  y,
  w,
  h,
  pad,
  title,
  steps,
  current,
  children,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  pad: number;
  title: string;
  steps: readonly string[];
  current: number;
  children: ReactNode;
}) {
  const left = x + pad;
  return (
    <g className="sc-in sc-rise sc-dialog">
      <rect x={x} y={y} width={w} height={h} rx={8} fill={ui.bg} stroke={ui.line} />
      <Txt x={left} y={y + 38} size={14} weight={600}>
        {title}
      </Txt>
      <g stroke={ui.muted} strokeWidth={1.5} strokeLinecap="round">
        <line x1={x + w - pad - 8} y1={y + 26} x2={x + w - pad} y2={y + 34} />
        <line x1={x + w - pad} y1={y + 26} x2={x + w - pad - 8} y2={y + 34} />
      </g>
      <Stepper x={left} y={y + 52} width={w - 2 * pad} steps={steps} current={current} />
      {children}
    </g>
  );
}

/** The shade a dialog casts on the page behind it. */
export function Dim({ width, height }: { width: number; height: number }) {
  return (
    <g className="sc-in sc-dim">
      <rect width={width} height={height} fill="#000" opacity={0.4} />
    </g>
  );
}

/** A pick mark: filled with a white tick when on, an empty ring when off. */
export function Tick({ cx, cy, on }: { cx: number; cy: number; on: boolean }) {
  return on ? (
    <g>
      <circle cx={cx} cy={cy} r={7} fill={ui.primary} />
      <path
        d={`M${cx - 3.2} ${cy} l2.2 2.2 l4.2 -4.4`}
        fill="none"
        stroke={ui.onPrimary}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  ) : (
    <circle cx={cx} cy={cy} r={6.5} fill={ui.bg} stroke={ui.line} />
  );
}

/** The TrueCourse mark, as the favicon draws it. */
export function Mark({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 100})`}>
      <rect width={100} height={100} rx={22} fill="#15181d" />
      <polygon points="47,18 47,64 21,64" fill="#e8ebef" />
      <polygon points="53,30 53,64 76,64" fill="#5ce39a" />
      <path d="M31 78 H69" stroke="#e8ebef" strokeWidth={7} strokeLinecap="round" />
    </g>
  );
}

export const SIDEBAR_W = 200;

const NAV: { label: string; icon: LucideIcon }[] = [
  { label: 'Home', icon: Home },
  { label: 'Context', icon: Layers },
  { label: 'Code', icon: GitBranch },
  { label: 'Flows', icon: Route },
  { label: 'Agent', icon: MousePointer2 },
  { label: 'Notifications', icon: Bell },
  { label: 'Settings', icon: Settings },
];

export type NavPage = 'Home' | 'Context' | 'Code' | 'Flows';

/** The shell's left rail: brand, workspace, the seven pages, the signed-in user. */
export function Sidebar({ height, active }: { height: number; active: NavPage }) {
  const rowH = 30;
  const navTop = 92;
  const userTop = height - 52;
  return (
    <g>
      <rect width={SIDEBAR_W} height={height} fill={ui.card} />
      <VLine x={SIDEBAR_W} y0={0} y1={height} />

      <Mark x={14} y={13} size={20} />
      <Txt x={40} y={baseline(23, 13)} size={13} weight={700}>
        TrueCourse
      </Txt>
      <PanelLeftClose x={172} y={16} width={14} height={14} color={ui.muted} strokeWidth={1.75} />

      <rect x={14} y={50} width={24} height={24} rx={5} fill={ui.soft} />
      <Txt x={26} y={baseline(62, 11)} size={11} weight={600} anchor="middle">
        N
      </Txt>
      <Txt x={46} y={baseline(62, 12.5)} size={12.5} weight={500}>
        Northwind Labs
      </Txt>

      {NAV.map((item, i) => {
        const top = navTop + i * rowH;
        const on = item.label === active;
        const color = on ? ui.fg : ui.muted;
        return (
          <g key={item.label}>
            {on && <rect x={8} y={top} width={SIDEBAR_W - 16} height={28} rx={6} fill={ui.activeRow} />}
            <item.icon x={18} y={top + 7} width={14} height={14} color={color} strokeWidth={1.75} />
            <Txt x={40} y={baseline(top + 14, 13)} size={13} weight={500} fill={color}>
              {item.label}
            </Txt>
            {item.label === 'Notifications' && (
              <g>
                <circle cx={31} cy={top + 7} r={6} fill={ui.primary} stroke={ui.card} strokeWidth={1.5} />
                <Txt x={31} y={baseline(top + 7, 8)} size={8} weight={600} fill={ui.onPrimary} anchor="middle">
                  2
                </Txt>
              </g>
            )}
          </g>
        );
      })}

      <HLine y={userTop} x0={0} x1={SIDEBAR_W} />
      <circle cx={26} cy={userTop + 26} r={12} fill={ui.soft} />
      <Txt x={26} y={baseline(userTop + 26, 11)} size={11} weight={600} anchor="middle">
        A
      </Txt>
      <Txt x={46} y={baseline(userTop + 20, 12)} size={12}>
        Ada Okafor
      </Txt>
      <Txt x={46} y={baseline(userTop + 34, 10.5)} size={10.5} fill={ui.muted}>
        ada@northwind.dev
      </Txt>
    </g>
  );
}

export const HEADER_H = 44;

export function PageHeader({
  x,
  right,
  title,
  titleX = x + 24,
}: {
  x: number;
  right: number;
  title: string;
  titleX?: number;
}) {
  return (
    <g>
      <Txt x={titleX} y={baseline(HEADER_H / 2, 13)} size={13} weight={600}>
        {title}
      </Txt>
      <HLine y={HEADER_H} x0={x} x1={right} />
    </g>
  );
}
