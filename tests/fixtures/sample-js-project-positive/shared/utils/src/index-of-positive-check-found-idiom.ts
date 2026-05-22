// Paraphrased FP shape for bugs/deterministic/index-of-positive-check.
//
// `lastIndexOf(x) >= 0` and `lastIndexOf(x) < 0` are the correct
// found / not-found idioms — both include index 0 in the "found" set.
// The rule should only flag patterns that exclude valid array indexes
// (e.g. `> 0`, `>= 1`).
//
// Uses `lastIndexOf` to demonstrate the same visitor branch without
// colliding with the prefer-includes rule (which only flags `indexOf`).

type Node = { id: string };

export function isLastSelected(selected: ReadonlyArray<Node>, node: Node): boolean {
  return selected.lastIndexOf(node) >= 0;
}

export function isLastUnselected(selected: ReadonlyArray<Node>, node: Node): boolean {
  return selected.lastIndexOf(node) < 0;
}
