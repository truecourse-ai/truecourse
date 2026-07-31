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

  constructor(emit: ProgressEmit, stepDefs: { key: string; label: string }[]) {
    this.steps = stepDefs.map((s) => ({ ...s, status: 'pending' as StepStatus }));
    this.emitFn = emit;
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

    this.emitFn({
      step: stepLabel,
      percent,
      detail: activeStep?.detail,
      steps: [...this.steps],
    });
  }
}

/** Progress-step key of the pre-flight cost estimate. */
const ESTIMATE_STEP_KEY = 'estimate';

/**
 * Compute a pre-flight cost estimate under its own progress step. The estimate
 * reads every doc the run would price, which is seconds of work on a large
 * corpus — and it runs before the pipeline's first step, so without a step of
 * its own the CLI checklist and the dashboard popup sit silent until the confirm
 * gate opens. Inserted dynamically, and first: it exists only when the caller
 * gates on the estimate, and it precedes everything the caller declared.
 */
export async function withEstimateStep<T extends { subjectLabel?: string }>(
  tracker: StepTracker | undefined,
  compute: () => Promise<T>,
): Promise<T> {
  tracker?.ensureStep(ESTIMATE_STEP_KEY, 'Estimating cost', 'first');
  tracker?.start(ESTIMATE_STEP_KEY);
  try {
    const estimate = await compute();
    tracker?.done(ESTIMATE_STEP_KEY, estimate.subjectLabel);
    return estimate;
  } catch (err) {
    tracker?.error(ESTIMATE_STEP_KEY);
    throw err;
  }
}
