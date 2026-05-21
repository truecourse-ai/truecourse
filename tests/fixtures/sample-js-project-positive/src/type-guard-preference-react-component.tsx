/**
 * React components that render JSX and happen to narrow a prop via
 * `typeof` should not be flagged as type-guard candidates. They return
 * JSX wrapped in parens, not a boolean expression.
 */

import * as React from 'react';

type MetricProps = {
  title: string;
  value?: string | number;
};

export const MetricCard = ({ title, value }: MetricProps) => {
  const display = typeof value === 'number' ? value : (value ?? '');
  return (
    <div className="metric-card">
      <h3>{title}</h3>
      <p>{display}</p>
    </div>
  );
};

type SelectorProps = {
  count: number;
  primary: string;
  secondary?: string | number;
};

export const ItemSelector = ({ count, primary, secondary }: SelectorProps) => {
  const trailing = typeof secondary === 'number' ? secondary : (secondary ?? '');
  return (
    <div className="item-selector">
      <span>{count}</span>
      <span>{primary}</span>
      <span>{trailing}</span>
    </div>
  );
};
