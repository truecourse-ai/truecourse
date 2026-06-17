/**
 * Navigation registry — the single source of truth for which
 * top-level sections (Code Analysis, BL Drift, …) and which left-rail
 * tabs (Files, Flows, Spec, …) the dashboard renders.
 *
 * Why a registry rather than hard-coded arrays in <SectionSwitcher>
 * and <LeftSidebar>:
 *
 *   - It removes the only thing that previously made enterprise
 *     features impossible to add without editing OSS source. `ee/`
 *     packages contribute their own descriptors (e.g. a `governance`
 *     section, an `integrations` tab) by pushing into SECTIONS at
 *     import time; OSS files never change.
 *   - Both the section list and per-section tab list can carry a
 *     `requiredCapability`. The `useVisibleSections` /
 *     `useVisibleTabsForSection` hooks below filter the data through
 *     the AppProvider's capability set so the gate lives in one place
 *     instead of being scattered across components.
 *   - Section/tab ids are plain `string`. The OSS ids ('codequality',
 *     'verification', 'home', 'spec', …) remain available as constants for
 *     ergonomic narrowing, but the type itself is open so contributed
 *     ids type-check without touching this file.
 */

import {
  Home,
  Network,
  Workflow,
  FolderTree,
  Database,
  ClipboardList,
  BookOpen,
  FileCode2,
  ShieldCheck,
  GitMerge,
  GitPullRequest,
  Settings,
  BarChart3,
  TriangleAlert,
  Lightbulb,
} from 'lucide-react';
import type { Capability } from '@truecourse/shared';
import { useMemo } from 'react';
import { useCapabilityContext } from '@/contexts/CapabilityContext';

/** Open string types — anything registered in SECTIONS is a valid id at runtime. */
export type SectionId = string;
export type TabId = string;

/** Backward-compatible aliases — existing call sites continue to import these names. */
export type DashboardSection = SectionId;
export type LeftTab = TabId;

/** Lucide icon component. */
export type NavIcon = typeof Home;

export interface TabDescriptor {
  id: TabId;
  label: string;
  icon: NavIcon;
  /**
   * When true, no sidebar panel is rendered — clicking the rail icon
   * is the entire UX (it just sets the active tab in URL/state). The
   * tab still appears in the rail; only the side panel is suppressed.
   */
  noPanel?: boolean;
  /** Gate the tab on this capability. Omit for OSS tabs. */
  requiredCapability?: Capability;
}

export interface SectionDescriptor {
  id: SectionId;
  /** Shown in <SectionSwitcher>. */
  label: string;
  /** One-liner shown under the label in the switcher menu. */
  description: string;
  icon: NavIcon;
  /** Tab opened when the section becomes active and no tab is forced. */
  defaultTab: TabId;
  tabs: TabDescriptor[];
  /** Gate the entire section on this capability. Omit for OSS sections. */
  requiredCapability?: Capability;
}

/**
 * OSS sections. `ee/` packages push their own descriptors at import
 * time (`SECTIONS.push({ id: 'governance', ... })`) — registry order
 * controls the order they appear in the switcher.
 */
