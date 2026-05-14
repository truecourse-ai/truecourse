/**
 * React component patterns — demonstrates React-specific bugs.
 */

import React, { useState, useEffect } from 'react';

// VIOLATION: bugs/deterministic/conditional-hook
export function ConditionalHook({ show }: { show: boolean }) {
  if (show) {
    const [count, setCount] = useState(0);
    return <div onClick={() => setCount(count + 1)}>{count}</div>;
  }
  return <div>Hidden</div>;
}

// VIOLATION: bugs/deterministic/usestate-object-mutation
export function StateMutation() {
  const [state, setState] = useState({ items: [] as string[], count: 0 });

  const addItem = (item: string) => {
    state.count = state.count + 1;
    setState({ ...state });
  };

  return <div onClick={() => addItem('test')}>{state.count}</div>;
}

// VIOLATION: bugs/deterministic/useeffect-object-dep
export function ObjectDep() {
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
  }, [{ url: '/api' }]);

  return <div>Loading</div>;
}

// VIOLATION: code-quality/deterministic/react-hook-setter-in-body
export function SetterInBody({ items }: { items: string[] }) {
  const [count, setCount] = useState(0);
  setCount(items.length);

  return <div>{count}</div>;
}

// VIOLATION: code-quality/deterministic/react-useless-set-state
export function UselessSetState() {
  const [value, setValue] = useState('initial');

  useEffect(() => {
    setValue(value);
  }, []);

  return <div>{value}</div>;
}

// VIOLATION: code-quality/deterministic/react-readonly-props
interface MutatingComponentProps {
  items: string[];
}
export function MutatingProps(props: MutatingComponentProps) {
  props.items.push('new item');
  return <ul>{props.items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

// VIOLATION: security/deterministic/disabled-resource-integrity
export function ExternalScriptNoIntegrity() {
  return <script src="https://cdn.example.com/lib.js" />;
}

// VIOLATION: security/deterministic/mixed-content
export function MixedContentImage() {
  return <img src="http://cdn.example.com/logo.png" />;
}

declare function useQuery(opts: { queryKey: string[]; queryFn: () => Promise<unknown> }): { data: any };
// VIOLATION: bugs/deterministic/missing-error-boundary
export function TopLevelQuery() {
  const { data } = useQuery({ queryKey: ['data'], queryFn: () => fetch('/api').then((r) => r.json()) });
  return (
    <div>
      <h1>{data?.title}</h1>
      <p>{data?.description}</p>
    </div>
  );
}

function ChildComponent({ onClick }: { onClick: () => void }) {
  return <button onClick={onClick}>Click</button>;
}

// VIOLATION: code-quality/deterministic/react-unstable-key
export function ListWithIndexKey({ items }: { items: string[] }) {
  return <div>{items.map((item, index) => <ChildComponent key={index} onClick={() => {}} />)}</div>;
}

// VIOLATION: performance/deterministic/inline-function-in-jsx-prop
export function InlineCallback() {
  return <ChildComponent onClick={() => console.log('click')} />;
}

// VIOLATION: code-quality/deterministic/html-table-accessibility
export function DataTable() {
  return (
    <table>
      <tbody>
        <tr><td>Row 1</td></tr>
        <tr><td>Row 2</td></tr>
      </tbody>
    </table>
  );
}

// --- duplicate-import TP shape: three separate react imports (default type + named type + named value) ---

import type React from 'react';
// VIOLATION: bugs/deterministic/duplicate-import
import type { HTMLAttributes } from 'react';
import { useCallback } from 'react';

declare function resolveShareUrl(id: string): string;
declare function copyToClipboard(text: string): Promise<void>;

export type ShareButtonProps = HTMLAttributes<HTMLButtonElement> & {
  resourceId: string;
  onCopied?: () => void;
};

export function ShareButton({ resourceId, onCopied, className, ...rest }: ShareButtonProps) {
  const handleClick = useCallback(async () => {
    const url = resolveShareUrl(resourceId);
    await copyToClipboard(url);
    onCopied?.();
  }, [resourceId, onCopied]);

  return (
    <button type="button" className={className} onClick={handleClick} {...rest}>
      Copy link
    </button>
  ) as React.ReactElement;
}

// duplicate-import TP shape: namespace import + named import from same module
import * as ReactDOM from 'react-dom';
// VIOLATION: bugs/deterministic/duplicate-import
import { createPortal } from 'react-dom';

declare const modalRoot: HTMLElement;

export function ModalPortal({ children }: { children: any }) {
  const version = ReactDOM.version;
  return createPortal(
    <div data-react-version={version}>{children}</div>,
    modalRoot,
  );
}
