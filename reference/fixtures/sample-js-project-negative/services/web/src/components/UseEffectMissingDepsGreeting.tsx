/**
 * Negative fixture: a closure-captured prop (`name`) is referenced inside a
 * useEffect with empty deps. The effect runs once on mount, so `message`
 * never updates when `name` changes — a real stale-closure bug.
 */

import { useEffect, useState } from 'react';

// VIOLATION: bugs/deterministic/useeffect-missing-deps
export function Greeting({ name }: { name: string }): JSX.Element {
  const [message, setMessage] = useState('');

  useEffect(() => {
    setMessage(`Hello, ${name}!`);
  }, []);

  return <p>{message}</p>;
}
