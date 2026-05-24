// True bug: fire-and-forget Promise.all — the call is neither awaited
// nor given a .catch(), so a single rejecting item produces an
// unhandled rejection that never surfaces to the caller.
//
// Not exported on purpose — the visitor fires per-file, and we don't
// want to grow the module graph for the negative-fixture snapshot.

function warmCaches(keys: readonly string[]): void {
  // VIOLATION: reliability/deterministic/promise-all-no-error-handling
  Promise.all(keys.map((key) => warmCache(key)));
}

async function warmCache(key: string): Promise<void> {
  void key;
}

void warmCaches;
