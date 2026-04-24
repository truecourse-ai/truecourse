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
