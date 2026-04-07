/**
 * React-related code quality violations.
 * Must be .tsx for JSX-based rules.
 */

import React, { useState } from 'react';

// VIOLATION: code-quality/deterministic/react-hook-setter-in-body
function BadComponent() {
  const [count, setCount] = useState(0);
  setCount(count + 1);
  return <div>{count}</div>;
}

// VIOLATION: code-quality/deterministic/react-leaked-render
function LeakedRender({ count }: { count: number }) {
  return <div>{count && <span>Has items</span>}</div>;
}

// VIOLATION: code-quality/deterministic/react-readonly-props
interface ButtonProps {
  label: string;
  onClick: () => void;
}

function Button(props: ButtonProps) {
  return <button onClick={props.onClick}>{props.label}</button>;
}

// VIOLATION: code-quality/deterministic/react-unstable-key
function UnstableKeyList({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

// VIOLATION: code-quality/deterministic/react-useless-set-state
function UselessSetState() {
  const [name, setName] = useState('hello');
  function handleClick() {
    setName(name);
  }
  return <button onClick={handleClick}>{name}</button>;
}

// VIOLATION: code-quality/deterministic/html-table-accessibility
function BadTable() {
  return (
    <table>
      <tbody>
        <tr>
          <td>Data 1</td>
          <td>Data 2</td>
        </tr>
      </tbody>
    </table>
  );
}

export { BadComponent, LeakedRender, Button, UnstableKeyList, UselessSetState, BadTable };
