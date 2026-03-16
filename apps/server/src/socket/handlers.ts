import type { Server as SocketServer, Socket } from 'socket.io';
import { getIO } from './index.js';

// Track in-progress analyses so we can inform clients that join mid-analysis
const activeAnalyses = new Map<string, { step: string; percent: number; detail?: string }>();

export function setupHandlers(io: SocketServer): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    socket.on('joinRepo', async (repoId: string) => {
      const room = `repo:${repoId}`;
      await socket.join(room);
      console.log(`[Socket] ${socket.id} joined room ${room}`);

      // If analysis is already running for this repo, send current progress
      const progress = activeAnalyses.get(repoId);
      if (progress) {
        socket.emit('analysis:progress', { repoId, ...progress });
      }
    });

    socket.on('leaveRepo', async (repoId: string) => {
      const room = `repo:${repoId}`;
      await socket.leave(room);
      console.log(`[Socket] ${socket.id} left room ${room}`);
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
