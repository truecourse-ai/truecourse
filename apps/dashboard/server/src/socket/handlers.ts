import type { Server as SocketServer, Socket } from 'socket.io';
import { getIO } from './index.js';
import { log } from '@truecourse/core/lib/logger';
import {
  StepTracker,
  type AnalysisProgressPayload,
} from '@truecourse/core/progress';
import { SessionCommandSchema } from '@truecourse/agent-loop';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { acquireRunsWatch, releaseRunsWatch } from '../services/run-watch.service.js';

// Track in-progress runs so a client joining mid-run gets the current step.
const activeSpec = new Map<string, AnalysisProgressPayload>();

// The runs watches each socket holds via joinRepo (repoId → repoPath), released
// on leaveRepo/disconnect so an abandoned viewer never pins one.
const heldRunsWatches = new Map<string, Map<string, string>>();


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

      // Follow the repository's runs so any run write prompts the room to
      // re-read its runs list — no page refresh.
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

    socket.on('disconnect', () => {
      log.info(`[Socket] Client disconnected: ${socket.id}`);
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
