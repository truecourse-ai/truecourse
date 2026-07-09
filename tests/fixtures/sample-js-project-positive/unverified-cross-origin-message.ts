// A server-side WebSocket connection (the Node `ws` library) attaching a
// `message` handler. This is not a browser `window.postMessage` channel — the
// socket is already authenticated and there is no window origin to verify — so
// flagging it as an unverified cross-origin message is a false positive.

interface ServerSocket {
  addEventListener(_event: string, _handler: (payload: unknown) => void): void;
}

export function attachSocketHandlers(
  socket: ServerSocket,
  onMessage: (payload: unknown) => void,
): void {
  socket.addEventListener("message", onMessage);
}
