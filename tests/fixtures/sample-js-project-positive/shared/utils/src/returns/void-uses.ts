// Aggregated fixture for natural rule shape coverage.

// shape b6a3f062: void-return-value-used — assigning void function result
function performSideEffect_b6a3f062(input: number): void {
  void input;
}
export const usedVoid_b6a3f062: unknown = performSideEffect_b6a3f062(1) as unknown;

