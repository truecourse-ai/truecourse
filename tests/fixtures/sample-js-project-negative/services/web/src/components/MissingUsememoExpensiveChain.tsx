import React from 'react';

type Entry = { id: number; active: boolean; tag: string; priority: number };

// VIOLATION: performance/deterministic/missing-usememo-expensive
export function MultiStageChain({ entries }: { entries: Entry[] }) {
  const result = entries
    .filter((e) => e.active)
    .map((e) => ({ key: e.tag, weight: e.priority }))
    .filter((e) => e.weight > 0);
  return <ul>{result.map((r) => <li key={r.key}>{r.weight}</li>)}</ul>;
}
