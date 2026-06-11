import { useState } from "react";

// Calling the state setter directly in the component's render body schedules a
// re-render on every render, producing an infinite update loop. The setter must
// be moved into an effect, an event handler, or a callback.
export function CounterBadge(): JSX.Element {
  const [count, setCount] = useState(0);
  // VIOLATION: code-quality/deterministic/react-hook-setter-in-body
  setCount(count + 1);
  return <span>{count}</span>;
}
