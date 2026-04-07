/**
 * Additional React bug violations.
 */
import React, { useState, useEffect } from 'react';

// VIOLATION: bugs/deterministic/useeffect-missing-deps
// useEffect with empty deps array but references state variables — stale closures
export function UseEffectMissingDeps({ userId }: { userId: string }) {
  const [data, setData] = useState(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    fetch(`/api/users/${userId}`).then(r => r.json()).then(setData);
    console.log(count);
  }, []);

  return <div>{count}</div>;
}

// VIOLATION: bugs/deterministic/missing-error-boundary
// Component uses useQuery for async data fetching but has no error boundary wrapper
export function DataFetchingComponent() {
  const result = useQuery({ queryKey: ['items'], queryFn: () => fetch('/api/items') });
  return <div>{JSON.stringify(result.data)}</div>;
}

declare function useQuery(opts: any): any;
