/**
 * The Guard main-pane tab strip — the shared presentation for a {@link GuardTab}
 * set, identical in look and behaviour to the Spec/Scenarios doc tabs: a scrolling
 * row of tabs where the pinned ones read bold and the transient preview reads
 * italic, each with a hover/active close X. Click selects (preserving pin state),
 * the close X stops propagation so it never re-selects the tab. A permanent
 * "Overview" tab renders FIRST — never closable, never italic, active exactly when
 * no item tab is (the way back to the no-selection overview). The whole strip
 * renders ONLY while at least one item tab is open; with none, the overview content
 * already fills the pane, so a lone Overview chip would be noise. Presentation only;
 * the reducer lives in {@link useGuardTabs}.
 *
 * The visible label is the HUMAN text (a scenario/finding title) — truncated
 * within a max width so a long slug id can never stretch the strip — with the
 * machine handle (id / binding) surfaced on hover. Each item may carry its own
 * leading glyph (findings pass a distinct one); scenarios default to the flask.
 */

import { FlaskConical, LayoutList, X, type LucideIcon } from 'lucide-react';
import { HoverPopover } from '@/components/ui/hover-popover';
import type { GuardTab } from '@/hooks/useGuardTabs';

export interface GuardTabStripItem extends GuardTab {
  /** The tab's visible text (a human title) — italic when unpinned, bold when pinned. */
  label: string;
  /** Hover detail (the id / binding) surfaced in a popover. */
  title: string;
  /** Leading glyph — defaults to the scenario flask; findings pass their own. */
  icon?: LucideIcon;
}

export function GuardTabStrip({
  tabs,
  activeId,
  onSelect,
  onSelectOverview,
  onClose,
}: {
  tabs: GuardTabStripItem[];
  activeId: string | null;
  onSelect: (tab: GuardTab) => void;
  /** Select the permanent Overview tab — clears the item selection. */
  onSelectOverview: () => void;
  onClose: (id: string) => void;
}) {
  // No item tabs → no strip: the overview content is already the whole pane.
  if (tabs.length === 0) return null;
  const overviewActive = activeId === null;
  return (
    <div className="flex shrink-0 items-center overflow-x-auto border-b border-border bg-card text-xs">
      {/* Permanent Overview tab — first, never closable, never a preview. */}
      <div
        onClick={onSelectOverview}
        className={`flex shrink-0 cursor-pointer items-center gap-1 border-r border-border px-3 py-1.5 transition-colors ${
          overviewActive ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
        title="Overview"
      >
        <LayoutList className="h-3 w-3 shrink-0" />
        <span className="font-medium">Overview</span>
      </div>
      {tabs.map((t) => {
        const isActive = activeId === t.id;
        const Icon = t.icon ?? FlaskConical;
        return (
          <div
            key={t.id}
            onClick={() => onSelect(t)}
            className={`group flex shrink-0 cursor-pointer items-center gap-1 border-r border-border px-3 py-1.5 transition-colors ${
              isActive ? 'bg-background text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            <Icon className="h-3 w-3 shrink-0" />
            <HoverPopover content={t.title} side="bottom" align="start">
              <span className={`block max-w-[11rem] truncate ${t.pinned ? 'font-medium' : 'italic'}`}>{t.label}</span>
            </HoverPopover>
            <button
              type="button"
              aria-label={`Close ${t.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
              className={`rounded p-0.5 transition-opacity hover:bg-muted ${
                isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
