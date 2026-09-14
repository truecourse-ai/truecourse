import type { Server as SocketServer, Socket } from 'socket.io';
import { getIO } from './index.js';
import { log } from '@truecourse/core/lib/logger';
import {
  StepTracker,
  type AnalysisProgressPayload,
} from '@truecourse/core/progress';
import { SessionCommandSchema } from '@truecourse/agent-loop';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import {
  acquireRunTail,
  acquireRunsWatch,
  releaseRunTail,
  releaseRunsWatch,
  type RunTailTarget,
} from '../services/session-tailer.service.js';

// Track in-progress runs so a client joining mid-run gets the current step.
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

// ---------------------------------------------------------------------------
// Run progress
// ---------------------------------------------------------------------------

/** Build a StepTracker that emits run progress into the repo's room. */
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
  kind: 'scan' | 'guard-setup' | 'guard-generate' | 'guard-run' | 'guard-externals',
): void {
  activeSpec.delete(repoId);
  const io = getIO();
  io.to(`repo:${repoId}`).emit('spec:complete', { repoId, kind });
}
