'use client';

import type { DepthLevel } from '@/types/graph';

type DepthToggleProps = {
  level: DepthLevel;
  onChange: (level: DepthLevel) => void;
};

const levels: { value: DepthLevel; label: string }[] = [
  { value: 'services', label: 'Services' },
  { value: 'layers', label: 'Layers' },
];

export function DepthToggle({ level, onChange }: DepthToggleProps) {
  return (
    <div className="flex items-center rounded-md border border-border bg-card shadow-sm">
      {levels.map(({ value, label }) => (
        <button
          key={value}
          className={`cursor-pointer px-3 py-1.5 text-xs font-medium transition-colors ${
            level === value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          } ${value === 'services' ? 'rounded-l-md' : 'rounded-r-md'}`}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
