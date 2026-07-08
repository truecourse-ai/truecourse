// Existence guards on possibly-undefined promises. `if (x)` here asks "has
// this promise been created yet?", not "is the resolved value truthy?" — the
// value can legitimately be `undefined`, so the check is meaningful and must
// NOT trip bugs/deterministic/misused-promise.

interface LoaderState {
  pending?: Promise<void>
}

export function ensureLoaded(state: LoaderState): Promise<void> {
  if (state.pending) {
    return state.pending
  }
  const started = Promise.resolve()
  state.pending = started
  return started
}

export function pickPending(
  primary: Promise<number> | undefined,
  fallback: Promise<number>,
): Promise<number> {
  if (primary) {
    return primary
  }
  return fallback
}
