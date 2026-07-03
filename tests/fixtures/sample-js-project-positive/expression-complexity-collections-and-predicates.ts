/**
 * Positive fixture for code-quality/deterministic/expression-complexity.
 *
 * Three shapes that the operator counter over-reports but that do not benefit
 * from being split into named variables:
 *   1. A flat boolean predicate list (membership / guard test) joined by a
 *      single logical operator, with no arithmetic.
 *   2. An object literal whose independent property values happen to contain
 *      operators (a perf-timing map).
 *   3. An array literal of independent elements.
 * The keys / positions already name the parts, and a flat predicate reads as
 * one membership test, so none of these is tangled logic.
 */

export function isNumericKind(kind: string): boolean {
  return (
    kind.startsWith("Int") ||
    kind.startsWith("UInt") ||
    kind.startsWith("Float") ||
    kind === "Decimal" ||
    kind === "Numeric" ||
    kind === "Currency" ||
    kind === "Percent"
  );
}

export function timingReport(marks: readonly number[]): Record<string, number> {
  return {
    parse: marks[1] - marks[0],
    plan: marks[2] - marks[1],
    exec: marks[3] - marks[2],
    fetch: marks[4] - marks[3],
    encode: marks[5] - marks[4],
    flush: marks[6] - marks[5],
  };
}

export function collectFlags(input: Record<string, boolean | undefined>): boolean[] {
  return [
    input.a ?? false,
    input.b ?? false,
    input.c ?? false,
    input.d ?? false,
    input.e ?? false,
    input.f ?? false,
  ];
}
