import React from 'react';

declare function useSuspenseQuery<T>(opts: { queryKey: string[]; queryFn: () => Promise<T> }): { data: T };

// VIOLATION: bugs/deterministic/missing-error-boundary
export function SuspenseQueryView() {
  const { data } = useSuspenseQuery<{ title: string }>({
    queryKey: ['x'],
    queryFn: () => fetch('/api/x').then((r) => r.json() as Promise<{ title: string }>),
  });
  return <h1>{data.title}</h1>;
}
