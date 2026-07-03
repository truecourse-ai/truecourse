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

export interface StdoutStepRenderer {
  /** Pass to `new StepTracker(onProgress, ...)`. */
  onProgress: (payload: AnalysisProgressPayload) => void;
  /** Stop the spinner timer. Call when the command exits. */
  dispose: () => void;
}

export function createStdoutStepRenderer(): StdoutStepRenderer {
  let spinnerFrame = 0;
  let spinnerInterval: ReturnType<typeof setInterval> | null = null;
  let renderedLineCount = 0;
  let latestSteps: AnalysisStep[] | null = null;

  function paint(steps: AnalysisStep[]): void {
    if (renderedLineCount > 0) {
      process.stderr.write(`\x1b[${renderedLineCount}A`);
    }
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
      process.stderr.write(`\x1b[2K${color}  ${icon} ${step.label}${detail}${reset}\n`);
    }
    renderedLineCount = steps.length;

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
    dispose() {
      if (spinnerInterval) {
        clearInterval(spinnerInterval);
        spinnerInterval = null;
      }
      latestSteps = null;
    },
  };
}
