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
    setValue('initial');
  }, []);

  return <div>{value}</div>;
}

// VIOLATION: code-quality/deterministic/react-readonly-props
export function MutatingProps(props: { items: string[] }) {
  props.items.push('new item');
  return <ul>{props.items.map((item) => <li key={item}>{item}</li>)}</ul>;
}

// VIOLATION: bugs/deterministic/missing-error-boundary
export function TopLevelFetch() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch('/api/data')
      .then((res) => res.json())
      .then(setData);
  }, []);

  return (
    <div>
      <h1>{data?.title}</h1>
      <p>{data?.description}</p>
    </div>
  );
}
