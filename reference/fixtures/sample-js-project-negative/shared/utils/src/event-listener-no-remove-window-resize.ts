// Adding a non-lifecycle listener (e.g. window 'resize') without a paired
// removeEventListener is the actual bug — the listener outlives the caller
// and accumulates on every invocation, leaking memory.

interface DocumentLike {
  addEventListener(type: 'resize', listener: () => void): void;
}

// VIOLATION: performance/deterministic/event-listener-no-remove
export function wireResize(doc: DocumentLike, onResize: () => void): void {
  doc.addEventListener('resize', onResize);
}
