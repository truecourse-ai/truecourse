/**
 * EE repo/PR mode switch — a compact segmented control that flips a selected repo
 * (or PR) between its lenses: Guard (spec-scenario coverage + runs) and Code
 * Quality (analyze: architecture + violations). Drives the same
 * `dashboardSection` state as the OSS `SectionSwitcher` dropdown, but rendered to
 * fit the EE chrome.
 */

import { FlaskConical, Network } from 'lucide-react';
import { getSection, type DashboardSection, type NavIcon } from '@/navigation/registry';

const SEGMENTS: { id: DashboardSection; label: string; icon: NavIcon }[] = [
  { id: 'guard', label: 'Guard', icon: FlaskConical },
  { id: 'codequality', label: 'Code Quality', icon: Network },
];

export function EeSectionSwitch({
  section,
  onSectionChange,
}: {
  section: DashboardSection;
  onSectionChange: (next: DashboardSection) => void;
}) {
  // Registry-hidden lenses are offered only while active (a deep link can land
  // there and needs a way out).
  const segments = SEGMENTS.filter(
    (seg) => !getSection(seg.id)?.hidden || seg.id === section,
  );
  // A single lens needs no switch.
  if (segments.length < 2) return null;
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
