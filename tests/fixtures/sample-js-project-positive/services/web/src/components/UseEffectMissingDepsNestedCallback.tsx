/**
 * Positive fixture for bugs/deterministic/useeffect-missing-deps.
 *
 * The visitor previously walked into nested callbacks defined INSIDE the
 * effect and collected their parameter names (e.g. `prev` in
 * `setTicks((prev) => …)`, `item` in `arr.map((item) => …)`) as
 * identifiers the closure was "missing". Callback args are not
 * closure-captured deps — they're locally bound by the inner function.
 */

import { useEffect, useState } from 'react';

export function Ticker(): JSX.Element {
  const [ticks, setTicks] = useState<number[]>([]);

  useEffect(() => {
    const id = setInterval(() => {
      setTicks((prev) => [...prev, prev.length]);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return <div>{ticks.length}</div>;
}
