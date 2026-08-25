/**
 * Paraphrased true-bug for bugs/deterministic/unmodified-loop-condition.
 *
 * `done` is never reassigned inside the loop body and the condition is a
 * pure identifier comparison — the loop spins forever. The canonical
 * "forgot to flip the flag" mistake.
 */

export function waitForFlag(): void {
  let done = false;
  // VIOLATION: bugs/deterministic/unmodified-loop-condition
  while (done === false) {
    const sentinel = 1 + 1;
    void sentinel;
  }
}
