/**
 * Top-level navigation state: which section (Code Analysis / BL Drift /
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
const TAB_SCOPED_PARAMS = ['tab', 'mode', 'scopeService', 'scopeModule', 'file', 'flow', 'canonical', 'contract', 'drift'];

function resolveSection(searchParams: URLSearchParams | null): DashboardSection {
  return searchParams?.get('section') === 'verification' ? 'verification' : 'codequality';
}

/**
 * Derive the active tab from the URL, honouring the file/flow deep-link
 * shortcuts, falling back to the section default.
 */
function resolveTab(searchParams: URLSearchParams | null): LeftTab {
  const tabParam = searchParams?.get('tab') ?? null;
  if (tabParam && allTabIds().has(tabParam)) return tabParam;
  if (searchParams?.get('flow')) return 'flows';
  if (searchParams?.get('file')) return 'files';
  if (searchParams?.get('canonical')) return 'spec';
  if (searchParams?.get('contract')) return 'contracts';
  if (searchParams?.get('drift')) return 'verify';
  return defaultTabForSection(resolveSection(searchParams));
}

export interface NavigationContextValue {
  section: DashboardSection;
  leftTab: LeftTab | null;
  /**
   * Switch sections. Lands on `tab` when given, else the section's registry
   * default. (EE passes its lens's first curated tab — the OSS default would
   * open Spec for Verification instead of its Analytics tab.)
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
      // Write the section explicitly (both values). EE's repo view defaults to
      // Verification (drift) and must be able to tell "user picked Code Quality"
      // (?section=codequality) apart from "no choice yet" (no param) — clearing the
      // param for analysis would conflate them. The initial no-param load still
      // resolves to the OSS default (analysis); EE redirects it to drift.
      url.searchParams.set('section', next);
      for (const key of TAB_SCOPED_PARAMS) url.searchParams.delete(key);
      // Diff mode (?view=diff) is shared by analyze + verify but is
      // section-specific in meaning, so don't carry it across sections.
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
