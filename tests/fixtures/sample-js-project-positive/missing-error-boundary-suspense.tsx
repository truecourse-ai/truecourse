// A presentational React component that renders a <Suspense> loading boundary
// around streamed children. <Suspense> is itself a boundary for the pending
// state; in a Remix / React Router app the route-level error handling catches
// render failures, so this leaf component must not be flagged just because it
// renders a Suspense fallback.

import { Suspense } from "react";
import type { ReactNode } from "react";

interface StreamPanelProps {
  readonly fallbackText: string;
  readonly children: ReactNode;
}

export function StreamPanel({ fallbackText, children }: StreamPanelProps): JSX.Element {
  return (
    <Suspense fallback={<p>{fallbackText}</p>}>
      {children}
    </Suspense>
  );
}
