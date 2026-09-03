/**
 * Top-level navigation state: which section (Code Analysis / Guard /
 * …) and which left-rail tab are active, kept in sync with the URL.
 *
 * Lifted out of RepoPage so the page body, the header's
 * section-actions slot, the sidebar, and any `ee/`-contributed section
 * renderer can all read and drive navigation through `useNavigation()`
 * instead of having it threaded down as props from one giant component.
 *
 * The URL is the source of truth: every setter writes the relevant
 * query params and the sync effect mirrors Back/Forward and deep-linked
 * reloads back into state. Setters are idempotent, so the effect firing
 * on our own navigations is a no-op.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  allTabIds,
  defaultTabForSection,
  sectionForTab,
  type DashboardSection,
  type LeftTab,
} from '@/navigation/registry';

// Query params that describe a tab's inner state. Cleared when the
// active tab/section changes so a stale `?file=` doesn't leak across
// tabs.
const TAB_SCOPED_PARAMS = [
  'tab',
  'mode',
  'scopeService',
  'scopeModule',
  'file',
  'flow',
  'guard',
  'gsec',
  'gconf',
  'gdrift',
  'gscn',
  'gtest',
  'gflow',
  'gfind',
  'ginterface',
  'gjourney',
  'gplace',
  'gview',
  // Activity tab: the selected agent-sessions run + session.
  'run',
  'ses',
];

/** Map the retired `?gview` sub-view onto the Guard section's tabs. */
function guardTabForGview(gview: string | null): LeftTab {
  if (gview === 'drifts') return 'guarddrifts';
  // The Generate/Report sub-view folded into the Flows tab (its "last generate" strip).
  if (gview === 'report') return 'guardflows';
  return 'coverage';
}

/**
 * Derive the tab the URL implies WITHOUT needing the section: an explicit
 * (still-registered) ?tab wins, then the legacy guard alias, then the deep-link
 * shortcuts. Returns null when nothing is implied so the caller can fall back to
 * the section default.
 */
function tabFromParams(searchParams: URLSearchParams | null): LeftTab | null {
  const tabParam = searchParams?.get('tab') ?? null;
  if (tabParam && allTabIds().has(tabParam)) return tabParam;
  // Legacy: the Guard tab was `?tab=guard` with a `?gview` sub-view — both retired,
  // so re-point them at the Guard section's tabs.
  if (tabParam === 'guard') return guardTabForGview(searchParams?.get('gview') ?? null);
  // Retired: the Guard Generate/Report tab folded into the Flows tab (the "last
  // generate" strip) — re-point old `?tab=guardreport` links at it. The retired
  // Scenarios tab points there too: flows are the inventory now, and a scenario is
  // reached through its flow.
  if (tabParam === 'guardreport' || tabParam === 'scenarios') return 'guardflows';
  // Retired: the Guard Spec tab merged into Coverage (which absorbed the spec
  // surface) — re-point old `?tab=guardspec` links at it.
  if (tabParam === 'guardspec') return 'coverage';
  if (searchParams?.get('flow')) return 'flows';
  if (searchParams?.get('file')) return 'files';
  // A Guard doc deep-link (`?guard=<doc>`) or conflict deep-link (`?gconf=`) implies
  // the Guard coverage tab.
  if (searchParams?.get('guard') || searchParams?.get('gconf')) return 'coverage';
  // A TEST deep-link (`?gtest=`) implies the Tests tab — the one standalone test
  // destination. The legacy `?gscn=` (a test reached through its flow, back when
  // there was no Tests tab) points at the same place.
  if (searchParams?.get('gtest') || searchParams?.get('gscn')) return 'tests';
  // A Guard flow (`?gflow=`) or finding (`?gfind=`) deep-link implies the Flows tab.
  if (searchParams?.get('gflow') || searchParams?.get('gfind')) return 'guardflows';
  // A place (`?gplace=<surface>:<id>`, the tab's own selection) or an interface
  // deep-link (`?ginterface=<id>`) implies the Interfaces tab. The pre-rename
  // `?gjourney=` spelling is still honoured so old bookmarks land.
  if (searchParams?.get('gplace') || searchParams?.get('ginterface') || searchParams?.get('gjourney')) {
    return 'interfaces';
  }
  return null;
}

