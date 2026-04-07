/**
 * Bug violations related to React patterns.
 */

import React, { useState, useEffect } from 'react';

// VIOLATION: bugs/deterministic/conditional-hook
export function ConditionalHookComponent({ show }: { show: boolean }) {
  if (show) {
    const [count, setCount] = useState(0);
    return <div onClick={() => setCount(count + 1)}>{count}</div>;
  }
  return <div>Hidden</div>;
}

// VIOLATION: bugs/deterministic/usestate-object-mutation
export function UseStateObjectMutation() {
  const [state, setState] = useState({ items: [] as string[], count: 0 });

  const addItem = (item: string) => {
    state.count = state.count + 1;
    setState({ ...state });
  };

  return <div onClick={() => addItem('test')}>{state.count}</div>;
}

// VIOLATION: bugs/deterministic/useeffect-object-dep
export function UseEffectObjectDep() {
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
  }, [{ url: '/api' }]);

  return <div>Loading</div>;
}
