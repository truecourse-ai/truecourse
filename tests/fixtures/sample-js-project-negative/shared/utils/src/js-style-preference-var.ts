function legacyAccumulator(): number {
  // VIOLATION: style/deterministic/js-style-preference
  var total = 0;
  total += 1;
  return total;
}

export const accumulated = legacyAccumulator();