export const SECTIONS: SectionDescriptor[] = [
  {
    id: 'codequality',
    label: 'Code Analysis',
    description: 'Architecture graphs, files, flows, databases',
    icon: Network,
    defaultTab: 'home',
    tabs: [
      { id: 'home', label: 'Home', icon: Home, noPanel: true },
      { id: 'graphs', label: 'Graphs', icon: Network, noPanel: true },
      // Flows / Files / Databases need the repo on local disk — OSS-only (gated on
      // the `local-filesystem` capability the hosted edition omits).
      { id: 'flows', label: 'Flows', icon: Workflow, requiredCapability: 'local-filesystem' },
      { id: 'files', label: 'Files', icon: FolderTree, requiredCapability: 'local-filesystem' },
      { id: 'databases', label: 'Databases', icon: Database, requiredCapability: 'local-filesystem' },
      { id: 'analyses', label: 'Analyses', icon: ClipboardList, noPanel: true },
      // Hosted-only: the EE Code Quality decomposition splits the OSS combined
      // `home` into separate Analytics / Violations tabs. Gated on `workspace`
      // (always advertised by the EE plugin, never by OSS), so OSS keeps its
      // combined `home` view and these never appear there. The EE repo view curates
      // them via `EE_ANALYSIS_TAB_ORDER`.
      { id: 'analytics', label: 'Analytics', icon: BarChart3, noPanel: true, requiredCapability: 'workspace' },
      { id: 'violations', label: 'Violations', icon: TriangleAlert, noPanel: true, requiredCapability: 'workspace' },
    ],
  },
  {
    id: 'verification',
    label: 'BL Drift',
    description: 'Spec consolidation, contracts, verification',
    icon: ShieldCheck,
    defaultTab: 'spec',
    tabs: [
      // EE-only: the PR gate's runs for this repo. OSS filters it out.
      {
        id: 'pulls',
        label: 'Pull requests',
        icon: GitPullRequest,
        noPanel: true,
        requiredCapability: 'github-gate',
      },
      { id: 'spec', label: 'Spec', icon: BookOpen },
      { id: 'contracts', label: 'Contracts', icon: FileCode2 },
      { id: 'verify', label: 'Verify', icon: ShieldCheck, noPanel: true },
      // EE-only: the drift analytics (charts/hotspots/trend) as a standalone tab.
      // In OSS the same `VerifyStatsColumn` stays as the Verify view's left aside.
      {
        // `driftanalytics` (not `analytics`) avoids colliding with the legacy
        // `?tab=analytics → home` URL alias in NavigationContext.
        id: 'driftanalytics',
        label: 'Analytics',
        icon: BarChart3,
        noPanel: true,
        requiredCapability: 'github-gate',
      },
      { id: 'runs', label: 'Runs', icon: ClipboardList, noPanel: true },
      { id: 'decisions', label: 'Decisions', icon: GitMerge },
      // Reverse-engineered undocumented decisions (OSS + EE). Sidebar list +
      // main-pane detail tabs, like Contracts; Promote / Dismiss in the detail.
      { id: 'inferred', label: 'Inferred', icon: Lightbulb },
      // EE-only: per-repo gate settings (notify emails, blocking, notification
      // toggles). Rendered as a tab in the EE repo console; OSS filters it out.
      {
        id: 'settings',
        label: 'Settings',
        icon: Settings,
        noPanel: true,
        requiredCapability: 'github-gate',
      },
    ],
  },
];

// --------------------------------------------------------------------
// Pure lookups (no React) — safe to call from anywhere, including the
// god component's URL-parsing path. These never filter by capability;
// they describe the *registered* world, not the *visible* one.
// --------------------------------------------------------------------

export function getSection(id: SectionId): SectionDescriptor | undefined {
  return SECTIONS.find((s) => s.id === id);
}

export function getAllTabs(): TabDescriptor[] {
  return SECTIONS.flatMap((s) => s.tabs);
}

export function getTab(id: TabId): TabDescriptor | undefined {
  return getAllTabs().find((t) => t.id === id);
}

export function tabsForSection(section: SectionId): TabDescriptor[] {
  return getSection(section)?.tabs ?? [];
}

export function defaultTabForSection(section: SectionId): TabId {
  return getSection(section)?.defaultTab ?? '';
}

/** Set of every registered tab id — useful for URL-param validation. */
export function allTabIds(): Set<TabId> {
  return new Set(getAllTabs().map((t) => t.id));
}

/** The section a tab belongs to, or undefined if the tab isn't registered. */
export function sectionForTab(tabId: TabId): SectionId | undefined {
  return SECTIONS.find((s) => s.tabs.some((t) => t.id === tabId))?.id;
}

// --------------------------------------------------------------------
// Capability-aware hooks — what the rendering components should call.
// --------------------------------------------------------------------

function isEnabled(
  required: Capability | undefined,
  capabilities: ReadonlySet<Capability>,
): boolean {
  return required === undefined || capabilities.has(required);
}

/** Sections the current edition+license is allowed to show. */
export function useVisibleSections(): SectionDescriptor[] {
  const { capabilities } = useCapabilityContext();
  return useMemo(
    () =>
      SECTIONS.filter((s) => isEnabled(s.requiredCapability, capabilities)).map(
        (s) => ({
          ...s,
          tabs: s.tabs.filter((t) =>
            isEnabled(t.requiredCapability, capabilities),
          ),
        }),
      ),
    [capabilities],
  );
}

/** Tabs the current edition+license is allowed to show inside `section`. */
export function useVisibleTabsForSection(
  section: SectionId,
): TabDescriptor[] {
  const { capabilities } = useCapabilityContext();
  return useMemo(() => {
    const s = getSection(section);
    if (!s) return [];
    if (!isEnabled(s.requiredCapability, capabilities)) return [];
    return s.tabs.filter((t) => isEnabled(t.requiredCapability, capabilities));
  }, [section, capabilities]);
}
