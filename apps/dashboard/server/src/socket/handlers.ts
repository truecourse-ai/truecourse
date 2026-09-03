import type { Server as SocketServer, Socket } from 'socket.io';
import { getIO } from './index.js';
import { log } from '@truecourse/core/lib/logger';
import {
  StepTracker,
  type AnalysisProgressPayload,
} from '@truecourse/core/progress';
import type { LlmEstimate } from '@truecourse/core/commands/analyze-in-process';
import { SessionCommandSchema } from '@truecourse/agent-loop';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  acquireRunTail,
  acquireRunsWatch,
  releaseRunTail,
  releaseRunsWatch,
  type RunTailTarget,
} from '../services/session-tailer.service.js';

// Track in-progress analyses so we can inform clients that join mid-analysis
const activeAnalyses = new Map<string, AnalysisProgressPayload>();
// Same idea for BL Drift's Spec scan/apply.
const activeSpec = new Map<string, AnalysisProgressPayload>();

// The run tails each socket holds (joinRun without leaveRun), released on
// disconnect so an abandoned viewer never pins a watcher.
const heldTails = new Map<string, Map<string, RunTailTarget>>();
// The runs-list watches each socket holds via joinRepo (repoId → repoPath),
// released on leaveRepo/disconnect for the same reason.
const heldRunsWatches = new Map<string, Map<string, string>>();

/** One agent-sessions run's socket room. */
const runRoom = (repoId: string, runId: string): string => `run:${repoId}:${runId}`;


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

      // Watch the repo's sessions store so a CLI-started run (or any run.json
      // rewrite) prompts the room to re-read its runs list — no page refresh.
      try {
        const held = heldRunsWatches.get(socket.id) ?? new Map<string, string>();
        if (!held.has(repoId)) {
          const repoPath = (await resolveProjectForRequest(repoId)).path;
          acquireRunsWatch(repoPath, () =>
            getIO().to(room).emit('session:runs-changed', { repoId }),
          );
          held.set(repoId, repoPath);
          heldRunsWatches.set(socket.id, held);
        }
      } catch {
        // unknown slug — nothing to watch
      }
    });

    socket.on('leaveRepo', async (repoId: string) => {
      const room = `repo:${repoId}`;
      await socket.leave(room);
      log.info(`[Socket] ${socket.id} left room ${room}`);
      const held = heldRunsWatches.get(socket.id);
      const repoPath = held?.get(repoId);
      if (held && repoPath) {
        held.delete(repoId);
        releaseRunsWatch(repoPath);
      }
    });

    // Live tail of one agent-sessions run. The client joins BEFORE its
    // REST snapshot read and dedups by seq, so the tail's from-now-on offsets
    // lose nothing. Payload: { repoId, command, runId }.
    socket.on(
      'joinRun',
      async (payload: { repoId: string; command: string; runId: string }) => {
        const command = SessionCommandSchema.safeParse(payload?.command);
        if (!command.success || !payload.repoId || !payload.runId) return;
        let repoPath: string;
        try {
          repoPath = (await resolveProjectForRequest(payload.repoId)).path;
        } catch {
          return; // unknown slug — nothing to tail
        }
        const { repoId, runId } = payload;
        const target: RunTailTarget = { repoPath, command: command.data, runId };
        await socket.join(runRoom(repoId, runId));
        acquireRunTail(target, {
          onEvent: (sessionId, event) =>
            getIO().to(runRoom(repoId, runId)).emit('session:event', { repoId, runId, sessionId, event }),
          onRunUpdated: (run) =>
            getIO().to(runRoom(repoId, runId)).emit('session:run-updated', { repoId, runId, run }),
        });
        const held = heldTails.get(socket.id) ?? new Map<string, RunTailTarget>();
        held.set(runRoom(repoId, runId), target);
        heldTails.set(socket.id, held);
        log.info(`[Socket] ${socket.id} tailing ${runRoom(repoId, runId)}`);
      },
    );

    socket.on('leaveRun', async (payload: { repoId: string; runId: string }) => {
      if (!payload?.repoId || !payload.runId) return;
      const room = runRoom(payload.repoId, payload.runId);
      await socket.leave(room);
      const held = heldTails.get(socket.id);
      const target = held?.get(room);
      if (held && target) {
        held.delete(room);
        releaseRunTail(target);
      }
    });

    socket.on('disconnect', () => {
      log.info(`[Socket] Client disconnected: ${socket.id}`);
      const held = heldTails.get(socket.id);
      if (held) {
        heldTails.delete(socket.id);
        for (const target of held.values()) releaseRunTail(target);
      }
      const heldWatches = heldRunsWatches.get(socket.id);
      if (heldWatches) {
        heldRunsWatches.delete(socket.id);
        for (const repoPath of heldWatches.values()) releaseRunsWatch(repoPath);
      }
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
 * `onLlmEstimate` for `spec scan`: reuses the analyze estimate event + client
 * modal (the payload is the same `LlmEstimate`, now carrying an optional
 * per-stage breakdown). Unlike the analyze handler, it does NOT default to
 * `true` after a short timeout — a scan is expensive and entirely LLM-driven, so
 * a forgotten dialog must NOT auto-spend. It blocks until the user answers, with
 * a long backstop that aborts (resolves `false`).
 */
export function createSocketSpecEstimateHandler(
  repoId: string,
  signal?: AbortSignal,
): (estimate: LlmEstimate) => Promise<boolean> {
  return (estimate) =>
    new Promise<boolean>((resolve) => {
      const io = getIO();
      const room = `repo:${repoId}`;

      // The scan can be cancelled (repo disconnected) between claiming its
      // slot and reaching this estimate — and addEventListener on an ALREADY
      // aborted signal never fires. Answer "don't proceed" without ever
      // opening the modal, instead of arming listeners nothing will clear.
      if (signal?.aborted) {
        io.to(room).emit('analysis:llm-resolved', { repoId, proceed: false });
        resolve(false);
        return;
      }

      io.to(room).emit('analysis:llm-estimate', { repoId, estimate });

      // Backstop: abort (not proceed) if unanswered for 10 minutes.
      const timeout = setTimeout(() => {
        cleanup();
        io.to(room).emit('analysis:llm-resolved', { repoId, proceed: false });
        resolve(false);
      }, 600_000);

      // The scan was cancelled while the confirm was open (disconnecting the
      // repository is the usual way): answer "don't proceed" and tell the room,
      // so any open estimate modal closes instead of dangling on a dead scan.
      const onAbort = (): void => {
        cleanup();
        io.to(room).emit('analysis:llm-resolved', { repoId, proceed: false });
        resolve(false);
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      function onProceed(data: { repoId: string; proceed: boolean }) {
        if (data.repoId !== repoId) return;
        cleanup();
        io.to(room).emit('analysis:llm-resolved', { repoId, proceed: data.proceed });
        resolve(data.proceed);
      }

      function cleanup() {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
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
  kind?: string,
): StepTracker {
  return new StepTracker(
    (payload) => emitSpecProgress(repoId, kind ? { ...payload, kind } : payload),
    stepDefs,
  );
}

export function emitSpecProgress(
  repoId: string,
  progress: AnalysisProgressPayload & { kind?: string },
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
  kind: 'scan' | 'guard-setup' | 'guard-generate' | 'guard-run' | 'guard-externals' | 'sources',
): void {
  activeSpec.delete(repoId);
  const io = getIO();
  io.to(`repo:${repoId}`).emit('spec:complete', { repoId, kind });
}
