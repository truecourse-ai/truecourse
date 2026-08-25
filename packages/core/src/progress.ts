import { DOMAIN_ORDER, CODE_DOMAINS, DEFAULT_DOMAINS } from '@truecourse/shared';

export { DOMAIN_ORDER, CODE_DOMAINS, DEFAULT_DOMAINS };

// Domains that have LLM rules
export const LLM_DOMAINS = DOMAIN_ORDER.filter((d: string) => ['security', 'bugs', 'architecture', 'code-quality', 'database'].includes(d));

// Human-readable domain labels
export const DOMAIN_LABELS: Record<string, string> = {
  'security': 'Security',
  'bugs': 'Bugs',
  'architecture': 'Architecture',
  'performance': 'Performance',
  'reliability': 'Reliability',
  'code-quality': 'Code quality',
  'database': 'Database',
  'style': 'Style',
};

export function buildAnalysisSteps(
  enabledCategories?: string[],
  enableLlmRules?: boolean,
  hasCSharp?: boolean,
): { key: string; label: string }[] {
  const steps: { key: string; label: string }[] = [
    { key: 'parse', label: 'Parsing repository' },
  ];


  if (enableLlmRules) {
    steps.push({ key: 'scan', label: 'Scanning files' });
  }

  const activeDomains = DOMAIN_ORDER.filter(d => !enabledCategories?.length || enabledCategories.includes(d));

  for (const domain of activeDomains) {
    steps.push({ key: domain, label: `${DOMAIN_LABELS[domain]} checks` });
  }

  // C# semantic analysis (Roslyn host) runs as its own out-of-process phase after
  // the domain checks. Declare it up front for C# repos so the checklist is stable
  // (no mid-run insertion). Unlike TS (inline in the checks) and Python/Pyright
  // (inline in parse), this tier has no other step to report under.
  if (hasCSharp) {
    steps.push({ key: 'csharp', label: 'C# semantic analysis' });
  }

  steps.push({ key: 'persist', label: 'Saving results' });
  return steps;
}

// Step status for checklist UI
export type StepStatus = 'pending' | 'active' | 'done' | 'error';
export interface AnalysisStep {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface AnalysisProgressPayload {
  step: string;
  percent: number;
  detail?: string;
  steps?: AnalysisStep[];
}

// ---------------------------------------------------------------------------
// StepTracker — manages a checklist of analysis phases and emits progress.
// The emitter is caller-provided so the CLI can render to stdout while the
// dashboard server wires it through Socket.io.
// ---------------------------------------------------------------------------

export type ProgressEmit = (payload: AnalysisProgressPayload) => void;

export class StepTracker {
  private steps: AnalysisStep[];
  private readonly emitFn: ProgressEmit;
  private readonly taps: ProgressEmit[] = [];

  constructor(emit: ProgressEmit, stepDefs: { key: string; label: string }[]) {
    this.steps = stepDefs.map((s) => ({ ...s, status: 'pending' as StepStatus }));
    this.emitFn = emit;
  }

  /**
   * Add a secondary emit listener — e.g. the sessions run record mirroring
   * the checklist so the dashboard sees CLI-run progress. Returns the remover.
   */
  tap(fn: ProgressEmit): () => void {
    this.taps.push(fn);
    return () => {
      const i = this.taps.indexOf(fn);
      if (i !== -1) this.taps.splice(i, 1);
    };
  }

  start(key: string, detail?: string): void {
    this.setStatus(key, 'active', detail);
  }

  done(key: string, detail?: string): void {
    this.setStatus(key, 'done', detail);
  }

  error(key: string, detail?: string): void {
    this.setStatus(key, 'error', detail);
  }

  detail(key: string, detail: string): void {
    const step = this.steps.find((s) => s.key === key);
    if (step) {
      step.detail = detail;
      this.emit();
    }
  }

