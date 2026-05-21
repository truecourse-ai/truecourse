/**
 * Positive fixture for code-quality/deterministic/unnecessary-condition.
 *
 * Closure-mutated flag pattern: a `let` boolean is declared `false`, captured
 * by a callback that mutates it, and read after intervening async work.
 * TypeScript narrows the variable to the literal type `false` because its
 * control-flow analysis only looks at the local scope — it does not see the
 * reassignment in the sibling closure. Flagging the read as a dead-condition
 * is therefore a false positive.
 */

interface Handle {
  dispose(): void;
}

declare function scheduleAt(fn: () => void): Handle;

export async function watchAsync(): Promise<string | null> {
  let isCancelled = false;

  const stop = (): void => {
    isCancelled = true;
  };

  const handle = scheduleAt(stop);

  await Promise.resolve();
  if (isCancelled) {
    return null;
  }
  await Promise.resolve();
  if (isCancelled) {
    handle.dispose();
    return null;
  }

  handle.dispose();
  return 'done';
}
