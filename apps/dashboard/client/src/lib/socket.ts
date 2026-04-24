import { io, Socket } from 'socket.io-client';
import { getServerUrl } from './server-url';

const SOCKET_URL = getServerUrl() || (typeof window !== 'undefined' ? window.location.origin : '');

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
}

export function disconnectSocket(): void {
  if (socket?.connected) {
    socket.disconnect();
  }
}

export function joinRepoRoom(repoId: string): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('joinRepo', repoId);
  }
}

export function leaveRepoRoom(repoId: string): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('leaveRepo', repoId);
  }
}
