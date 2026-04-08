/**
 * React performance patterns — memoization, inline props, cleanup.
 */

import React, { useEffect, useState } from 'react';

function ListItem({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={onClick}>{label}</button>;
}

// VIOLATION: performance/deterministic/inline-function-in-jsx-prop
export function InlineCallback({ items }: { items: string[] }) {
  return (
    <div>
      {items.map((item) => (
        <ListItem key={item} onClick={() => console.log(item)} label={item} />
      ))}
    </div>
  );
}

// VIOLATION: performance/deterministic/inline-object-in-jsx-prop
export function InlineStyle() {
  return <div style={{ color: 'red', fontSize: 14 }}>Styled</div>;
}

// VIOLATION: performance/deterministic/missing-cleanup-useeffect
export function TimerComponent() {
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('tick');
    }, 1000);
  }, []);

  return <div>Timer</div>;
}

// VIOLATION: performance/deterministic/event-listener-no-remove
export function ResizeListener() {
  useEffect(() => {
    window.addEventListener('resize', () => {
      console.log('resized');
    });
  }, []);

  return <div>Resizable</div>;
}

// VIOLATION: performance/deterministic/state-update-in-loop
export function BatchUpdate({ items }: { items: string[] }) {
  const [processed, setProcessed] = useState<string[]>([]);

  useEffect(() => {
    for (const item of items) {
      setProcessed((prev) => [...prev, item]);
    }
  }, [items]);

  return <div>{processed.length}</div>;
}

// VIOLATION: performance/deterministic/missing-usememo-expensive
export function ExpensiveFilter({ items }: { items: Array<{ active: boolean; name: string }> }) {
  const activeItems = items.filter((item) => item.active);
  return <ul>{activeItems.map((i) => <li key={i.name}>{i.name}</li>)}</ul>;
}

// VIOLATION: performance/deterministic/unnecessary-context-provider
const ThemeContext = React.createContext('light');
export function SingleChildProvider() {
  return (
    <ThemeContext.Provider value="dark">
      <div>Only child</div>
    </ThemeContext.Provider>
  );
}

// VIOLATION: performance/deterministic/missing-react-memo
export function NoMemoComponent({ count, label }: { count: number; label: string }) {
  const [clicks, setClicks] = useState(0);
  return (
    <div onClick={() => setClicks(clicks + 1)}>
      <span>{label}: {count} (clicks: {clicks})</span>
    </div>
  );
}

// VIOLATION: code-quality/deterministic/react-unstable-key
export function IndexKeyList({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

// VIOLATION: code-quality/deterministic/react-leaked-render
export function LeakedNumber({ count }: { count: number }) {
  return (
    <div>
      {count && <span>Count: {count}</span>}
    </div>
  );
}