  /**
   * Insert a step at runtime if it isn't already there. Used for phases we can't
   * declare up front — e.g. the C# semantic tier only exists when the repo
   * actually has C#, and the pre-flight cost estimate only runs when the caller
   * gates on it. `position: 'first'` puts it at the front (a phase that precedes
   * everything declared); otherwise it lands just before `persist`.
   * No-op if the key already exists.
   */
  ensureStep(key: string, label: string, position: 'first' | 'before-persist' = 'before-persist'): void {
    if (this.steps.some((s) => s.key === key)) return;
    const step: AnalysisStep = { key, label, status: 'pending' };
    if (position === 'first') {
      this.steps.unshift(step);
      this.emit();
      return;
    }
    const persistIdx = this.steps.findIndex((s) => s.key === 'persist');
    if (persistIdx === -1) this.steps.push(step);
    else this.steps.splice(persistIdx, 0, step);
    this.emit();
  }

  private setStatus(key: string, status: StepStatus, detail?: string): void {
    const step = this.steps.find((s) => s.key === key);
    if (step) {
      step.status = status;
      if (detail !== undefined) step.detail = detail;
      this.emit();
    }
  }

  private emit(): void {
    const total = this.steps.length;
    const doneCount = this.steps.filter((s) => s.status === 'done' || s.status === 'error').length;
    const activeCount = this.steps.filter((s) => s.status === 'active').length;
    const percent = Math.round(((doneCount + activeCount * 0.5) / total) * 100);

    const activeStep = this.steps.find((s) => s.status === 'active');
    const stepLabel = activeStep?.label ?? 'Analyzing';

    const payload: AnalysisProgressPayload = {
      step: stepLabel,
      percent,
      detail: activeStep?.detail,
      steps: [...this.steps],
    };
    this.emitFn(payload);
    for (const tap of this.taps) tap(payload);
  }
}

/** Progress-step key of the pre-flight cost estimate. */
const ESTIMATE_STEP_KEY = 'estimate';

/**
 * The pre-flight cost estimate's own progress surface. The estimate reads every
 * doc the run would price — seconds of work on a large corpus — and it finishes
 * before the pipeline's first step, so without a surface of its own the CLI and
 * the dashboard sit silent until the confirm gate opens.
 *
 * It is deliberately NOT part of the run checklist: the terminal renderer draws
 * the checklist in place, so an estimate step made the whole checklist paint
 * once during estimation (every real step pending) and again after the confirm.
 * Each caller picks its own presentation — the CLI resolves a spinner into a
 * standalone line above the estimate panel; the dashboard adapts it back onto
 * the tracker via {@link estimateStepPhase}, whose popup replaces in place.
 */
export interface EstimatePhase {
  start(): void;
  /** `subject` is the estimate's subject label — e.g. `80 docs`, `3 of 14 sections changed`. */
  done(subject?: string): void;
  error(message?: string): void;
}

/**
 * Adapter for surfaces that want the estimate AS a checklist step (the dashboard
 * progress popup). The step is inserted dynamically, and first: it exists only
 * when the caller gates on an estimate, and it precedes everything declared.
 */
export function estimateStepPhase(tracker: StepTracker | undefined): EstimatePhase | undefined {
  if (!tracker) return undefined;
  return {
    start() {
      tracker.ensureStep(ESTIMATE_STEP_KEY, 'Estimating cost', 'first');
      tracker.start(ESTIMATE_STEP_KEY);
    },
    done(subject) {
      tracker.done(ESTIMATE_STEP_KEY, subject);
    },
    error(message) {
      tracker.error(ESTIMATE_STEP_KEY, message);
    },
  };
}

/** Compute a pre-flight cost estimate, reporting start/done through `phase`. */
export async function withEstimatePhase<T extends { subjectLabel?: string }>(
  phase: EstimatePhase | undefined,
  compute: () => Promise<T>,
): Promise<T> {
  phase?.start();
  try {
    const estimate = await compute();
    phase?.done(estimate.subjectLabel);
    return estimate;
  } catch (err) {
    phase?.error((err as Error).message);
    throw err;
  }
}
