import type { Server as SocketServer, Socket } from 'socket.io';
import { eq } from 'drizzle-orm';
import { db } from '../config/database.js';
import { repos } from '../db/schema.js';
import { watchRepo, stopWatching } from '../services/watcher.service.js';
import { getIO } from './index.js';

export function setupHandlers(io: SocketServer): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    socket.on('joinRepo', async (repoId: string) => {
      const room = `repo:${repoId}`;
      await socket.join(room);
      console.log(`[Socket] ${socket.id} joined room ${room}`);

      // Look up repo path for file watching
      try {
        const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
        if (repo) {
          watchRepo(repo.path, (changedFiles: string[]) => {
            io.to(room).emit('files:changed', { repoId, changedFiles });
          });
        }
      } catch (err) {
        console.error(`[Socket] Failed to look up repo ${repoId}:`, err);
      }
    });

    socket.on('leaveRepo', async (repoId: string) => {
      const room = `repo:${repoId}`;
      await socket.leave(room);
      console.log(`[Socket] ${socket.id} left room ${room}`);

      const sockets = await io.in(room).fetchSockets();
      if (sockets.length === 0) {
        try {
          const [repo] = await db.select().from(repos).where(eq(repos.id, repoId)).limit(1);
          if (repo) {
            stopWatching(repo.path);
          }
        } catch (err) {
          console.error(`[Socket] Failed to stop watching repo ${repoId}:`, err);
        }
      }
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Client disconnected: ${socket.id}`);
    });
  });
}

export function emitAnalysisProgress(
  repoId: string,
  progress: { step: string; percent: number; detail?: string }
): void {
  const io = getIO();
  io.to(`repo:${repoId}`).emit('analysis:progress', { repoId, ...progress });
}

export function emitAnalysisComplete(
  repoId: string,
  analysisId: string
): void {
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

export function emitInsightsReady(
  repoId: string,
  analysisId: string
): void {
  const io = getIO();
  io.to(`repo:${repoId}`).emit('insights:ready', { repoId, analysisId });
}
