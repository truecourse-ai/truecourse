// Evaluating a caller-supplied string with the global `eval()` runs
// arbitrary code — a real injection risk. This is the genuine bug the
// rule should catch: a bare `eval(...)` identifier call, not a method
// named `eval` on some object.
export function computeExpression(userInput: string): unknown {
  // VIOLATION: security/deterministic/eval-usage
  return eval(userInput);
}
