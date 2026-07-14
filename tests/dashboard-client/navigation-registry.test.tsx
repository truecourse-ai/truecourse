/**
 * Tests for the navigation registry.
 *
 *   - Pure lookups (getSection, tabsForSection, defaultTabForSection,
 *     allTabIds, getTab) describe the registered world; they ignore
 *     capabilities.
 *   - The capability-aware hooks (useVisibleSections,
 *     useVisibleTabsForSection) describe what the *current* edition
 *     is allowed to render and must respect requiredCapability on both
 *     sections and tabs.
 *
 * The hooks read from <AppProvider>, so every hook test wraps the
 * inspector in one with a fixed `initial` snapshot — no fetch mocking
 * needed.
 *
 * The tests also register a temporary enterprise section/tab through
 * SECTIONS.push so the gating logic is exercised end-to-end. The
 * push/pop happens inside afterEach to keep the OSS registry pristine
 * for sibling tests.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppProvider } from '@/contexts/CapabilityContext';
import {
  SECTIONS,
  getSection,
  getTab,
  tabsForSection,
  defaultTabForSection,
  allTabIds,
  useVisibleSections,
  useVisibleTabsForSection,
  type SectionDescriptor,
} from '@/navigation/registry';

// Borrow an already-registered icon so this file doesn't need
// `lucide-react` (not hoisted to the workspace root).
const STUB_ICON = SECTIONS[0].icon;

describe('navigation registry — pure lookups', () => {
  it('ships OSS analysis and guard sections (BL Drift retired)', () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(ids).toContain('codequality');
    expect(ids).toContain('guard');
    // The BL-Drift `verification` section is retired in favor of Guard.
    expect(ids).not.toContain('verification');
    // Guard is registered right after Code Analysis.
    expect(ids.indexOf('guard')).toBe(ids.indexOf('codequality') + 1);
  });

  it('getSection returns descriptor or undefined', () => {
    expect(getSection('codequality')?.label).toBe('Code Analysis');
    expect(getSection('guard')?.label).toBe('Guard');
    expect(getSection('verification')).toBeUndefined();
    expect(getSection('nope')).toBeUndefined();
  });

  it('the code-analysis section carries the relocated github-gate settings tab', () => {
    // `settings` (repo-wide gate config) moved out of the retired BL-Drift section
    // into Code Analysis, where the EE Code Quality bar sources it.
    const tabs = tabsForSection('codequality').map((t) => t.id);
    expect(tabs).toContain('settings');
    expect(getTab('settings')?.requiredCapability).toBe('github-gate');
    expect(tabsForSection('nope')).toEqual([]);
    // The retired BL-Drift tabs are gone from every section.
    const allIds = SECTIONS.flatMap((s) => s.tabs.map((t) => t.id));
    for (const gone of ['spec', 'contracts', 'inferred', 'driftanalytics', 'pulls']) {
      expect(allIds).not.toContain(gone);
    }
  });

  it('the guard section carries coverage / scenarios / drifts tabs (Generate folded into Scenarios; Coverage absorbed the Spec tab)', () => {
    expect(tabsForSection('guard').map((t) => t.id)).toEqual([
      'coverage',
      'scenarios',
      'guarddrifts',
    ]);
  });

  it('the guard Runs tab uses the ClipboardList run idiom (not the Drifts-leftover TriangleAlert)', () => {
    // Icons are compared by reference so this file needn't import lucide-react.
    // guarddrifts uses ClipboardList (the run idiom, shared with the Analyses
    // tab) and must NOT be the `violations` tab's TriangleAlert.
    expect(getTab('guarddrifts')?.icon).toBe(getTab('analyses')?.icon);
    expect(getTab('guarddrifts')?.icon).not.toBe(getTab('violations')?.icon);
  });

  it('no longer registers a guardreport tab — its generate story folded into the Scenarios strip', () => {
    expect(getTab('guardreport')).toBeUndefined();
    expect(tabsForSection('guard').map((t) => t.id)).not.toContain('guardreport');
    expect(tabsForSection('guard').find((t) => t.id === 'scenarios')?.label).toBe('Scenarios');
  });

  it('no longer registers a guardspec tab — Coverage absorbs the spec surface', () => {
    expect(getTab('guardspec')).toBeUndefined();
    expect(tabsForSection('guard').map((t) => t.id)).not.toContain('guardspec');
  });

  it('defaultTabForSection returns the registered default', () => {
    expect(defaultTabForSection('codequality')).toBe('home');
    expect(defaultTabForSection('guard')).toBe('coverage');
    expect(defaultTabForSection('nope')).toBe('');
  });

  it('allTabIds covers every registered tab across sections', () => {
    const ids = allTabIds();
    for (const t of ['home', 'graphs', 'files', 'flows', 'databases', 'analyses', 'settings']) {
      expect(ids.has(t)).toBe(true);
    }
    for (const t of ['coverage', 'scenarios', 'guarddrifts']) {
      expect(ids.has(t)).toBe(true);
    }
  });

  it('getTab finds tabs irrespective of section', () => {
    expect(getTab('coverage')?.label).toBe('Coverage');
    expect(getTab('flows')?.label).toBe('Flows');
    expect(getTab('nope')).toBeUndefined();
  });
});

describe('navigation registry — capability gating', () => {
  // Probes that render the hook output as JSON so we can assert with
  // a single getByTestId().textContent. Keeps each test trivial to
  // read.
  function VisibleSectionsProbe() {
    const sections = useVisibleSections();
    return (
      <span data-testid="sections">
        {sections.map((s) => s.id).join(',')}
      </span>
    );
  }
  function VisibleTabsProbe({ section }: { section: string }) {
    const tabs = useVisibleTabsForSection(section);
    return (
      <span data-testid="tabs">{tabs.map((t) => t.id).join(',')}</span>
    );
  }

  // Test-only ee/ contribution. Removed after each test so we don't
  // leak state into the OSS registry.
  const ENTERPRISE_SECTION: SectionDescriptor = {
    id: 'governance',
    label: 'Governance',
    description: 'PR gates, integrations, SSO admin',
    icon: STUB_ICON,
    defaultTab: 'pr-gates',
    requiredCapability: 'pr-gates',
    tabs: [
      { id: 'pr-gates', label: 'PR gates', icon: STUB_ICON },
      {
        id: 'sso-admin',
        label: 'SSO admin',
        icon: STUB_ICON,
        requiredCapability: 'sso',
      },
    ],
  };

  afterEach(() => {
    const i = SECTIONS.findIndex((s) => s.id === ENTERPRISE_SECTION.id);
    if (i >= 0) SECTIONS.splice(i, 1);
  });

  it('OSS edition hides any section gated on a capability', () => {
    SECTIONS.push(ENTERPRISE_SECTION);
    render(
      <AppProvider initial={{ edition: 'community', capabilities: [] }}>
        <VisibleSectionsProbe />
      </AppProvider>,
    );
    // Guard is OSS (ungated) so it shows alongside analysis; the
    // capability-gated `governance` section stays hidden.
    expect(screen.getByTestId('sections')).toHaveTextContent(/^codequality,guard$/);
  });

  it('enterprise edition with the capability shows the gated section', () => {
    SECTIONS.push(ENTERPRISE_SECTION);
    render(
      <AppProvider
        initial={{ edition: 'enterprise', capabilities: ['pr-gates'] }}
      >
        <VisibleSectionsProbe />
      </AppProvider>,
    );
    expect(screen.getByTestId('sections')).toHaveTextContent(
      /^codequality,guard,governance$/,
    );
  });

  it('per-tab capability gates work inside a visible section', () => {
    SECTIONS.push(ENTERPRISE_SECTION);
    // Section is visible (pr-gates is on) but the SSO tab needs its
    // own capability — which we did NOT grant.
    render(
      <AppProvider
        initial={{ edition: 'enterprise', capabilities: ['pr-gates'] }}
      >
        <VisibleTabsProbe section="governance" />
      </AppProvider>,
    );
    expect(screen.getByTestId('tabs')).toHaveTextContent(/^pr-gates$/);
  });

  it('granting the tab capability reveals it', () => {
    SECTIONS.push(ENTERPRISE_SECTION);
    render(
      <AppProvider
        initial={{ edition: 'enterprise', capabilities: ['pr-gates', 'sso'] }}
      >
        <VisibleTabsProbe section="governance" />
      </AppProvider>,
    );
    expect(screen.getByTestId('tabs')).toHaveTextContent(
      /^pr-gates,sso-admin$/,
    );
  });

  it('useVisibleTabsForSection returns [] when the parent section is gated off', () => {
    SECTIONS.push(ENTERPRISE_SECTION);
    render(
      <AppProvider initial={{ edition: 'community', capabilities: [] }}>
        <VisibleTabsProbe section="governance" />
      </AppProvider>,
    );
    expect(screen.getByTestId('tabs')).toHaveTextContent('');
  });

  it('analysis Flows/Files/Databases are an INVERSE gate on local-filesystem (OSS shows them, EE hides them)', () => {
    // OSS advertises `local-filesystem` → the full analysis tab set is visible.
    const { unmount } = render(
      <AppProvider initial={{ edition: 'community', capabilities: ['local-filesystem'] }}>
        <VisibleTabsProbe section="codequality" />
      </AppProvider>,
    );
    expect(screen.getByTestId('tabs')).toHaveTextContent(
      /^home,graphs,flows,files,databases,analyses$/,
    );
    unmount();

    // Hosted EE omits `local-filesystem` (Flows/Files/Databases vanish) but has
    // `workspace` → the EE-only Code Quality tabs (analytics/violations) appear,
    // plus the `github-gate` Settings tab. RepoPage curates which of these the bar
    // shows via EE_ANALYSIS_TAB_ORDER.
    render(
      <AppProvider initial={{ edition: 'enterprise', capabilities: ['sso', 'workspace', 'github-gate'] }}>
        <VisibleTabsProbe section="codequality" />
      </AppProvider>,
    );
    expect(screen.getByTestId('tabs')).toHaveTextContent(
      /^home,graphs,analyses,analytics,violations,settings$/,
    );
  });
});
