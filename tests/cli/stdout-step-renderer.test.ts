/**
 * The stdout step renderer redraws its checklist in place with one cursor-up
 * per LOGICAL line. If a live status line is wider than the terminal it wraps
 * to a second visual row, the cursor-up count falls short, and every redraw
 * leaves a stale duplicate on screen (SPEC_GUARD_PLAN item 34). The fix clamps
 * every live line to the terminal width so one logical line is always one
 * visual row. These tests pin that: clamping with an ellipsis, no duplicates
 * across a redraw, ANSI measured by visible length, and non-TTY left untouched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createStdoutStepRenderer,
  clampToWidth,
  visibleLength,
} from '../../tools/cli/src/lib/stdout-step-renderer';
import type { AnalysisStep } from '../../packages/core/src/progress';

// Strip ALL CSI sequences (color + cursor moves + clear-line), not just SGR,
// to recover the printable text of a written chunk.
const stripAllAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

function step(partial: Partial<AnalysisStep> & Pick<AnalysisStep, 'label' | 'status'>): AnalysisStep {
  return { key: partial.label, ...partial };
}

let writes: string[];
let writeSpy: ReturnType<typeof vi.spyOn>;
let origColumns: number | undefined;
let origStdoutTTY: boolean | undefined;
let origStderrTTY: boolean | undefined;

beforeEach(() => {
  writes = [];
  writeSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    writes.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  });
  origColumns = process.stdout.columns;
  origStdoutTTY = process.stdout.isTTY;
  origStderrTTY = process.stderr.isTTY;
});

afterEach(() => {
  writeSpy.mockRestore();
  (process.stdout as { columns?: number }).columns = origColumns;
  (process.stdout as { isTTY?: boolean }).isTTY = origStdoutTTY;
  (process.stderr as { isTTY?: boolean }).isTTY = origStderrTTY;
});

function setTerminal(columns: number, isTTY: boolean): void {
  (process.stderr as { isTTY?: boolean }).isTTY = isTTY;
  (process.stdout as { isTTY?: boolean }).isTTY = isTTY;
  (process.stdout as { columns?: number }).columns = columns;
}

/** Printable content lines (the checklist rows), one per step, ANSI stripped. */
function contentLines(): string[] {
  return writes
    .filter((w) => w.includes('\n'))
    .map((w) => stripAllAnsi(w).replace(/\n$/, ''));
}

describe('clampToWidth / visibleLength', () => {
  it('measures visible length ignoring ANSI styling', () => {
    expect(visibleLength('\x1b[36mabc\x1b[0m')).toBe(3);
    expect(visibleLength('plain')).toBe(5);
  });

  it('clamps ANSI-styled content by visible length, keeping the styling', () => {
    const styled = '\x1b[36mhello world\x1b[0m'; // 11 visible cols
    const out = clampToWidth(styled, 8);
    expect(visibleLength(out)).toBe(8); // 7 visible chars + the ellipsis
    expect(out.endsWith('…')).toBe(true);
    expect(out).toContain('\x1b[36m'); // color code survived truncation
    expect(stripAllAnsi(out)).toBe('hello w…');
  });

  it('returns content unchanged when it already fits', () => {
    const styled = '\x1b[36mhi\x1b[0m';
    expect(clampToWidth(styled, 20)).toBe(styled);
    expect(clampToWidth('short', 5)).toBe('short');
  });
});

