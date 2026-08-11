
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getTab,
  useVisibleTabsForSection,
  type DashboardSection,
  type LeftTab,
} from '@/navigation/registry';

// Backward-compatible re-exports — many callsites import these names
// from '@/components/layout/LeftSidebar'. The registry is the source
// of truth; this file just forwards.
export type { DashboardSection, LeftTab };
export {
  tabsForSection,
  defaultTabForSection,
} from '@/navigation/registry';

/**
 * Accessible name for a rail badge.
 *
 * The rail BUTTON must keep the bare tab label as its accessible name
 * ("Home", "Flows", ...) — role-and-name locators and screen-reader users
 * address it by that exact string, and an aria-label carrying the count would
 * change it on every analysis. So the count is named on the badge element
 * instead: a `status` region whose own name carries both the tab and the
 * number ("Home, 12 violations"), which makes the count — and its movement as
 * filters or analyses change — readable and assertable on its own.
 */
export function railBadgeName(
  tab: { label: string; badgeNoun?: [string, string] },
  count: number,
): string {
  const [one, many] = tab.badgeNoun ?? ['item', 'items'];
  return `${tab.label}, ${count} ${count === 1 ? one : many}`;
}

/** Same, for the new/resolved diff badge: "Home, 3 new, 2 resolved". */
export function railDiffBadgeName(
  tab: { label: string },
  badge: { newCount: number; resolvedCount: number },
): string {
  const parts: string[] = [];
  if (badge.newCount > 0) parts.push(`${badge.newCount} new`);
  if (badge.resolvedCount > 0) parts.push(`${badge.resolvedCount} resolved`);
  return `${tab.label}, ${parts.join(', ')}`;
}

type LeftSidebarProps = {
  section: DashboardSection;
  activeTab: LeftTab | null;
  onTabChange: (tab: LeftTab | null) => void;
  children: React.ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  badgeCounts?: Partial<Record<LeftTab, number | { newCount: number; resolvedCount: number }>>;
  /**
   * Hide the vertical icon rail (EE renders a horizontal tab bar instead).
   * The side panel still shows for the active tab.
   */
  hideRail?: boolean;
};

export function LeftSidebar({
  section,
  activeTab,
  onTabChange,
  children,
  defaultWidth = 350,
  minWidth = 260,
  badgeCounts,
  hideRail = false,
}: LeftSidebarProps) {
  const [width, setWidth] = useState(defaultWidth);
  const [maxWidth, setMaxWidth] = useState(800);
  const isDragging = useRef(false);

  const tabs = useVisibleTabsForSection(section);
  // Derived from the registry so a tab's `noPanel: true` flag is the
  // single switch for "rail icon only, no side panel" behaviour.
  const tabsWithoutPanel = useMemo(
    () => new Set(tabs.filter((t) => t.noPanel).map((t) => t.id)),
    [tabs],
  );

  useEffect(() => {
    const calc = () => Math.floor(window.innerWidth * 0.8);
    setMaxWidth(calc());
    const onResize = () => setMaxWidth(calc());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (!isDragging.current) return;
        const delta = moveEvent.clientX - startX;
        setWidth(Math.min(maxWidth, Math.max(minWidth, startWidth + delta)));
      };

      const onMouseUp = () => {
        isDragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [width, minWidth, maxWidth],
  );

  const isOpen = activeTab !== null && !tabsWithoutPanel.has(activeTab);
  const activeTabLabel = activeTab ? getTab(activeTab)?.label ?? '' : '';

  return (
    <div className="flex flex-shrink-0 h-full">
      {/* Icon rail — hidden in EE, where a horizontal tab bar drives the tabs. */}
      {!hideRail && (
      <div className="flex w-12 flex-col items-center gap-1 border-r border-border bg-card pt-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(isActive ? null : tab.id)}
              className={`group relative flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                isActive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              aria-label={tab.label}
            >
              {isActive && (
                <div className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />
              )}
              <Icon className="h-5 w-5" />
              <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md border border-border opacity-0 group-hover:opacity-100 transition-opacity z-50">
                {tab.label}
              </span>
              {(() => {
                const badge = badgeCounts?.[tab.id];
                if (badge == null) return null;
                if (typeof badge === 'number') {
                  return badge > 0 ? (
                    <span
                      role="status"
                      aria-label={railBadgeName(tab, badge)}
                      className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground"
                    >
                      {badge}
                    </span>
                  ) : null;
                }
                const total = badge.newCount + badge.resolvedCount;
                return total > 0 ? (
                  <span
                    role="status"
                    aria-label={railDiffBadgeName(tab, badge)}
                    className="absolute -right-1 -top-1 flex items-center gap-px rounded-full bg-card border border-border px-1 py-px"
                  >
                    {badge.newCount > 0 && (
                      <span className="text-[8px] font-bold text-red-400">+{badge.newCount}</span>
                    )}
                    {badge.resolvedCount > 0 && (
                      <span className="text-[8px] font-bold text-emerald-400">-{badge.resolvedCount}</span>
                    )}
                  </span>
                ) : null;
              })()}
            </button>
          );
        })}
      </div>
      )}

      {/* Content panel */}
      {isOpen && (
        <aside
          className="relative flex-shrink-0 border-r border-border bg-card"
          style={{ width }}
        >
          {/* Panel header */}
          <div className="flex h-10 items-center gap-2 border-b border-border px-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {activeTabLabel}
            </span>
            {(() => {
              const badge = activeTab ? badgeCounts?.[activeTab] : undefined;
              if (badge == null) return null;
              if (typeof badge === 'number') {
                return badge > 0 ? (
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {badge}
                  </span>
                ) : null;
              }
              const total = badge.newCount + badge.resolvedCount;
              return total > 0 ? (
                <span className="flex items-center gap-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                  {badge.newCount > 0 && (
                    <span className="text-red-400">+{badge.newCount} new</span>
                  )}
                  {badge.resolvedCount > 0 && (
                    <span className="text-emerald-400">-{badge.resolvedCount} resolved</span>
                  )}
                </span>
              ) : null;
            })()}
          </div>

          {/* Panel content */}
          <div className="h-[calc(100%-40px)] overflow-hidden">
            {children}
          </div>

          {/* Resize handle on right edge */}
          <div
            className="absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50"
            onMouseDown={handleMouseDown}
          />
        </aside>
      )}
    </div>
  );
}
