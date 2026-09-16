import type { CSSProperties } from 'react';
import { FLOW_ID } from './evidence';
import { Chip, HLine, StatusWord, Tick, Txt, chipWidth, order } from './primitives';
import { baseline, ui, uiWidth, type Tone } from './theme';
import { useCompact } from './use-compact';

interface Vm {
  flow: string;
  /** The starting state the flow needs, prepared before it runs. */
  seed: string[];
  steps: number;
  /** The step that fails, one-based; the run stops there. */
  failAt?: number;
  tone: Tone;
  word: string;
}

const VMS: Vm[] = [
  {
    flow: FLOW_ID,
    seed: ['2 customers', '1 paid invoice', '1 card on file'],
    steps: 6,
    failAt: 5,
    tone: 'failure',
    word: 'Failed',
  },
  {
    flow: 'invoice-totals-are-integer-cents',
    seed: ['1 customer', '3 invoices'],
    steps: 4,
    tone: 'success',
    word: 'Succeeded',
  },
  {
    flow: 'credit-note-reverses-invoice',
    seed: ['1 customer', '1 paid invoice', '1 refund'],
    steps: 5,
    tone: 'success',
    word: 'Succeeded',
  },
];

const LABEL =
  'Three microVMs side by side, one per flow: each boots northwind/billing, is seeded with the data its flow needs, one record at a time, runs the flow step by step, records the result and is destroyed';

/** A start time inside the machine's own timeline. */
function at(ms: number): CSSProperties {
  return { ['--at' as string]: `calc(var(--vm) + ${ms}ms)` };
}

const ROW_H = 30;
const VM_H = 212;
/** How long each seed record takes to land. */
const SEED_STEP = 380;

/**
 * One machine: it appears, boots the product, is seeded record by record,
 * runs its steps, settles on a verdict, and is torn down: the frame goes
 * dashed, the record stays.
 */
function Machine({ vm, x, y, w, start }: { vm: Vm; x: number; y: number; w: number; start: number }) {
  const h = VM_H;
  const left = x + 16;
  const headCy = y + 21;
  const chip = 'microVM';
  const rowCy = (i: number) => y + 60 + i * ROW_H;
  const textX = left + 22;
  const steps = vm.failAt ? vm.failAt : vm.steps;
  const seeded = 1300 + vm.seed.length * SEED_STEP;
  const ran = seeded + 500;
  const done = ran + 300 + steps * 220;
  const gone = done + 1200;
  let seedX = textX;
  return (
    <g style={{ ['--vm' as string]: `${start}ms` }}>
      <g className="sc-out" style={at(gone)}>
        <g className="sc-in sc-rise" style={at(0)}>
          <rect x={x + 0.5} y={y + 0.5} width={w - 1} height={h - 1} rx={8} fill={ui.card} stroke={ui.line} />
        </g>
      </g>
      <g className="sc-in sc-rise" style={at(0)}>
        <Chip x={left} cy={headCy} label={chip} />
        <Txt x={left + chipWidth(chip) + 10} y={baseline(headCy, 11)} size={11} weight={500}>
          {vm.flow}
        </Txt>
        <HLine y={y + 42} x0={x} x1={x + w} />
      </g>
      <g className="sc-in sc-rise" style={at(500)}>
        <Tick cx={left + 7} cy={rowCy(0)} on />
        <Txt x={textX} y={baseline(rowCy(0), 11)} size={11} weight={500}>
          Booted
        </Txt>
        <Txt x={textX + uiWidth('Booted', 11, 500) + 8} y={baseline(rowCy(0), 11)} size={11} fill={ui.muted}>
          northwind/billing at 4f1e9c2
        </Txt>
      </g>
      <g className="sc-in sc-rise" style={at(1000)}>
        <circle cx={left + 7} cy={rowCy(1)} r={6.5} fill={ui.bg} stroke={ui.line} />
        <circle
          className="sc-spin"
          cx={left + 7}
          cy={rowCy(1)}
          r={5}
          fill="none"
          stroke={ui.fg}
          strokeWidth={1.4}
          strokeDasharray="18 14"
          strokeLinecap="round"
        />
      </g>
      <g className="sc-out" style={at(seeded)}>
        <g className="sc-in sc-rise" style={at(1000)}>
          <Txt x={textX} y={baseline(rowCy(1), 11)} size={11} weight={500}>
            Seeding
          </Txt>
        </g>
      </g>
      <g className="sc-in sc-fade" style={at(seeded)}>
        <Tick cx={left + 7} cy={rowCy(1)} on />
        <Txt x={textX} y={baseline(rowCy(1), 11)} size={11} weight={500}>
          Seeded
        </Txt>
      </g>
      {vm.seed.map((item, i) => {
        const cx = seedX;
        seedX += chipWidth(item) + 6;
        return (
          <g
            key={item}
            className="sc-in sc-flip"
            style={{ ...at(1300), ...order(i), ['--step' as string]: `${SEED_STEP}ms` }}
          >
            <Chip x={cx} cy={rowCy(2)} label={item} />
          </g>
        );
      })}
      <g className="sc-in sc-rise" style={at(ran)}>
        <Txt x={textX} y={baseline(rowCy(3), 11)} size={11} weight={500}>
          Ran
        </Txt>
      </g>
      {Array.from({ length: steps }, (_, i) => (
        <rect
          key={i}
          className="sc-in sc-flip"
          style={{ ...at(ran + 200), ...order(i), ['--step' as string]: '220ms' }}
          x={textX + uiWidth('Ran', 11, 500) + 8 + i * 16}
          y={rowCy(3) - 5}
          width={11}
          height={10}
          rx={2}
          fill={vm.failAt === i + 1 ? ui.red : ui.emerald}
        />
      ))}
      <g className="sc-in sc-fade" style={at(ran + 200 + steps * 220)}>
        <Tick cx={left + 7} cy={rowCy(3)} on />
      </g>
      <g className="sc-in sc-rise" style={at(done)}>
        <StatusWord x={left + 3} cy={rowCy(4)} tone={vm.tone} word={vm.word} />
      </g>
      <g className="sc-in sc-fade" style={at(gone)}>
        <rect
          x={x + 0.5}
          y={y + 0.5}
          width={w - 1}
          height={h - 1}
          rx={8}
          fill="none"
          stroke={ui.faint}
          strokeDasharray="4 3"
        />
        <Txt x={x + w - 16} y={baseline(rowCy(4), 11)} size={11} fill={ui.muted} anchor="end">
          Destroyed
        </Txt>
      </g>
    </g>
  );
}

/**
 * The sandbox: one machine per flow, side by side, each living its whole
 * life in front of the reader, a little behind the one before it.
 */
export function SandboxScreen() {
  const compact = useCompact();
  const W = compact ? 500 : 1040;
  const gap = compact ? 20 : 28;
  const shown = compact ? VMS.slice(0, 2) : VMS;
  const w = compact ? W : (W - 2 * gap) / 3;
  const H = compact ? VM_H * 2 + gap : VM_H;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="screen-sandbox"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={LABEL}
      style={{ fontFamily: 'var(--font-ui)' }}
    >
      {shown.map((vm, i) => (
        <Machine
          key={vm.flow}
          vm={vm}
          x={compact ? 0 : i * (w + gap)}
          y={compact ? i * (VM_H + gap) : 0}
          w={w}
          start={300 + i * 700}
        />
      ))}
    </svg>
  );
}
