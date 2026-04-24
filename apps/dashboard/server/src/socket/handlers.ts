import type { Server as SocketServer, Socket } from 'socket.io';
import { getIO } from './index.js';
import { log } from '@truecourse/core/lib/logger';
import {
  StepTracker,
  type AnalysisProgressPayload,
} from '@truecourse/core/progress';

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
