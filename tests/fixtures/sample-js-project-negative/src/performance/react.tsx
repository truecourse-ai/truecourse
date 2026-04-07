/**
 * Performance violations related to React patterns.
 */

import React, { useEffect, useState } from 'react';

// VIOLATION: performance/deterministic/inline-function-in-jsx-prop
function ListItem({ label, onClick }: { label: string; onClick: () => void }) {
  return <button onClick={onClick}>{label}</button>;
}
export function InlineFunctionComponent({ items }: { items: string[] }) {
  return (
    <div>
      {items.map((item) => (
        <ListItem key={item} onClick={() => console.log(item)} label={item} />
      ))}
    </div>
  );
}

// VIOLATION: performance/deterministic/inline-object-in-jsx-prop
export function InlineObjectComponent() {
  return <div style={{ color: 'red', fontSize: 14 }}>Styled</div>;
}

// VIOLATION: performance/deterministic/missing-cleanup-useeffect
export function MissingCleanupComponent() {
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('tick');
    }, 1000);
  }, []);

  return <div>Timer</div>;
}

// VIOLATION: performance/deterministic/event-listener-no-remove
export function EventListenerComponent() {
  useEffect(() => {
    window.addEventListener('resize', () => {
      console.log('resized');
    });
  }, []);

  return <div>Resizable</div>;
}

// VIOLATION: performance/deterministic/state-update-in-loop
export function StateUpdateInLoop({ items }: { items: string[] }) {
  const [processed, setProcessed] = useState<string[]>([]);

  useEffect(() => {
    for (const item of items) {
      setProcessed((prev) => [...prev, item]);
    }
  }, [items]);

  return <div>{processed.length}</div>;
}

// VIOLATION: performance/deterministic/missing-usememo-expensive
export function ExpensiveFilterComponent({ items }: { items: Array<{ active: boolean; name: string }> }) {
  const activeItems = items.filter((item) => item.active);
  return <ul>{activeItems.map((i) => <li key={i.name}>{i.name}</li>)}</ul>;
}

// VIOLATION: performance/deterministic/unnecessary-context-provider
const ThemeContext = React.createContext('light');
export function UnnecessaryContextProvider() {
  return (
    <ThemeContext.Provider value="dark">
      <div>Only child</div>
    </ThemeContext.Provider>
  );
}
