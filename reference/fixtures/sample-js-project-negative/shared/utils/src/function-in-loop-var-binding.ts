// Negative cases: classical `var` loop bindings and a `while` loop both
// carry the capture-by-reference hazard — a function defined inside must
// still be flagged.

export function makeVarOfHandlers(items: readonly string[]): Array<() => string> {
  const out: Array<() => string> = [];
  for (var item of items) {
    // VIOLATION: code-quality/deterministic/function-in-loop
    const handler = function (): string { return item; };
    out.push(handler);
  }
  return out;
}

export function makeWhileHandlers(limit: number): Array<() => number> {
  const out: Array<() => number> = [];
  let counter = 0;
  while (counter < limit) {
    // VIOLATION: code-quality/deterministic/function-in-loop
    const handler = function (): number { return counter; };
    out.push(handler);
    counter = counter + 1;
  }
  return out;
}
