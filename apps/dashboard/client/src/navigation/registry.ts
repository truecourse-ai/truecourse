/**
 * Navigation registry — the single source of truth for which
 * top-level sections (Code Analysis, Guard, …) and which left-rail
 * tabs (Files, Flows, Coverage, …) the dashboard renders.
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
 *     'guard', 'home', 'coverage', …) remain available as constants for
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
  FlaskConical,
  Globe,
  Route,
  Settings,
  Plug,
  BarChart3,
  TriangleAlert,
  ListChecks,
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
      // EE-only: per-repo gate settings (notify emails, blocking, notification
      // toggles). Rendered as a tab in the EE Code Quality bar (via
      // `EE_ANALYSIS_TAB_ORDER`); OSS filters it out (github-gate capability).
      {
        id: 'settings',
        label: 'Settings',
        icon: Settings,
        noPanel: true,
        requiredCapability: 'github-gate',
      },
    ],
  },
  {
    // Spec-section scenario coverage as a top-level module (OSS — never gated).
    id: 'guard',
    label: 'Spec Guard',
    description: 'Spec-flow coverage, generation, interfaces, runs',
    icon: FlaskConical,
    defaultTab: 'coverage',
    // One action per tab: Coverage → Scan, Tests → Generate, Interfaces → Map (free,
    // deterministic — no estimate modal), Runs → Run.
    tabs: [
      // Coverage-over-doc surface — the doc-picker + conflict list sidebar (the
      // reused SpecCorpusView) absorbs the spec curation surface; no separate Spec
      // tab. Doc → coverage bands + section detail, which lists the FLOWS through
      // the section (never scenarios — those are one click further, in a flow).
      { id: 'coverage', label: 'Coverage', icon: ListChecks },
      // Where the docs Coverage reads come FROM when they aren't this repo's own
      // markdown: the registered llms.txt documentation sites, snapshotted into
      // the working tree as spec docs. It sits beside Coverage because it feeds
      // it, and it is a full page (not a sidebar group) because managing a site
      // is its own job: rows, a detail with every fetched page, and the add flow.
      // Working-tree only (the snapshot is real files), so `local-filesystem`-
      // gated exactly like Dependencies — hosted routes answer 501.
      {
        id: 'sources',
        label: 'Sources',
        icon: Globe,
        noPanel: true,
        requiredCapability: 'local-filesystem',
      },
      // Claims have NO tab: every testable statement the docs make is read inside
      // the section that states it, on Coverage — a parallel inventory would add
      // navigation without adding information.
      // THE guard inventory: every flow AND the test that realizes it, one entity
      // per row — labelled Tests, because a list of verdicts is a test list to
      // whoever opens it ("flow" stays the generation-side word). No separate
      // Flows tab: one flow has one test, so a second list would have quoted a
      // different count for the same rows. Left: every test with its status word;
      // main: the flow's goal, its milestone list, and the test itself (verdict,
      // steps, evidence). Hand-written tests are rows here too, under a Manual
      // pseudo-flow, so the list stays total. The id stays `guardflows`: Code
      // Analysis already owns a `flows` tab and tab ids are global (the same
      // reason the Runs tab is `guarddrifts`).
      { id: 'guardflows', label: 'Tests', icon: FlaskConical },
      // Code-side interface catalog — the free Map action's read surface: detected
      // surfaces banner, per-surface catalog with the reverse index onto flows, and
      // the sequence diagram per interface. It sits AFTER Tests: it is the code half,
      // read once the spec half (coverage -> tests) has been read.
      { id: 'interfaces', label: 'Interfaces', icon: Route },
      // The third parties this repo calls, and the real/sandbox account the user
      // hands guard for each. Reads and writes the WORKING TREE
      // (recipe.json + the gitignored overlay + the host env), so it is
      // `local-filesystem`-gated exactly like Files/Flows — a hosted store has no
      // working tree and its routes answer 501. Rail icon only: the page is one
      // card list, so there is nothing for a side panel to hold.
      {
        id: 'externals',
        label: 'Dependencies',
        icon: Plug,
        noPanel: true,
        requiredCapability: 'local-filesystem',
      },
      // Run inspector (analyze-style list + evidence detail): full results —
      // severity-led drifts first, then the passed group; no
      // panel. Shares BL Drift's Runs idiom (ClipboardList) — the two live in
      // different sections, so a shared icon never crowds one rail.
      { id: 'guarddrifts', label: 'Runs', icon: ClipboardList, noPanel: true },
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
      SECTIONS.filter(
        (s) => isEnabled(s.requiredCapability, capabilities),
      ).map(
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
