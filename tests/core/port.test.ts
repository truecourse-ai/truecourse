import { describe, it, expect } from 'vitest';
import net from 'node:net';
import {
  tryBind,
  findFreePort,
  DEFAULT_PORT_CANDIDATES,
} from '../../packages/core/src/lib/port';

function holdPort(port: number): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      const addr = server.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, port: actual });
    });
  });
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('port utility', () => {
  describe('tryBind', () => {
    it('returns the bound port when port is free', async () => {
      // Use port 0 to let the OS pick a guaranteed-free port for the assertion.
      const result = await tryBind(0);
      expect(result).not.toBe(false);
      expect(typeof result).toBe('number');
      expect(result).toBeGreaterThan(0);
    });

    it('returns false when port is already held', async () => {
      const { server, port } = await holdPort(0);
      try {
        const result = await tryBind(port);
        expect(result).toBe(false);
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('findFreePort', () => {
    it('returns the first candidate if it is free', async () => {
      // Use port 0 as the sole candidate — guaranteed free, OS picks.
      const port = await findFreePort([0]);
      expect(port).toBeGreaterThan(0);
    });

    it('skips taken candidates and returns the next free one', async () => {
      const { server, port: takenPort } = await holdPort(0);
      try {
        // First candidate is held; second is 0 (OS-assigned, always works).
        const chosen = await findFreePort([takenPort, 0]);
        expect(chosen).not.toBe(takenPort);
        expect(chosen).toBeGreaterThan(0);
      } finally {
        await closeServer(server);
      }
    });

    it('falls back to OS-assigned port when all candidates fail', async () => {
      const { server, port: takenPort } = await holdPort(0);
      try {
        // Only candidate is held; should fall through to port 0 internally.
        const chosen = await findFreePort([takenPort]);
        expect(chosen).not.toBe(takenPort);
        expect(chosen).toBeGreaterThan(0);
      } finally {
        await closeServer(server);
      }
    });
  });

  describe('DEFAULT_PORT_CANDIDATES', () => {
    it('exposes a non-empty list of candidates', () => {
      expect(DEFAULT_PORT_CANDIDATES.length).toBeGreaterThan(0);
      for (const p of DEFAULT_PORT_CANDIDATES) {
        expect(p).toBeGreaterThan(1023);
        expect(p).toBeLessThan(65536);
      }
    });

    it('does not include the legacy default port 3001', () => {
      expect(DEFAULT_PORT_CANDIDATES).not.toContain(3001);
    });
  });
});
