/**
 * A genuine expression-complexity bug: a single return expression
 * chains many arithmetic / comparison / logical operators. Breaking
 * it into named intermediate variables would make the predicate
 * easier to read and debug.
 */

declare const a: number;
declare const b: number;
declare const c: number;
declare const d: number;
declare const e: number;
declare const f: number;
declare const g: number;

// VIOLATION: code-quality/deterministic/expression-complexity
export function evaluateGate(): boolean {
  return a > 0 && b < 10 && c === 0 && (d + e) * f > g && a + b + c + d > 100;
}
