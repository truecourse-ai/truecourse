import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { setupHandlers } from './handlers.js';

let io: SocketServer | null = null;

export function setupSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  setupHandlers(io);

  return io;
}

export function getIO(): SocketServer {
  if (!io) {
    throw new Error('Socket.io not initialized. Call setupSocket first.');
  }
  return io;
}
