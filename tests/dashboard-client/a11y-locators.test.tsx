/**
 * The dashboard surfaces that a roles-and-names driver (and a screen reader)
 * could not address, pinned where they were fixed.
 *
 * Four holes, each recorded as a locator risk by the guard reference scenarios:
 *  1. Architecture-graph nodes were anonymous `group`s — a database node could
 *     not be clicked by name. `useGraph` now names every node; this file proves
 *     the name actually reaches the rendered node wrapper (React Flow puts
 *     `role="group"` + `aria-label` there, and `group` takes no name from its
 *     contents, so only the node's own `ariaLabel` can name it).
 *  2. The Home rail badge was a bare number the icon's accessible name
 *     excluded. The BUTTON's name must stay the bare tab label — scenarios
 *     click `role=button name="Home"` with exact matching — so the count is
 *     named on the badge itself, as a `status` region.
 *  3. The analytics/violations divider was a bare div: no role, no name.
 *  4. The detection switch, the category tabs and the rules All/On/Off switch
 *     marked their selection with COLOUR alone — nothing in the accessibility
 *     tree said which position was taken.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppProvider } from '@/contexts/CapabilityContext';
import { LeftSidebar } from '@/components/layout/LeftSidebar';
import { GraphCanvas } from '@/components/graph/GraphCanvas';
import { HomePanel } from '@/components/pages/HomePanel';
import { ViolationsPanel } from '@/components/violations/ViolationsPanel';
import { RulesPanel } from '@/components/rules/RulesPanel';
import type { RuleResponse } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    getRules: vi.fn(async (): Promise<RuleResponse[]> => []),
    getUiState: vi.fn(async () => ({})),
    saveUiState: vi.fn(async () => undefined),
  };
});

// HomePanel's analytics come from the server; the divider is what's under test.
vi.mock('@/hooks/useAnalytics', () => ({
  useAnalytics: () => ({
    trend: null,
    breakdown: null,
    topOffenders: null,
    resolution: null,
    codeHotspots: null,
    isLoading: false,
    error: null,
    refetch: () => {},
  }),
}));

// jsdom has no layout and no ResizeObserver; React Flow needs both to mount.
const realResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = realResizeObserver;
});

function withApp(ui: React.ReactNode) {
  return (
    <AppProvider initial={{ edition: 'community', capabilities: ['local-filesystem'] }}>
      {ui}
    </AppProvider>
  );
}

/* ------------------------------------------------------------------ 1. graph */

describe('Architecture graph — a node is addressable by role and name', () => {
  const databaseNode = {
    id: 'postgres',
    type: 'database',
    ariaLabel: 'postgres',
    position: { x: 0, y: 0 },
    // jsdom measures nothing, and React Flow keeps an unmeasured node
    // `visibility: hidden` — which would drop it out of the accessibility tree
    // for reasons unrelated to its name. Hand it the size the observer would.
    measured: { width: 180, height: 96 },
    data: {
      label: 'postgres',
      databaseType: 'postgres',
      tableCount: 2,
      connectedServices: ['api'],
    },
  };

  it('renders the database node as a group named by its label', async () => {
    render(
      withApp(
        <GraphCanvas
          initialNodes={[databaseNode as never]}
          initialEdges={[]}
          repoId="repo-1"
          depthLevel="services"
          onDepthChange={() => {}}
        />,
      ),
    );

    // `group` takes no name from its contents — this passes only because the
    // node carries `ariaLabel`, which React Flow renders as the wrapper's
    // aria-label. It is the exact locator the graph scenario clicks.
    const node = await screen.findByRole('group', { name: 'postgres' });
    expect(node).toHaveClass('react-flow__node');
    expect(node.textContent).toContain('2 tables');
  });
});

/* ------------------------------------------------------- 2. rail badge count */

