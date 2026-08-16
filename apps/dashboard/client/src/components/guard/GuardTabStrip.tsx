/**
 * The Guard main-pane tab strip — the shared presentation for a {@link GuardTab}
 * set, identical in look and behaviour to the Spec/Scenarios doc tabs: a scrolling
 * row of tabs where the pinned ones read bold and the transient preview reads
 * italic, each with a hover/active close X. Click selects (preserving pin state),
 * the close X stops propagation so it never re-selects the tab. The whole strip
 * renders ONLY while at least one item tab is open. Presentation only; the reducer
 * lives in {@link useGuardTabs}.
 *
 * `home` (optional): a pinned, uncloseable first tab that deselects back to the
 * pane's at-rest content; it renders only while the strip does.
 *
 * The visible label is the HUMAN text (a scenario/finding title) — truncated
 * within a max width so a long slug id can never stretch the strip — with the
 * machine handle (id / binding) surfaced on hover. Each item may carry its own
 * leading glyph (findings pass a distinct one); scenarios default to the flask.
 */

import { FlaskConical, LayoutDashboard, X, type LucideIcon } from 'lucide-react';
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

/** The pinned, uncloseable first tab back to the pane's at-rest content. */
export interface GuardTabStripHome {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
}

export function GuardTabStrip({
  tabs,
  activeId,
  onSelect,
  onClose,
  home,
}: {
  tabs: GuardTabStripItem[];
  activeId: string | null;
  onSelect: (tab: GuardTab) => void;
  onClose: (id: string) => void;
  home?: GuardTabStripHome;
}) {
  // No item tabs → no strip: the pane's own content already fills it.
  if (tabs.length === 0) return null;
  const HomeIcon = home?.icon ?? LayoutDashboard;
  return (
    <div className="flex shrink-0 items-center overflow-x-auto border-b border-border bg-card text-xs">
      {home && (
        <div
          onClick={home.onSelect}
          className={`group flex shrink-0 cursor-pointer items-center gap-1 border-r border-border px-3 py-1.5 transition-colors ${
            activeId == null
              ? 'bg-background text-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <HomeIcon className="h-3 w-3 shrink-0" />
          <span className="block font-medium">{home.label}</span>
        </div>
      )}
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
            <HoverPopover portal content={t.title} side="bottom" align="start">
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
