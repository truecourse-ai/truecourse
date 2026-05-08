/**
 * Inline arrow handlers that are trivial passthroughs — argument
 * adapters that close over local values per render. The
 * `useCallback` deps would change every render anyway, so the
 * "extract to useCallback" rewrite gives no perf benefit. Modern
 * React (17+, especially React 19 + React Compiler) handles
 * inline arrows well.
 *
 * Positive fixture: NO inline-function-in-jsx-prop violations
 * should fire on the trivial-passthrough cases.
 */

import type React from "react";

declare const Button: (props: {
  onClick: () => void;
  children?: React.ReactNode;
}) => JSX.Element;

declare const TimeRow: (props: {
  label: string;
  onCopy: () => void;
}) => JSX.Element;

declare const onCopy: (label: string, value: string) => void;
declare const isMouseOver: { current: boolean };

export function CopyTimes(props: { local: string; utc: string }): JSX.Element {
  return (
    <Button
      onClick={async () => onCopy("Local", props.local)}
    >
      <TimeRow label="Local" onCopy={() => void onCopy("Local", props.local)} />
      <TimeRow label="UTC" onCopy={() => void onCopy("UTC", props.utc)} />
      <Button onClick={() => { isMouseOver.current = true; }}>Hover</Button>
    </Button>
  );
}
