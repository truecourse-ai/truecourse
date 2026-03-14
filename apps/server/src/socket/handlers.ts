import type { Server as SocketServer, Socket } from 'socket.io';
import { getIO } from './index.js';

export function setupHandlers(io: SocketServer): void {
  io.on('connection', (socket: Socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    socket.on('joinRepo', async (repoId: string) => {
      const room = `repo:${repoId}`;
      await socket.join(room);
      console.log(`[Socket] ${socket.id} joined room ${room}`);
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