function resolveSection(searchParams: URLSearchParams | null): DashboardSection {
  const explicit = searchParams?.get('section');
  if (explicit === 'guard' || explicit === 'codequality') {
    return explicit;
  }
  // No explicit section: infer it from whichever tab the URL implies.
  const tab = tabFromParams(searchParams);
  return (tab && sectionForTab(tab)) || 'codequality';
}

/**
 * Derive the active tab from the URL, honouring the file/flow deep-link
 * shortcuts, falling back to the section default.
 */
function resolveTab(searchParams: URLSearchParams | null): LeftTab {
  return tabFromParams(searchParams) ?? defaultTabForSection(resolveSection(searchParams));
}

export interface NavigationContextValue {
  section: DashboardSection;
  leftTab: LeftTab | null;
  /**
   * Switch sections. Lands on `tab` when given, else the section's registry
   * default. (EE passes its lens's first curated tab.)
   */
  setSection: (next: DashboardSection, tab?: LeftTab) => void;
  /** Set (or clear, with null → home) the active left tab. */
  setLeftTab: (tab: LeftTab | null) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const [section, setSectionState] = useState<DashboardSection>(() =>
    resolveSection(searchParams),
  );
  const [leftTab, setLeftTabState] = useState<LeftTab | null>(() =>
    resolveTab(searchParams),
  );

  const setSection = useCallback(
    (next: DashboardSection, tab?: LeftTab) => {
      setSectionState(next);
      // Land on the requested tab, else the section's default tab; the URL
      // captures both so reloads stay coherent.
      const nextTab = tab ?? defaultTabForSection(next);
      setLeftTabState(nextTab);
      const url = new URL(window.location.href);
      // Write the section explicitly so a reload restores the chosen lens.
      url.searchParams.set('section', next);
      for (const key of TAB_SCOPED_PARAMS) url.searchParams.delete(key);
      // Diff mode (?view=diff) is section-specific in meaning, so don't carry
      // it across sections.
      url.searchParams.delete('view');
      if (nextTab !== 'home') url.searchParams.set('tab', nextTab);
      navigate(url.pathname + url.search);
    },
    [navigate],
  );

  const setLeftTab = useCallback(
    (tab: LeftTab | null) => {
      setLeftTabState(tab);
      const url = new URL(window.location.href);
      if (tab && tab !== 'home') {
        url.searchParams.set('tab', tab);
      } else {
        // Home is the default landing; strip tab-scoped params so the
        // URL shortens to /repos/:id. `view=diff` is page-level and is
        // intentionally preserved.
        for (const key of TAB_SCOPED_PARAMS) url.searchParams.delete(key);
      }
      navigate(url.pathname + url.search);
    },
    [navigate],
  );

  // Mirror the URL into state on every location change (Back/Forward,
  // deep links). Resolve section + tab together so the header's
  // section-actions slot never renders one frame of the wrong section.
  useEffect(() => {
    const resolvedSection = resolveSection(searchParams);
    const derivedTab = resolveTab(searchParams);
    // `settings` is section-neutral (repo-wide config), reachable from either lens
    // in EE — don't reset it when the active section doesn't "own" it.
    const belongs = derivedTab === 'settings' || sectionForTab(derivedTab) === resolvedSection;
    const finalTab = belongs
      ? derivedTab
      : defaultTabForSection(resolvedSection);
    setSectionState(resolvedSection);
    setLeftTabState(finalTab);
  }, [searchParams]);

  const value = useMemo<NavigationContextValue>(
    () => ({ section, leftTab, setSection, setLeftTab }),
    [section, leftTab, setSection, setLeftTab],
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error('useNavigation must be used inside <NavigationProvider>');
  }
  return ctx;
}
