import type { Server as SocketServer, Socket } from 'socket.io';
import { getIO } from './index.js';
import { DOMAIN_ORDER, CODE_DOMAINS, DEFAULT_DOMAINS } from '@truecourse/shared';
import { log } from '../lib/logger.js';

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

// Track in-progress analyses so we can inform clients that join mid-analysis
const activeAnalyses = new Map<string, AnalysisProgressPayload>();


export function setupHandlers(io: SocketServer): void {
  io.on('connection', (socket: Socket) => {
    log.info(`[Socket] Client connected: ${socket.id}`);

    socket.on('joinRepo', async (repoId: string) => {
      const room = `repo:${repoId}`;
      await socket.join(room);
      log.info(`[Socket] ${socket.id} joined room ${room}`);

      // If analysis is already running for this repo, send current progress
      const progress = activeAnalyses.get(repoId);
      if (progress) {
        socket.emit('analysis:progress', { repoId, ...progress });
      }


    });

    socket.on('leaveRepo', async (repoId: string) => {
      const room = `repo:${repoId}`;
      await socket.leave(room);
      log.info(`[Socket] ${socket.id} left room ${room}`);
    });

    socket.on('disconnect', () => {
      log.info(`[Socket] Client disconnected: ${socket.id}`);
    });
  });
}

// ---------------------------------------------------------------------------
// StepTracker — manages a checklist of analysis phases and emits progress.
// The emitter is caller-provided so the CLI can render to stdout while the
// server wires it through Socket.io via `createSocketTracker()`.
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

/** Build a StepTracker that emits into the repo's Socket.io room. */
export function createSocketTracker(
  repoId: string,
  stepDefs: { key: string; label: string }[],
): StepTracker {
  return new StepTracker((payload) => emitAnalysisProgress(repoId, payload), stepDefs);
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
