/**
 * Real client component — inline object in JSX prop creates a new
 * reference every render, causing children to re-render unnecessarily.
 */

'use client';

import React from 'react';

interface PanelProps {
  readonly style: { background: string; padding: number };
  readonly children: React.ReactNode;
}

function Panel(props: PanelProps) {
  return <div style={props.style}>{props.children}</div>;
}

export function ClientCard({ label }: { label: string }) {
  return (
    // VIOLATION: performance/deterministic/inline-object-in-jsx-prop
    <Panel style={{ background: '#fafafa', padding: 12 }}>
      <span>{label}</span>
    </Panel>
  );
}
