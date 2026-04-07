'use client';

/**
 * Tailwind plus JSX patterns that should NOT trigger any rules.
 *
 * Tailwind class strings in className are JSX attribute values.
 * SVG fill is a JSX attribute value.
 * Use client directive is fine.
 */

import { memo } from 'react';

interface ButtonProps {
  readonly children: string;
  readonly variant: 'primary' | 'secondary';
  readonly onClick: () => void;
}

export const Button = memo(function Button({ children, variant, onClick }: ButtonProps) {
  const baseClasses = 'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium';
  const variantClasses = variant === 'primary'
    ? 'bg-blue-600 text-white hover:bg-blue-700'
    : 'bg-gray-200 text-gray-900 hover:bg-gray-300';

  return (
    <button
      type="button"
      className={`${baseClasses} ${variantClasses}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
});

interface CardProps {
  readonly title: string;
  readonly description: string;
}

export const Card = memo(function Card({ title, description }: CardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
      <p className="mt-2 text-sm text-gray-600">{description}</p>
    </div>
  );
});

export function CloseIcon(): JSX.Element {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface BadgeProps {
  readonly label: string;
  readonly color: 'green' | 'red' | 'yellow';
}

const GREEN_CLASSES = 'bg-green-100 text-green-800';
const RED_CLASSES = 'bg-red-100 text-red-800';
const YELLOW_CLASSES = 'bg-yellow-100 text-yellow-800';

function getColorClass(color: string): string {
  if (color === 'green') return GREEN_CLASSES;
  if (color === 'red') return RED_CLASSES;
  if (color === 'yellow') return YELLOW_CLASSES;
  return '';
}

export const Badge = memo(function Badge({ label, color }: BadgeProps) {
  const colorClass = getColorClass(color);

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  );
});
