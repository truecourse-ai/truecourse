import { useState, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';

export type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';

const severityLevels: SeverityFilter[] = ['all', 'critical', 'high', 'medium', 'low'];

const severityTextColors: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-red-400',
  medium: 'text-orange-400',
  low: 'text-amber-400',
};

export function SeverityDropdown({
  value,
  onChange,
  counts,
}: {
  value: SeverityFilter;
  onChange: (v: SeverityFilter) => void;
  counts: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [open]);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs transition-colors ${
          value !== 'all' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {value === 'all' ? 'Severity' : value.charAt(0).toUpperCase() + value.slice(1)}
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-36 rounded-md border border-border bg-popover shadow-lg">
          <div className="py-1">
            {severityLevels.map((sev) => {
              const count = sev === 'all' ? total : counts[sev] || 0;
              return (
                <button
                  key={sev}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-accent transition-colors ${
                    value === sev ? 'bg-accent/50 font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                  onClick={() => { onChange(sev); setOpen(false); }}
                >
                  <span className={sev !== 'all' ? severityTextColors[sev] : ''}>
                    {sev === 'all' ? 'All severities' : sev.charAt(0).toUpperCase() + sev.slice(1)}
                  </span>
                  <span className="text-[10px] opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
