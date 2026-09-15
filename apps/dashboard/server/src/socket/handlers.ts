import type { Server as SocketServer, Socket } from 'socket.io';
import { getIO } from './index.js';
import { log } from '@truecourse/core/lib/logger';
import {
  StepTracker,
  type AnalysisProgressPayload,
} from '@truecourse/core/progress';
import { resolveProjectForRequest } from '@truecourse/core/config/current-project';
import { acquireRunsWatch, releaseRunsWatch } from '../services/run-watch.service.js';

/** What a client sends to follow one repository: the workspace it is signed into and the repo's slug. */
export interface RepoRoomRequest {
  workspaceOrgId: string;
  repoId: string;
}

/**
 * The socket room a repository's events go to. Keyed by the workspace as well
 * as the slug: a slug is unique only within its workspace, so two workspaces
 * holding `acme-api` must not share a room. Every emitter and the join handler
 * derive the name here and nowhere else.
 */
export function repoRoom(workspaceOrgId: string, repoId: string): string {
  return `repo:${workspaceOrgId}:${repoId}`;
}

// Track in-progress runs so a client joining mid-run gets the current step.
const activeSpec = new Map<string, AnalysisProgressPayload>();

// The runs watches each socket holds via joinRepo (room → repoPath), released
// on leaveRepo/disconnect so an abandoned viewer never pins one.
const heldRunsWatches = new Map<string, Map<string, string>>();

function roomRequest(raw: unknown): RepoRoomRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const { workspaceOrgId, repoId } = raw as Partial<RepoRoomRequest>;
  if (typeof workspaceOrgId !== 'string' || typeof repoId !== 'string') return null;
  return { workspaceOrgId, repoId };
}

export function setupHandlers(io: SocketServer): void {
  io.on('connection', (socket: Socket) => {
    log.info(`[Socket] Client connected: ${socket.id}`);

    socket.on('joinRepo', async (raw: unknown) => {
      const asked = roomRequest(raw);
      if (!asked) return;
      const { workspaceOrgId, repoId } = asked;
      const room = repoRoom(workspaceOrgId, repoId);
      await socket.join(room);
      log.info(`[Socket] ${socket.id} joined room ${room}`);

      const specProgress = activeSpec.get(room);
      if (specProgress) {
        socket.emit('spec:progress', { repoId, ...specProgress });
      }

      // Follow the repository's runs so any run write prompts the room to
      // re-read its runs list — no page refresh.
      try {
        const held = heldRunsWatches.get(socket.id) ?? new Map<string, string>();
        if (!held.has(room)) {
          const repoPath = (await resolveProjectForRequest(workspaceOrgId, repoId)).path;
          acquireRunsWatch(repoPath, () =>
            getIO().to(room).emit('session:runs-changed', { repoId }),
          );
          held.set(room, repoPath);
          heldRunsWatches.set(socket.id, held);
        }
      } catch {
        // unknown slug — nothing to watch
      }
    });

    socket.on('leaveRepo', async (raw: unknown) => {
      const asked = roomRequest(raw);
      if (!asked) return;
      const room = repoRoom(asked.workspaceOrgId, asked.repoId);
      await socket.leave(room);
      log.info(`[Socket] ${socket.id} left room ${room}`);
      const held = heldRunsWatches.get(socket.id);
      const repoPath = held?.get(room);
      if (held && repoPath) {
        held.delete(room);
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
  workspaceOrgId: string,
  repoId: string,
  stepDefs: { key: string; label: string }[],
  kind?: string,
): StepTracker {
  return new StepTracker(
    (payload) => emitSpecProgress(workspaceOrgId, repoId, kind ? { ...payload, kind } : payload),
    stepDefs,
  );
}

export function emitSpecProgress(
  workspaceOrgId: string,
  repoId: string,
  progress: AnalysisProgressPayload & { kind?: string },
): void {
  const room = repoRoom(workspaceOrgId, repoId);
  if (progress.step === 'error') {
    activeSpec.delete(room);
  } else {
    activeSpec.set(room, progress);
  }
  const io = getIO();
  io.to(room).emit('spec:progress', { repoId, ...progress });
}

export function emitSpecComplete(
  workspaceOrgId: string,
  repoId: string,
  kind: 'scan' | 'guard-setup' | 'guard-generate' | 'guard-run' | 'guard-externals',
): void {
  const room = repoRoom(workspaceOrgId, repoId);
  activeSpec.delete(room);
  const io = getIO();
  io.to(room).emit('spec:complete', { repoId, kind });
}
