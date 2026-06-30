import type { Server as SocketServer, Socket } from 'socket.io';
import { getIO } from './index.js';
import { log } from '@truecourse/core/lib/logger';
import {
  StepTracker,
  type AnalysisProgressPayload,
} from '@truecourse/core/progress';
import type { LlmEstimate } from '@truecourse/core/commands/analyze-in-process';

// Track in-progress analyses so we can inform clients that join mid-analysis
const activeAnalyses = new Map<string, AnalysisProgressPayload>();
// Same idea for BL Drift's Spec scan/apply.
const activeSpec = new Map<string, AnalysisProgressPayload>();


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
      const specProgress = activeSpec.get(repoId);
      if (specProgress) {
        socket.emit('spec:progress', { repoId, ...specProgress });
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

/**
 * Build an `onLlmEstimate` callback that prompts via sockets: emits
 * `analysis:llm-estimate` to the repo room, waits for `analysis:llm-proceed`
 * (60s timeout → default `true`), then emits `analysis:llm-resolved`.
 *
 * Shared by `POST /api/repos/:id/analyze` and `POST /api/repos/:id/diff-check`
 * so dashboard-initiated analyze and diff both prompt identically — and the
 * web `useSocket` listener handles both without any client-side branching.
 */
export function createSocketLlmEstimateHandler(repoId: string):
  (estimate: {
    totalEstimatedTokens: number;
    tiers: { tier: string; ruleCount: number; fileCount: number; functionCount?: number; estimatedTokens: number }[];
    uniqueFileCount?: number;
    uniqueRuleCount?: number;
  }) => Promise<boolean> {
  return (estimate) =>
    new Promise<boolean>((resolve) => {
      const io = getIO();
      const room = `repo:${repoId}`;

      io.to(room).emit('analysis:llm-estimate', {
        repoId,
        estimate: {
          totalEstimatedTokens: estimate.totalEstimatedTokens,
          tiers: estimate.tiers,
          uniqueFileCount: estimate.uniqueFileCount,
          uniqueRuleCount: estimate.uniqueRuleCount,
        },
      });

      const timeout = setTimeout(() => {
        cleanup();
        resolve(true);
      }, 60_000);

      function onProceed(data: { repoId: string; proceed: boolean }) {
        if (data.repoId !== repoId) return;
        cleanup();
        io.to(room).emit('analysis:llm-resolved', { repoId, proceed: data.proceed });
        resolve(data.proceed);
      }

      function cleanup() {
        clearTimeout(timeout);
        for (const [, socket] of io.sockets.sockets) {
          socket.removeListener('analysis:llm-proceed', onProceed);
        }
      }

      for (const [, socket] of io.sockets.sockets) {
        socket.on('analysis:llm-proceed', onProceed);
      }
    });
}

/**
 * Build a stash-decision callback that prompts via sockets: emits
 * `analysis:stash-confirm-request` to the repo room, then resolves with the
 * client's choice from `analysis:stash-confirm-response`.
 *
 * Mirrors the CLI's `resolveStashDecision`: three outcomes — stash, no-stash,
 * cancel. Caller (route) translates these into `skipStash` for `analyzeInProcess`
 * or aborts the run on cancel. No timeout — matches the LLM estimate handler's
 * behavior of blocking until the user answers.
 */
export type StashConfirmChoice = 'stash' | 'no-stash' | 'cancel';

export function createSocketStashConfirmHandler(repoId: string):
  (info: { modifiedCount: number; untrackedCount: number }) => Promise<StashConfirmChoice> {
  return (info) =>
    new Promise<StashConfirmChoice>((resolve) => {
      const io = getIO();
      const room = `repo:${repoId}`;

      io.to(room).emit('analysis:stash-confirm-request', {
        repoId,
        modifiedCount: info.modifiedCount,
        untrackedCount: info.untrackedCount,
      });

      function onResponse(data: { repoId: string; choice: StashConfirmChoice }) {
        if (data.repoId !== repoId) return;
        cleanup();
        resolve(data.choice);
      }

      function cleanup() {
        for (const [, socket] of io.sockets.sockets) {
          socket.removeListener('analysis:stash-confirm-response', onResponse);
        }
      }

      for (const [, socket] of io.sockets.sockets) {
        socket.on('analysis:stash-confirm-response', onResponse);
      }
    });
}

/**
 * `onLlmEstimate` for `spec scan` / `contracts generate`: reuses the analyze
 * estimate event + client modal (the payload is the same `LlmEstimate`, now
 * carrying an optional per-stage breakdown). Unlike the analyze handler, it does
 * NOT default to `true` after a short timeout — scan/generate are expensive and
 * entirely LLM-driven, so a forgotten dialog must NOT auto-spend. It blocks until
 * the user answers, with a long backstop that aborts (resolves `false`).
 */
export function createSocketSpecEstimateHandler(
  repoId: string,
): (estimate: LlmEstimate) => Promise<boolean> {
  return (estimate) =>
    new Promise<boolean>((resolve) => {
      const io = getIO();
      const room = `repo:${repoId}`;

      io.to(room).emit('analysis:llm-estimate', { repoId, estimate });

      // Backstop: abort (not proceed) if unanswered for 10 minutes.
      const timeout = setTimeout(() => {
        cleanup();
        io.to(room).emit('analysis:llm-resolved', { repoId, proceed: false });
        resolve(false);
      }, 600_000);

      function onProceed(data: { repoId: string; proceed: boolean }) {
        if (data.repoId !== repoId) return;
        cleanup();
        io.to(room).emit('analysis:llm-resolved', { repoId, proceed: data.proceed });
        resolve(data.proceed);
      }

      function cleanup() {
        clearTimeout(timeout);
        for (const [, socket] of io.sockets.sockets) {
          socket.removeListener('analysis:llm-proceed', onProceed);
        }
      }

      for (const [, socket] of io.sockets.sockets) {
        socket.on('analysis:llm-proceed', onProceed);
      }
    });
}

// ---------------------------------------------------------------------------
// BL Drift / Spec progress
// ---------------------------------------------------------------------------

/** Build a StepTracker that emits spec progress into the repo's room. */
export function createSocketSpecTracker(
  repoId: string,
  stepDefs: { key: string; label: string }[],
): StepTracker {
  return new StepTracker((payload) => emitSpecProgress(repoId, payload), stepDefs);
}

export function emitSpecProgress(
  repoId: string,
  progress: AnalysisProgressPayload,
): void {
  if (progress.step === 'error') {
    activeSpec.delete(repoId);
  } else {
    activeSpec.set(repoId, progress);
  }
  const io = getIO();
  io.to(`repo:${repoId}`).emit('spec:progress', { repoId, ...progress });
}

export function emitSpecComplete(
  repoId: string,
  kind: 'scan' | 'apply' | 'verify' | 'generate' | 'infer',
): void {
  activeSpec.delete(repoId);
  const io = getIO();
  io.to(`repo:${repoId}`).emit('spec:complete', { repoId, kind });
}
