// Negative cases that the rule must still catch after the spread-attribute
// and JSX-expression-child fixes.

import { createContext } from 'react';

type LeafValue = { label: string };
const LeafCtx = createContext<LeafValue>({ label: '' });

// True bug: Provider wraps a single bare host element with NO spread and
// NO inner content — context cannot be consumed by anyone. Props would suffice.
// VIOLATION: performance/deterministic/unnecessary-context-provider
export function LeafProviderEmpty(): JSX.Element {
  return (
    <LeafCtx.Provider value={{ label: 'x' }}>
      <span className="leaf" />
    </LeafCtx.Provider>
  );
}
