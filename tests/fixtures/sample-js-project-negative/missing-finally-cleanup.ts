// A raw connection is opened inside the try and never released. There is no
// `finally`, and the throwing path performs no cleanup, so an exception after
// the open leaks the connection.
declare function createConnection(opts: { host: string; port: number }): {
  readable: boolean;
  destroy(): void;
};

export function probe(host: string, port: number): boolean {
  // VIOLATION: reliability/deterministic/missing-finally-cleanup
  try {
    const socket = createConnection({ host, port });
    return socket.readable;
  } catch {
    return false;
  }
}
