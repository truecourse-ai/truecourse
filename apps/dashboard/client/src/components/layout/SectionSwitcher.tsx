/**
 * Section switcher — a compact dropdown that lives in the page
 * header (next to the logo). Click to flip the dashboard between
 * code-analysis and BL-drift modes. Scales cleanly if more sections
 * arrive later (Settings, Plugins, ...).
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Network, ShieldCheck, Check } from 'lucide-react';
import type { DashboardSection } from './LeftSidebar';

interface SectionSwitcherProps {
  value: DashboardSection;
  onChange: (next: DashboardSection) => void;
}

const SECTIONS: Array<{
  id: DashboardSection;
  label: string;
  description: string;
  icon: typeof Network;
}> = [
  {
    id: 'analysis',
    label: 'Code Analysis',
    description: 'Architecture graphs, files, flows, databases',
    icon: Network,
  },
  {
    id: 'drift',
    label: 'BL Drift',
    description: 'Spec consolidation, contracts, verification',
    icon: ShieldCheck,
  },
];

export function SectionSwitcher({ value, onChange }: SectionSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const current = SECTIONS.find((s) => s.id === value) ?? SECTIONS[0];
  const CurrentIcon = current.icon;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground hover:bg-muted/50 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <CurrentIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-medium">{current.label}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-64 rounded-md border border-border bg-popover p-1 shadow-lg"
        >
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const isCurrent = s.id === value;
            return (
              <button
                key={s.id}
                role="menuitemradio"
                aria-checked={isCurrent}
                onClick={() => {
                  setOpen(false);
                  if (!isCurrent) onChange(s.id);
                }}
                className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  isCurrent ? 'bg-accent text-accent-foreground' : 'hover:bg-muted text-foreground'
                }`}
              >
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{s.label}</span>
                    {isCurrent && <Check className="h-3 w-3 text-primary" />}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{s.description}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
