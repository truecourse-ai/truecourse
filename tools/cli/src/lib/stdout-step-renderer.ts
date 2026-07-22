/**
 * Stdout renderer for a `StepTracker`. Draws a fixed checklist and
 * updates it in-place using ANSI cursor moves. One spinner frame
 * advances every 80ms while any step is active.
 *
 * Usage:
 *   const renderer = createStdoutStepRenderer();
 *   const tracker = new StepTracker(renderer.onProgress, stepDefs);
 *   tracker.start('foo');
 *   // ...
 *   renderer.dispose();
 */

import type { AnalysisProgressPayload, AnalysisStep } from '@truecourse/core/progress';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const ANSI_SGR_GLOBAL = /\x1b\[[0-9;]*m/g;

/** Visible column count of a string, ignoring ANSI SGR (color) codes. */
export function visibleLength(s: string): number {
  return [...s.replace(ANSI_SGR_GLOBAL, '')].length;
}

/**
 * Clamp a (possibly ANSI-styled) string to `maxWidth` visible columns so it
 * never exceeds one terminal row. ANSI SGR codes are copied through and do
 * not count toward the width; when the visible text is longer than the budget
 * the tail is replaced by a single-column ellipsis. Strings that already fit
 * are returned unchanged.
 */
export function clampToWidth(s: string, maxWidth: number): string {
  if (maxWidth <= 0 || visibleLength(s) <= maxWidth) return s;
  const budget = maxWidth - 1; // reserve one column for the ellipsis
  const tokens = s.match(/\x1b\[[0-9;]*m|[\s\S]/gu) ?? [];
  let out = '';
  let visible = 0;
  for (const tok of tokens) {
    if (tok.charCodeAt(0) === 0x1b) {
      out += tok; // ANSI control sequence — zero visible width
      continue;
    }
    if (visible >= budget) break;
    out += tok;
    visible++;
  }
  return `${out}…`;
}

/**
 * Terminal width for clamping live lines, recomputed every render so a resize
 * takes effect on the next paint. Returns null when stderr is not a TTY
 * (piped/redirected): there is no wrapping to guard against, so lines are left
 * untouched.
 */
function terminalWidth(): number | null {
  if (!process.stderr.isTTY) return null;
  return process.stdout.columns || process.stderr.columns || 80;
}

export interface StdoutStepRenderer {
  /** Pass to `new StepTracker(onProgress, ...)`. */
  onProgress: (payload: AnalysisProgressPayload) => void;
  /**
   * Print a persistent line ABOVE the live checklist: the checklist region is
   * cleared, the line scrolls into history (printed full — never clamped), and
   * the checklist repaints below it. For results that must surface mid-run
   * (e.g. a failing scenario) without corrupting the in-place redraw.
   */
  log: (line: string) => void;
  /** Stop the spinner timer. Call when the command exits. */
  dispose: () => void;
}

export function createStdoutStepRenderer(): StdoutStepRenderer {
  let spinnerFrame = 0;
  let spinnerInterval: ReturnType<typeof setInterval> | null = null;
  // Visible column widths of the last painted frame's lines. Lines are clamped
  // at paint time, so each occupied ONE row at the width it was painted at —
  // but a resize reflows them: after narrowing, a line of length L occupies
  // ceil(L / newWidth) rows (terminals reflow each \n-terminated line
  // independently). The clear before a repaint must count PHYSICAL rows at the
  // CURRENT width, not logical lines, or the repaint lands mid-frame and
  // leaves a stale duplicate above.
  let lastFrameLengths: number[] = [];
  let latestSteps: AnalysisStep[] | null = null;
  // The most recent full checklist, kept (unlike `latestSteps`, which clears
  // when nothing is active) so `log()` can repaint after clearing the region.
  let lastPainted: AnalysisStep[] | null = null;

  /** Physical rows the last frame occupies at `width` (1 row/line when null). */
  function lastFrameRows(width: number | null): number {
    return lastFrameLengths.reduce(
      (rows, len) => rows + (width !== null && width > 0 ? Math.max(1, Math.ceil(len / width)) : 1),
      0,
    );
  }

  /** Move to the top of the live region and erase it (plus anything below). */
  function clearRegion(width: number | null): void {
    if (lastFrameLengths.length === 0) return;
    process.stderr.write(`\x1b[${lastFrameRows(width)}A\x1b[0J`);
    lastFrameLengths = [];
  }

  function paint(steps: AnalysisStep[]): void {
    lastPainted = steps;
    // Recompute each paint so a terminal resize is picked up: the clear counts
    // the OLD frame's rows at the NEW width, then every fresh line is clamped
    // to the new width so it again occupies exactly one row.
    const width = terminalWidth();
    clearRegion(width);
    for (const step of steps) {
      // Suppress detail on pending steps — they shouldn't display
      // numbers before the step has actually started. The dashboard
      // progress popup does the same; keep stdout consistent.
      const detail = step.detail && step.status !== 'pending' ? ` — ${step.detail}` : '';
      let icon: string;
      let color: string;
      const reset = '\x1b[0m';
      switch (step.status) {
        case 'pending':
          icon = '○';
          color = '\x1b[2m';
          break;
        case 'active':
          icon = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length];
          color = '\x1b[36m';
          break;
        case 'done':
          icon = '●';
          color = '\x1b[32m';
          break;
        case 'error':
          icon = '✕';
          color = '\x1b[31m';
          break;
        default:
          icon = '○';
          color = '';
      }
      const content = `  ${icon} ${step.label}${detail}`;
      const line = width === null ? content : clampToWidth(content, width);
      process.stderr.write(`\x1b[2K${color}${line}${reset}\n`);
      lastFrameLengths.push(visibleLength(line));
    }

    const hasActive = steps.some((s) => s.status === 'active');
    if (hasActive && !spinnerInterval) {
      latestSteps = steps;
      spinnerInterval = setInterval(() => {
        spinnerFrame++;
        if (latestSteps) paint(latestSteps);
      }, 80);
    } else if (hasActive) {
      latestSteps = steps;
    } else if (!hasActive && spinnerInterval) {
      clearInterval(spinnerInterval);
      spinnerInterval = null;
      latestSteps = null;
    }
  }

  return {
    onProgress(payload) {
      if (payload.steps) paint(payload.steps);
    },
    log(line) {
      // Non-TTY (piped): plain append — there is no live region to manage.
      if (!process.stderr.isTTY) {
        process.stderr.write(`${line}\n`);
        return;
      }
      // Clear the checklist region, let the line scroll into history, repaint
      // the checklist below it. Persistent lines print full, never clamped.
      clearRegion(terminalWidth());
      process.stderr.write(`${line}\n`);
      if (lastPainted) paint(lastPainted);
    },
    dispose() {
      if (spinnerInterval) {
        clearInterval(spinnerInterval);
        spinnerInterval = null;
      }
      latestSteps = null;
    },
  };
}
