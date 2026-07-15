/**
 * EE repo/PR mode switch — a compact segmented control that flips a selected repo
 * (or PR) between its lenses: Guard (spec-scenario coverage + runs) and Code
 * Quality (analyze: architecture + violations). Drives the same
 * `dashboardSection` state as the OSS `SectionSwitcher` dropdown, but rendered to
 * fit the EE chrome.
 */

import { FlaskConical, Network } from 'lucide-react';
import type { DashboardSection, NavIcon } from '@/navigation/registry';

const SEGMENTS: { id: DashboardSection; label: string; icon: NavIcon }[] = [
  { id: 'codequality', label: 'Code Quality', icon: Network },
  { id: 'guard', label: 'Spec Guard', icon: FlaskConical },
];

export function EeSectionSwitch({
  section,
  onSectionChange,
}: {
  section: DashboardSection;
  onSectionChange: (next: DashboardSection) => void;
}) {
  const segments = SEGMENTS;
  return (
    <div
      role="tablist"
      aria-label="Repository view"
      className="inline-flex items-center rounded-md border border-border bg-muted/60 p-0.5"
    >
      {segments.map((seg) => {
        const Icon = seg.icon;
        const active = section === seg.id;
        return (
          <button
            key={seg.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (!active) onSectionChange(seg.id);
            }}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {seg.label}
          </button>
        );
      })}
    </div>
  );
}
