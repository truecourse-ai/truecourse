// Aggregated fixture for natural rule shape coverage.

// shape 298a588a: inconsistent-return — some branches return value, some void
export function decideValue_298a588a(n: number): number | undefined {
  if (n > 0) return n * 2;
  if (n < 0) return;
  return 0;
}


// shape 1f2a5efe: inconsistent-return — some branches return value, some void
export function decideValue_1f2a5efe(n: number): number | undefined {
  if (n > 0) return n * 2;
  if (n < 0) return;
  return 0;
}


// shape 4003d78d: inconsistent-return — some branches return value, some void
export function decideValue_4003d78d(n: number): number | undefined {
  if (n > 0) return n * 2;
  if (n < 0) return;
  return 0;
}

