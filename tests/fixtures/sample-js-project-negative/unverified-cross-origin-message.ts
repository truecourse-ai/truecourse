// A browser message listener that trusts any origin: it reads event.data and
// acts on it without checking event.origin against a trusted list, so any
// window (a malicious iframe or opener) can drive it.

export function registerMessageBridge(handle: (data: unknown) => void): void {
  // VIOLATION: security/deterministic/unverified-cross-origin-message
  window.addEventListener("message", (event) => {
    handle(event.data);
  });
}
