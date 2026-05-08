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

export function ConditionalNamespaceHook({ ready }: { ready: boolean }) {
  if (ready) {
    // VIOLATION: bugs/deterministic/conditional-hook
    const [value, setValue] = React.useState('');
    return <input value={value} onChange={(e) => setValue(e.target.value)} />;
  }
  return null;
}

export function TernaryBranchHook({ enabled }: { enabled: boolean }) {
  // VIOLATION: bugs/deterministic/conditional-hook
  const value = enabled ? useState('on')[0] : 'off';
  return <span>{value}</span>;
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

// react-readonly-props is disabled by default — modern React/TS
// convention does not add explicit `readonly` to every Props
// field. Users who want that style can opt in per-project.
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

declare function useSuspenseQuery(opts: { queryKey: string[]; queryFn: () => Promise<unknown> }): { data: any };
// VIOLATION: bugs/deterministic/missing-error-boundary
export function TopLevelQuery() {
  const { data } = useSuspenseQuery({ queryKey: ['data'], queryFn: () => fetch('/api').then((r) => r.json()) });
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
  return <ChildComponent onClick={() => {
    console.log('click');
    console.log('clicked twice');
    console.log('and a third time for good measure');
  }} />;
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
