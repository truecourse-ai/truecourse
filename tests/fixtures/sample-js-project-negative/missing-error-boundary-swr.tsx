// A React component that fetches async data with a bare useSWR hook whose
// promise can reject during render, yet nothing upstream catches a render
// failure. A failed fetch will crash the whole component tree.

import type { ReactElement } from "react";

declare function useSWR<T>(
  key: string,
  fetcher: (key: string) => Promise<T>,
): { data: T | undefined };

// VIOLATION: bugs/deterministic/missing-error-boundary
export function DashboardStats(): ReactElement {
  const { data } = useSWR<{ total: number }>("/api/stats", (k) =>
    fetch(k).then((r) => r.json() as Promise<{ total: number }>),
  );
  return <div>{data?.total}</div>;
}
