import net from 'node:net';

export const DEFAULT_PORT_CANDIDATES = [47821, 47822, 47823, 8731, 8732, 9341];

/**
 * Try each candidate port in order; return the first one that binds cleanly
 * on 127.0.0.1. Falls back to an OS-assigned port (listen on 0) if every
 * candidate is taken or reserved.
 *
 * Why: on Windows, Hyper-V / Docker Desktop reserve dynamic TCP port ranges
 * via WinNAT. Reserved ports surface as EACCES when you try to bind them,
 * shifting between reboots. A pre-bind probe is the only way to observe the
 * live reservation set.
 */
export async function findFreePort(candidates: number[] = DEFAULT_PORT_CANDIDATES): Promise<number> {
  for (const p of candidates) {
    const bound = await tryBind(p);
    if (bound !== false) return bound;
  }
  const osPicked = await tryBind(0);
  if (osPicked !== false) return osPicked;
  throw new Error('Unable to find any free TCP port to bind on 127.0.0.1');
}

/**
 * Attempt to bind a temporary server on 127.0.0.1 at `port` (0 means
 * OS-assigned). Resolves to the bound port on success, or `false` on failure
 * (EADDRINUSE / EACCES / etc). The probe socket is closed before resolving.
 */
export function tryBind(port: number): Promise<number | false> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      const addr = srv.address();
      const actual = typeof addr === 'object' && addr ? addr.port : port;
      srv.close(() => resolve(actual));
    });
  });
}