describe('stdout step renderer — live line clamping', () => {
  it('clamps a long live status line to the terminal width with an ellipsis', () => {
    setTerminal(40, true);
    const renderer = createStdoutStepRenderer();
    renderer.onProgress({
      step: 'guard',
      percent: 50,
      steps: [
        step({
          label: 'Birth-validating',
          status: 'active',
          detail: 'sections 6/20 · birth 25 · retrying 3/5 · claude-opus-4-8 · 19.4K tok · $0.16',
        }),
      ],
    });
    renderer.dispose();

    const line = contentLines().find((l) => l.includes('Birth-validating'));
    expect(line).toBeDefined();
    expect(visibleLength(line!)).toBeLessThanOrEqual(40);
    expect(line!.endsWith('…')).toBe(true);
  });

  it('leaves one visual row per logical line across a redraw (no duplicates)', () => {
    setTerminal(30, true);
    const renderer = createStdoutStepRenderer();
    const steps = (detail: string): AnalysisStep[] => [
      step({ label: 'Indexing sections', status: 'done', detail: '20 of 20 sections changed · sonnet' }),
      step({ label: 'Authoring', status: 'done', detail: '20 sections · opus' }),
      step({ label: 'Birth-validating', status: 'active', detail }),
    ];

    renderer.onProgress({ step: 'guard', percent: 40, steps: steps('sections 6/20 · birth 25 · retrying 3/5 · claude-opus-4-8') });
    writes = []; // isolate the redraw
    renderer.onProgress({ step: 'guard', percent: 45, steps: steps('sections 7/20 · birth 26 · retrying 4/5 · claude-opus-4-8') });
    renderer.dispose();

    // The redraw first moves the cursor up by the LOGICAL line count (3). That
    // only lands on the top row if every line occupied exactly one visual row.
    expect(writes[0]).toBe('\x1b[3A');
    const lines = contentLines();
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(visibleLength(l)).toBeLessThanOrEqual(30);
  });

  it('leaves lines untouched when stderr is not a TTY (piped)', () => {
    setTerminal(40, false);
    const longDetail = 'sections 6/20 · birth 25 · retrying 3/5 · claude-opus-4-8 · 19.4K tok · $0.16';
    const renderer = createStdoutStepRenderer();
    renderer.onProgress({
      step: 'guard',
      percent: 50,
      steps: [step({ label: 'Birth-validating', status: 'active', detail: longDetail })],
    });
    renderer.dispose();

    const line = contentLines().find((l) => l.includes('Birth-validating'));
    expect(line).toBeDefined();
    expect(line).toContain(longDetail); // full detail, not truncated
    expect(line).not.toContain('…');
    expect(visibleLength(line!)).toBeGreaterThan(40); // exceeds width, unclamped
  });
});

describe('stdout step renderer — persistent log lines', () => {
  it('log() prints the line above the checklist and repaints it below (TTY)', () => {
    setTerminal(80, true);
    const renderer = createStdoutStepRenderer();
    renderer.onProgress({
      step: 'run',
      percent: 20,
      steps: [
        step({ label: 'Building via recipe', status: 'done' }),
        step({ label: 'Running scenarios', status: 'active', detail: '3/10 scenarios' }),
      ],
    });
    writes = [];
    renderer.log('✗ cli-version-1 — prints the version  (12ms)');
    renderer.dispose();

    // Clear the 2-row live region, print the persistent line, repaint 2 rows below.
    expect(writes[0]).toBe('\x1b[2A\x1b[0J');
    expect(writes[1]).toBe('✗ cli-version-1 — prints the version  (12ms)\n');
    const repainted = writes.slice(2).map((w) => stripAllAnsi(w));
    expect(repainted).toHaveLength(2);
    expect(repainted[0]).toContain('Building via recipe');
    expect(repainted[1]).toContain('Running scenarios');
  });

  it('log() lines print full — never clamped — even on a narrow terminal', () => {
    setTerminal(20, true);
    const renderer = createStdoutStepRenderer();
    const long = '✗ some-scenario-with-a-very-long-identifier — a long title  (999ms)';
    renderer.log(long);
    renderer.dispose();
    expect(writes.join('')).toContain(`${long}\n`);
    expect(writes.join('')).not.toContain('…');
  });

  it('log() is a plain append when stderr is not a TTY', () => {
    setTerminal(80, false);
    const renderer = createStdoutStepRenderer();
    renderer.log('✗ failed-scenario — title  (5ms)');
    renderer.dispose();
    expect(writes).toEqual(['✗ failed-scenario — title  (5ms)\n']);
  });
});
