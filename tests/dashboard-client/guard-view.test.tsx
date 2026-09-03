/**
 * Guard is a top-level section (Coverage / Flows / Interfaces / Runs) and its
 * rail-dot policy matches BL Drift: amber STALENESS dots live on the header action
 * buttons (Generate/Run — pinned in guard-actions tests) ONLY, and there are NO
 * rail-tab dots of ANY kind. The findings marker that used to live on the
 * inventory tab is gone too; the "findings never bury" rule is served by the
 * Flows overview's "last generate" strip auto-expanding (proven in guard-scenarios).
 * These tests pin the LeftSidebar wiring for the guard section: the tabs render,
 * clicking reports the tab id, and no rail dot ever appears. The registry- and
 * URL-level pieces (three sections, coverage default, legacy aliases) live in
 * navigation-registry / navigation-context / section-switcher.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeftSidebar } from '@/components/layout/LeftSidebar';
import { AppProvider } from '@/contexts/CapabilityContext';

function renderRail({
  activeTab = 'coverage',
  onTabChange = () => {},
}: {
  activeTab?: string;
  onTabChange?: (tab: string | null) => void;
} = {}) {
  return render(
    <AppProvider initial={{ edition: 'community', capabilities: [] }}>
      <LeftSidebar section="guard" activeTab={activeTab} onTabChange={onTabChange}>
        <div>panel</div>
      </LeftSidebar>
    </AppProvider>,
  );
}

describe('Guard section — rail tabs', () => {
  it('renders the guard tabs on the rail (Coverage · Flows · Interfaces · Runs; no Spec, Scenarios or Generate tab)', () => {
    renderRail();
    for (const label of ['Coverage', 'Flows', 'Interfaces', 'Runs']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Spec' })).toBeNull();
    // Flows replaced the flat Scenarios inventory — a scenario is reached through
    // its flow, never as a top-level list.
    expect(screen.queryByRole('button', { name: 'Scenarios' })).toBeNull();
    // The Generate/Report tab folded into Flows — no rail tab of its own.
    expect(screen.queryByRole('button', { name: 'Generate' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Report' })).toBeNull();
  });

  it('reports the tab id when a rail tab is clicked', async () => {
    const clicks: (string | null)[] = [];
    const user = userEvent.setup();
    renderRail({ onTabChange: (t) => clicks.push(t) });

    await user.click(screen.getByRole('button', { name: 'Flows' }));
    await user.click(screen.getByRole('button', { name: 'Interfaces' }));
    await user.click(screen.getByRole('button', { name: 'Runs' }));

    expect(clicks).toEqual(['guardflows', 'interfaces', 'guarddrifts']);
  });
});

describe('Guard section — rail-dot policy (match BL Drift: dots on action buttons only)', () => {
  it('shows NO rail-tab dot of any kind — staleness lives on the header action buttons', () => {
    renderRail();
    // The old amber staleness/findings dot mechanism is removed entirely.
    expect(screen.queryAllByLabelText('stale')).toHaveLength(0);
    // No amber marker leaks onto any tab.
    for (const label of ['Coverage', 'Flows', 'Interfaces', 'Runs']) {
      const tab = screen.getByRole('button', { name: label });
      expect(tab.querySelector('.bg-amber-500, .bg-amber-400')).toBeNull();
    }
  });
});