describe('Left rail — the badge count is named, the button name is not touched', () => {
  function renderRail(badge: number) {
    return render(
      withApp(
        <LeftSidebar section="codequality" activeTab="home" onTabChange={() => {}} badgeCounts={{ home: badge }}>
          <div>panel</div>
        </LeftSidebar>,
      ),
    );
  }

  it('keeps the Home rail button named exactly "Home"', () => {
    renderRail(12);

    // Scenarios click this button with exact matching — appending the count to
    // the button's own name would break every one of them.
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
  });

  it('names the badge with the tab and its violation count', () => {
    renderRail(12);

    expect(screen.getByRole('status', { name: 'Home, 12 violations' })).toHaveTextContent('12');
  });

  it('says "violation" once and follows the count as it changes', () => {
    const { rerender } = renderRail(12);

    rerender(
      withApp(
        <LeftSidebar section="codequality" activeTab="home" onTabChange={() => {}} badgeCounts={{ home: 1 }}>
          <div>panel</div>
        </LeftSidebar>,
      ),
    );

    expect(screen.getByRole('status', { name: 'Home, 1 violation' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Home, 12 violations' })).toBeNull();
  });

  it('names the other counted tabs with their own noun', () => {
    render(
      withApp(
        <LeftSidebar
          section="codequality"
          activeTab="home"
          onTabChange={() => {}}
          badgeCounts={{ flows: 3, databases: 1, analyses: 7 }}
        >
          <div>panel</div>
        </LeftSidebar>,
      ),
    );

    expect(screen.getByRole('status', { name: 'Flows, 3 flows' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Databases, 1 database' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Analyses, 7 analyses' })).toBeInTheDocument();
    // The tab buttons keep their bare labels.
    for (const label of ['Flows', 'Databases', 'Analyses']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('renders no badge at all at zero', () => {
    renderRail(0);

    expect(screen.queryByRole('status')).toBeNull();
  });
});

/* ------------------------------------------------------------- 3. the divider */

describe('Home split — the divider is a named separator', () => {
  function renderHome() {
    return render(
      withApp(
        <HomePanel
          repoId="repo-1"
          hasAnalysis
          violations={[]}
          violationsLoading={false}
          onLocateNode={() => {}}
          onOpenFile={() => {}}
        />,
      ),
    );
  }

  it('exposes the split as a vertical separator carrying the analytics width', () => {
    renderHome();

    const divider = screen.getByRole('separator', { name: 'Analytics panel width' });
    expect(divider).toHaveAttribute('aria-orientation', 'vertical');
    expect(divider).toHaveAttribute('aria-valuenow', '630');
    expect(divider).toHaveAttribute('aria-valuemin', '300');
    expect(divider).toHaveAttribute('aria-valuemax', '800');
    expect(divider).toHaveAttribute('aria-controls', 'home-analytics-panel');
  });

  it('resizes the halves from the keyboard, and says so in aria-valuenow', async () => {
    const user = userEvent.setup();
    renderHome();

    const divider = screen.getByRole('separator', { name: 'Analytics panel width' });
    divider.focus();
    await user.keyboard('{ArrowRight}');

    expect(divider).toHaveAttribute('aria-valuenow', '646');
    expect(document.getElementById('home-analytics-panel')).toHaveStyle({ width: '646px' });

    await user.keyboard('{Home}');
    expect(divider).toHaveAttribute('aria-valuenow', '300');
    await user.keyboard('{ArrowLeft}');
    expect(divider).toHaveAttribute('aria-valuenow', '300'); // clamped at the minimum
    await user.keyboard('{End}');
    expect(divider).toHaveAttribute('aria-valuenow', '800');
  });
});

/* --------------------------------------------------------------- 4. switches */

describe('Violations filters — the taken position is state, not just colour', () => {
  function renderViolations(overrides: Partial<React.ComponentProps<typeof ViolationsPanel>> = {}) {
    return render(
      withApp(
        <ViolationsPanel
          violations={[]}
          isLoading={false}
          repoId="repo-1"
          categoryFilter="all"
          onCategoryFilterChange={() => {}}
          severityFilter="all"
          onSeverityFilterChange={() => {}}
          typeFilter="all"
          onTypeFilterChange={() => {}}
          search=""
          onSearchChange={() => {}}
          {...overrides}
        />,
      ),
    );
  }

  it('marks the detection switch position with aria-pressed', () => {
    renderViolations({ typeFilter: 'llm' });

    expect(screen.getByRole('button', { name: 'LLM' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Det' })).toHaveAttribute('aria-pressed', 'false');
    // "All" is ambiguous on this row (detection switch + category tabs), so the
    // detection one is read inside its own labelled group.
    const group = screen.getByRole('group', { name: 'Detection type filter' });
    expect(group.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  });

  it('moves the pressed position when another one is taken', async () => {
    const user = userEvent.setup();
    let typeFilter: string = 'all';
    const { rerender } = renderViolations({
      typeFilter: 'all',
      onTypeFilterChange: (t) => {
        typeFilter = t;
      },
    });

    await user.click(screen.getByRole('button', { name: 'Det' }));
    expect(typeFilter).toBe('deterministic');

    rerender(
      withApp(
        <ViolationsPanel
          violations={[]}
          isLoading={false}
          repoId="repo-1"
          categoryFilter="all"
          onCategoryFilterChange={() => {}}
          severityFilter="all"
          onSeverityFilterChange={() => {}}
          typeFilter="deterministic"
          onTypeFilterChange={() => {}}
          search=""
          onSearchChange={() => {}}
        />,
      ),
    );
    expect(screen.getByRole('button', { name: 'Det' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'LLM' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('marks the selected category tab with aria-pressed', () => {
    renderViolations({ categoryFilter: 'security' });

    expect(screen.getByRole('button', { name: 'Security' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Bugs' })).toHaveAttribute('aria-pressed', 'false');
    const group = screen.getByRole('group', { name: 'Violation category filter' });
    expect(group.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  });
});

describe('Rules panel — the All/On/Off switch states its position', () => {
  it('marks the status switch and the type switch with aria-pressed', async () => {
    const user = userEvent.setup();
    render(withApp(<RulesPanel repoId="repo-1" />));

    const statusGroup = await screen.findByRole('group', { name: 'Rule status filter' });
    const on = screen.getByRole('button', { name: 'On' });
    const off = screen.getByRole('button', { name: 'Off' });
    expect(on).toHaveAttribute('aria-pressed', 'false');
    expect(off).toHaveAttribute('aria-pressed', 'false');
    expect(statusGroup.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1); // "All"

    await user.click(on);
    await waitFor(() => expect(on).toHaveAttribute('aria-pressed', 'true'));
    expect(statusGroup.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);

    const typeGroup = screen.getByRole('group', { name: 'Rule detection type filter' });
    expect(typeGroup.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
    const categoryGroup = screen.getByRole('group', { name: 'Rule category filter' });
    expect(categoryGroup.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  });
});
