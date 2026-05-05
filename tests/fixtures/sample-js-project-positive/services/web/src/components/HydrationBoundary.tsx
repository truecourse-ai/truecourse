import { useEffect, useState } from 'react';

// Custom hook called at the top of the component.
function useIsHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

interface HydrationBoundaryProps {
  readonly children: () => JSX.Element;
  readonly fallback: JSX.Element;
}

// Hook is called as the CONDITION of a ternary — it runs on every render
// regardless of branch. The conditional-hook rule must not flag this.
// Mirrors documenso's `packages/ui/components/client-only.tsx:9`.
export function HydrationBoundary({ children, fallback }: HydrationBoundaryProps): JSX.Element {
  return useIsHydrated() ? children() : fallback;
}
