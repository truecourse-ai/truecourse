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
  it('ships OSS analysis and drift sections', () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(ids).toContain('analysis');
    expect(ids).toContain('drift');
  });

  it('getSection returns descriptor or undefined', () => {
    expect(getSection('analysis')?.label).toBe('Code Analysis');
    expect(getSection('drift')?.label).toBe('BL Drift');
    expect(getSection('nope')).toBeUndefined();
  });

  it('tabsForSection returns section tabs (or empty)', () => {
    const tabs = tabsForSection('drift').map((t) => t.id);
    expect(tabs).toEqual(['spec', 'contracts', 'verify', 'decisions']);
    expect(tabsForSection('nope')).toEqual([]);
  });

  it('defaultTabForSection returns the registered default', () => {
    expect(defaultTabForSection('analysis')).toBe('home');
    expect(defaultTabForSection('drift')).toBe('spec');
    expect(defaultTabForSection('nope')).toBe('');
  });

  it('allTabIds covers every registered tab across sections', () => {
    const ids = allTabIds();
    for (const t of ['home', 'graphs', 'files', 'flows', 'databases', 'analyses']) {
      expect(ids.has(t)).toBe(true);
    }
    for (const t of ['spec', 'contracts', 'verify', 'decisions']) {
      expect(ids.has(t)).toBe(true);
    }
  });

  it('getTab finds tabs irrespective of section', () => {
    expect(getTab('spec')?.label).toBe('Spec');
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
    expect(screen.getByTestId('sections')).toHaveTextContent(/^analysis,drift$/);
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
      /^analysis,drift,governance$/,
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
});
