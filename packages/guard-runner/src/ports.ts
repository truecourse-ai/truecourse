/**
 * Loopback ports for one run's servers and stubs.
 *
 * The kernel picks a port on `bind(0)`, and once that socket closes it may pick
 * the SAME number for the next `bind(0)`. A child server cannot be handed an
 * open socket, so its port is picked that way and the socket closed before the
 * child boots — and in that gap an in-process stub binding to 0 can land on it.
 * The child then dies with EADDRINUSE and its health probe reaches the stub.
 *
 * So every port picked for a child is HELD here until that child is gone, and
 * every in-process listen re-binds when the kernel lands it on a held port.
 * One process is one run, which is why the set is module-wide.
 *
 * The hold reaches only THIS process. Between the pick and the child's own bind
 * the number belongs to nobody, so a sibling worker, a browser or any other
 * process on the host can take it, which is what {@link portIsFree} is for: a
 * boot that died before its health answer asks whether its port is now someone
 * else's, and that answer is what separates a lost race from a crash.
 */

import net from 'node:net'

const held = new Set<number>()

/** Bind-to-0 attempts before giving up, each landing on a held port. */
const ATTEMPTS = 16

/** One `bind(0)`: the port the kernel picked, with the socket closed again. */
function pickEphemeral(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      if (address === null || typeof address === 'string') {
        srv.close()
        reject(new Error('could not allocate a port'))
        return
      }
      const { port } = address
      srv.close(() => resolve(port))
    })
  })
}

/**
 * A free localhost port for a child process to listen on. Held until
 * {@link releasePort}, so nothing else this process starts meanwhile takes it.
 */
export async function allocateFreePort(): Promise<number> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const port = await pickEphemeral()
    if (held.has(port)) continue
    held.add(port)
    return port
  }
  throw new Error(`could not allocate a free port in ${ATTEMPTS} attempts`)
}

/** The child that owned the port is gone; the number may be picked again. */
export function releasePort(port: number): void {
  held.delete(port)
}

/** Whether a child still owns the port. */
export function isPortHeld(port: number): boolean {
  return held.has(port)
}

/**
 * Whether the port can still be bound on loopback. False means something else
 * is listening on it RIGHT NOW, the one observation that tells a boot which
 * died before its health answer that it lost its port rather than crashed.
 *
 * Only EADDRINUSE answers false: any other refusal says nothing about an owner,
 * and a boot must not re-try itself on a guess.
 */
export function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.unref()
    srv.once('error', (err: NodeJS.ErrnoException) => resolve(err.code !== 'EADDRINUSE'))
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(true))
    })
  })
}

/**
 * Listen on an ephemeral loopback port that no booting child owns. The server
 * keeps its socket, so the kernel never hands its port to anyone else.
 */
export function listenEphemeral(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    let attempt = 0
    const onError = (err: Error) => reject(err)
    const tryListen = () => {
      attempt += 1
      server.once('error', onError)
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', onError)
        const address = server.address()
        const port = address && typeof address !== 'string' ? address.port : null
        if (port !== null && held.has(port) && attempt < ATTEMPTS) {
          server.close(tryListen)
          return
        }
        resolve()
      })
    }
    tryListen()
  })
}
