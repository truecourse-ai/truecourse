// React `useRef` "lock" pattern: setting the ref's `.current` flag, awaiting
// some work, then clearing it. The first assignment is observable by
// re-entrant async callers via the ref's shared mutable state, so this is
// not a wasted overwrite.

type RefStub<T> = { current: T };

export async function runOnce<T>(
  lockRef: RefStub<boolean>,
  queueRef: RefStub<T[]>,
  handle: (items: readonly T[]) => Promise<void>,
): Promise<void> {
  if (lockRef.current || queueRef.current.length === 0) return;

  lockRef.current = true;
  const pending = queueRef.current;
  queueRef.current = [];
  await handle(pending);
  lockRef.current = false;
}
