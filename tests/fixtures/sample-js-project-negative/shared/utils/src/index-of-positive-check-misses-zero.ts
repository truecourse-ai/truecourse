// True-bug shape: `indexOf(x) > 0` misses the case where the element is at
// index 0 (it returns false for the first item). The correct found-check is
// `>= 0` or `!== -1`.

type Node = { id: string };

export function isSelectedBuggy(selected: Node[], node: Node): boolean {
  // VIOLATION: bugs/deterministic/index-of-positive-check
  return selected.indexOf(node) > 0;
}
