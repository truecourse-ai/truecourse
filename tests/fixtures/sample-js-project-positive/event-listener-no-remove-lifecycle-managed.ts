// Event listeners whose lifetime is managed by their target (AbortSignal,
// WebSocket-like sources, or terminal page-lifecycle events) don't need a
// paired removeEventListener call — the host releases them on its own.

interface SignalLike {
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
}

interface SocketLike {
  addEventListener(type: 'open' | 'close' | 'error', listener: (e: unknown) => void): void;
}

export function onAbort(signal: SignalLike, cleanup: () => void): void {
  signal.addEventListener('abort', cleanup, { once: true });
}

export function bindSocket(ws: SocketLike, onOpen: (e: unknown) => void, onClose: (e: unknown) => void, onError: (e: unknown) => void): void {
  ws.addEventListener('open', onOpen);
  ws.addEventListener('close', onClose);
  ws.addEventListener('error', onError);
}

interface FetchOptions {
  signal?: SignalLike;
}

export function wireAbort(options: FetchOptions, onAbortInner: () => void): void {
  options.signal?.addEventListener('abort', onAbortInner);
}

export function fireOnce(target: { addEventListener: (t: string, l: () => void, o?: { once?: boolean }) => void }): void {
  target.addEventListener('custom', () => {}, { once: true });
}
