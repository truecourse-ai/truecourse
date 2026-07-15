import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { setRepoLifecycleEmitter } from '@truecourse/core/lib/repo-lifecycle';
import { setupHandlers } from './handlers.js';
import { productionRepoLifecycleEmitter } from './repo-lifecycle.js';

let io: SocketServer | null = null;

export function setupSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  setupHandlers(io);
  // Background jobs (EE) announce settled scans/generates/runs through the core
  // repo-lifecycle seam; route them into the repo's room as `spec:complete` so
  // open tabs refresh live. Inert in OSS — nothing calls the seam there.
  setRepoLifecycleEmitter(productionRepoLifecycleEmitter());

  return io;
}

export function getIO(): SocketServer {
  if (!io) {
    throw new Error('Socket.io not initialized. Call setupSocket first.');
  }
  return io;
}
