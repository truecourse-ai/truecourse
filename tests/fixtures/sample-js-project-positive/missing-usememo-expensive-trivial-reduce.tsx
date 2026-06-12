// Paraphrased positive fixture for performance/deterministic/missing-usememo-expensive.
//
// A `.reduce()` whose callback is a single binary expression on the two
// parameters (`(sum, v) => sum + v`) is O(1) per item and does not benefit
// from `useMemo` — the rule should not flag it. The expensive shape
// (object-spread accumulator) is the spread-in-reduce case, handled by
// a separate rule.

import { useState } from 'react';

interface AllocationMap {
  values(): Iterable<number>;
}

export function AllocationSummary({
  values,
  allocation,
}: {
  values: number[];
  allocation: AllocationMap;
}): JSX.Element {
  const [label] = useState('total');

  // Sum of an array — trivial accumulator.
  const total = values.reduce((sum, v) => sum + v, 0);

  // Sum across map values — same shape, different source.
  const allocatedInProject = Array.from(allocation.values()).reduce(
    (e, acc) => e + acc,
    0,
  );

  return (
    <div>
      {label}: {total} / Allocated: {allocatedInProject}
    </div>
  );
}
