'use client';

import type { DepthLevel } from '@/types/graph';

type DepthToggleProps = {
  level: DepthLevel;
  onChange: (level: DepthLevel) => void;
};

const levels: { value: DepthLevel; label: string }[] = [
  { value: 'services', label: 'Services' },
  { value: 'modules', label: 'Modules' },
  { value: 'methods', label: 'Functions' },
];

export function DepthToggle({ level, onChange }: DepthToggleProps) {
  return (
    <div className="flex items-center rounded-md border border-border bg-card shadow-sm">
      {levels.map(({ value, label }, i) => (
        <button
          key={value}
          className={`px-3 py-1.5 text-xs font-medium transition-colors ${
            level === value
              ? 'bg-primary/20 text-primary'
              : 'text-muted-foreground hover:text-foreground'
          } ${i === 0 ? 'rounded-l-md' : ''} ${i === levels.length - 1 ? 'rounded-r-md' : ''}`}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
