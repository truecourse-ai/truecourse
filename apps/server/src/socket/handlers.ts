import type { Server as SocketServer, Socket } from 'socket.io';
import { getIO } from './index.js';

// Domain priority order
export const DOMAIN_ORDER = ['security', 'bugs', 'architecture', 'performance', 'reliability', 'code-quality', 'database', 'style'] as const;

// Domains that have LLM rules
export const LLM_DOMAINS = ['security', 'bugs', 'architecture', 'code-quality', 'database'] as const;

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

  const activeDomains = DOMAIN_ORDER.filter(d => !enabledCategories?.length || enabledCategories.includes(d));

  for (const domain of activeDomains) {
    steps.push({ key: `det-${domain}`, label: `${DOMAIN_LABELS[domain]} checks` });
  }

  if (enableLlmRules !== false) {
    const llmDomains = LLM_DOMAINS.filter(d => activeDomains.includes(d));
    for (const domain of llmDomains) {
      steps.push({ key: `llm-${domain}`, label: `${DOMAIN_LABELS[domain]} analysis (LLM)` });
    }
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

// Track in-progress analyses so we can inform clients that join mid-analysis
const activeAnalyses = new Map<string, AnalysisProgressPayload>();


export function setupHandlers(io: SocketServer): void {
  io.on('connection', (socket: Socket) => {
    console.error(`[Socket] Client connected: ${socket.id}`);

    socket.on('joinRepo', async (repoId: string) => {
      const room = `repo:${repoId}`;
      await socket.join(room);
      console.error(`[Socket] ${socket.id} joined room ${room}`);

      // If analysis is already running for this repo, send current progress
      const progress = activeAnalyses.get(repoId);
      if (progress) {
        socket.emit('analysis:progress', { repoId, ...progress });
      }


    });

    socket.on('leaveRepo', async (repoId: string) => {
      const room = `repo:${repoId}`;
      await socket.leave(room);
      console.error(`[Socket] ${socket.id} left room ${room}`);
    });

    socket.on('disconnect', () => {
      console.error(`[Socket] Client disconnected: ${socket.id}`);
    });
  });
}

// ---------------------------------------------------------------------------
// StepTracker — manages a checklist of analysis phases and emits progress
// ---------------------------------------------------------------------------

export class StepTracker {
  private steps: AnalysisStep[];
  private repoId: string;

  constructor(repoId: string, stepDefs: { key: string; label: string }[]) {
    this.repoId = repoId;
    this.steps = stepDefs.map((s) => ({ ...s, status: 'pending' as StepStatus }));
  }

  /** Mark a step as active (in progress) with optional detail. */
  start(key: string, detail?: string): void {
    this.setStatus(key, 'active', detail);
  }

  /** Mark a step as done with optional detail. */
  done(key: string, detail?: string): void {
    this.setStatus(key, 'done', detail);
  }

  /** Mark a step as errored with optional detail. */
  error(key: string, detail?: string): void {
    this.setStatus(key, 'error', detail);
  }

  /** Update detail text on a step without changing status. */
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
    // Compute percent from step completion
    const total = this.steps.length;
    const doneCount = this.steps.filter((s) => s.status === 'done' || s.status === 'error').length;
    const activeCount = this.steps.filter((s) => s.status === 'active').length;
    const percent = Math.round(((doneCount + activeCount * 0.5) / total) * 100);

    // Current step label for the `step` field (backward compat)
    const activeStep = this.steps.find((s) => s.status === 'active');
    const stepLabel = activeStep?.label ?? 'Analyzing';

    emitAnalysisProgress(this.repoId, {
      step: stepLabel,
      percent,
      detail: activeStep?.detail,
      steps: [...this.steps],
    });
  }
}

export function emitAnalysisProgress(
  repoId: string,
  progress: AnalysisProgressPayload,
): void {
  // Track progress so we can resend to clients that connect later
  if (progress.step === 'error') {
    activeAnalyses.delete(repoId);
  } else {
    activeAnalyses.set(repoId, progress);
  }

  const io = getIO();
  io.to(`repo:${repoId}`).emit('analysis:progress', { repoId, ...progress });
}

export function emitAnalysisComplete(
  repoId: string,
  analysisId: string
): void {
  activeAnalyses.delete(repoId);
  const io = getIO();
  io.to(`repo:${repoId}`).emit('analysis:complete', { repoId, analysisId });
}

export function emitFilesChanged(
  repoId: string,
  changedFiles: string[]
): void {
  const io = getIO();
  io.to(`repo:${repoId}`).emit('files:changed', { repoId, changedFiles });
}

export function emitViolationsReady(
  repoId: string,
  analysisId: string
): void {
  activeAnalyses.delete(repoId);
  const io = getIO();
  io.to(`repo:${repoId}`).emit('violations:ready', { repoId, analysisId });
}

export function emitAnalysisCanceled(repoId: string): void {
  activeAnalyses.delete(repoId);
  const io = getIO();
  io.to(`repo:${repoId}`).emit('analysis:canceled', { repoId });
}
