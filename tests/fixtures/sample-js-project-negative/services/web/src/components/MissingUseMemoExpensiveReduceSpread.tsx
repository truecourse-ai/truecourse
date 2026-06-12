// Paraphrased true-bug for performance/deterministic/missing-usememo-expensive.
//
// A `.reduce()` whose callback is a non-trivial chain — here a `.sort()`
// + spread copy per item — runs O(N log N) per render. Wrapping in
// useMemo gives a stable reference across renders.

import React from 'react';

interface Bucket {
  id: string;
  scores: number[];
}

export function BucketRanking({ buckets }: { buckets: readonly Bucket[] }) {
  // VIOLATION: performance/deterministic/missing-usememo-expensive
  const sorted = buckets.sort((a, b) => a.scores.length - b.scores.length);

  return (
    <ul>
      {sorted.map((b) => (
        <li key={b.id}>{b.id}: {b.scores.length}</li>
      ))}
    </ul>
  );
}
