/**
 * Guard Scenarios-tab tests for the list-in-panel layout: the LEFT PANEL
 * (doc › section grouped inventory of committed scenarios AND birth findings —
 * headers show the section's HUMAN heading text, never the anchor slug; rows
 * label by human TITLE with the id demoted to mono meta so a long slug can't
 * overflow; findings carry a distinct red chip and a "finding" status filter),
 * the MAIN-PANE OVERVIEW (recipe card + the flat "last generate" strip with its
 * stat chips and the deferred-authoring-errors detail; findings live only in the
 * left list, not here), and the
 * TAB/PIN mechanism (single-click preview, double-click pin, `?gscn=` deep links)
 * with the scenario AND finding detail panes. The harness mirrors RepoPage's
 * scenarios-tab wiring: hoisted useGuardScenarios/useGuardReport + the guard-scoped
 * useGuardScenarioTabs feeding the unified list rows, tab bar, and main pane. Fetch
 * is stubbed the house way (`vi.stubGlobal('fetch', …)`) under a MemoryRouter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { GuardGenerateReport, GuardLatest, GuardScenarioInventory } from '@truecourse/shared';
import { GuardScenariosPanel } from '@/components/guard/GuardScenariosPanel';
import { GuardScenariosOverview } from '@/components/guard/GuardScenariosOverview';
import { GuardScenarioDetail } from '@/components/guard/GuardScenarioDetail';
import { GuardFindingDetail } from '@/components/guard/GuardFindingDetail';
import { GuardTabStrip } from '@/components/guard/GuardTabStrip';
import { useGuardScenarios } from '@/hooks/useGuardScenarios';
import { useGuardScenarioTabs } from '@/hooks/useGuardScenarioTabs';
import { useGuardReport } from '@/hooks/useGuardReport';
import { buildFindingRows, buildListRows } from '@/lib/guard-list-rows';
import { docBasename, sectionLeaf } from '@/lib/guard-drifts';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const notFound = () => new Response(JSON.stringify({ error: 'nope' }), { status: 404 });

const INVENTORY: GuardScenarioInventory = {
  recipe: {
    build: 'pnpm build',
    entry: ['node', 'dist/index.js'],
    env: { APP_MODE: 'test' },
    fingerprint: 'sha256:9f2caabbccdd',
    stale: true,
  },
  scenarios: [
    // Section group headers render the human headingText, never the slug. The
    // orphaned o1 binds a section that no longer exists — no headingText joins,
    // so its group falls back to the slug leaf.
    { id: 'a1', title: 'alpha claim', doc: 'docs/auth.md', anchor: 'auth/10-7-the-local-developer-loop', headingText: '10.7 The Local Developer Loop', file: 'core/a1.yaml', handWritten: false },
    { id: 'h1', title: 'hand rolled', doc: 'docs/auth.md', anchor: 'auth/beta', headingText: 'Beta Rules', file: 'core/h1.yaml', handWritten: true },
    { id: 'o1', title: 'orphan claim', doc: 'docs/other.md', anchor: 'other/gone', file: 'core/o1.yaml', handWritten: false },
    { id: 'n1', title: 'never run', doc: 'docs/other.md', anchor: 'other/new', headingText: 'New Things', file: 'core/n1.yaml', handWritten: false },
  ],
};

const binds = (section: string, doc = 'docs/auth.md') => ({ doc, section, fingerprint: 'sha256:x' });

const LATEST: GuardLatest = {
  run: { runId: 'RUN1', ranAt: '2026-07-07T00:00:00.000Z', branch: 'main', commit: 'abc', recipeFingerprint: 'sha256:r', scenarioFormat: 1 },
  summary: { total: 3, pass: 1, fail: 1, stale: 0, orphaned: 1, error: 0 },
  scenarios: [
    {
      id: 'a1',
      title: 'alpha claim',
      binds: binds('auth/10-7-the-local-developer-loop'),
      outcome: 'fail',
      durationMs: 5,
      failure: { step: 2, expected: 'exit code 1', actual: 'exit code 0' },
      evidencePath: 'guard/evidence/RUN1/a1/transcript.txt',
    },
    { id: 'h1', title: 'hand rolled', binds: binds('auth/beta'), outcome: 'pass', durationMs: 2 },
    { id: 'o1', title: 'orphan claim', binds: binds('other/gone', 'docs/other.md'), outcome: 'orphaned', durationMs: 0 },
  ],
  sections: [],
};

// The synthesized key for the single birth finding — `finding:<anchor>:<index>`.
const FINDING_KEY = 'finding:authentication/login/rate-limiting:0';

// The last-generate report the overview reads AND the source of the panel's birth
// findings. Findings ∪ errors span 4 distinct sections (auth/login-rate-limiting +
// auth/beta + sec/z,w) of 12 changed → 8 settled / 4 unsettled. The auth/beta error
// binds a committed section (h1) so its heading resolves to "Beta Rules".
const REPORT: GuardGenerateReport = {
  generatedAt: '2026-07-07T00:00:00.000Z',
  status: 'ok',
  sectionsTotal: 40,
  sectionsChanged: 12,
  skippedUnchanged: 28,
  noChanges: false,
  written: [
    { id: 'w1', title: 'w1', doc: 'd', anchor: 'a1', file: 'a1.yaml' },
    { id: 'w2', title: 'w2', doc: 'd', anchor: 'a2', file: 'a2.yaml' },
  ],
  coverageGaps: [],
  birthFindings: [
    {
      doc: 'docs/auth.md',
      anchor: 'authentication/login/rate-limiting',
      title: 'login rate limits',
      step: 2,
      expected: 'exit code 1',
      actual: 'exit code 0',
    },
  ],
  errors: [
    { doc: 'docs/auth.md', anchor: 'auth/beta', message: 'invalid verb "frobnicate" at step 3' },
    { doc: 'd', anchor: 'sec/z', message: 'invalid verb "wibble" at step 9' },
    { doc: 'd', anchor: 'sec/w', message: 'schema mismatch on setup.files' },
  ],
  extractionFailures: [],
  orphaned: [],
  birthPassed: 2,
  usage: { calls: 14, inputTokens: 120000, outputTokens: 8000, costUsd: 1.23 },
};

// A generate that settled clean — no findings, no errors (strip is just the summary line).
const CLEAN_REPORT: GuardGenerateReport = { ...REPORT, birthFindings: [], errors: [] };

function stubFetch(
  inventory: GuardScenarioInventory | null = INVENTORY,
  latest: GuardLatest | null = LATEST,
  report: GuardGenerateReport | null = REPORT,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/guard/report')) return report ? json(report) : notFound();
      if (u.includes('/guard/scenario?')) {
        const id = new URL(u, 'http://x').searchParams.get('id');
        return json({ id, file: `core/${id}.yaml`, content: `guard: 1\nid: ${id}\ntitle: source of ${id}` });
      }
      if (u.includes('/guard/scenarios')) return inventory ? json(inventory) : json({ recipe: null, scenarios: [] });
      if (u.includes('/guard/latest')) return latest ? json(latest) : notFound();
      if (u.includes('/guard/evidence')) return new Response('EVIDENCE-TRANSCRIPT-XYZ', { status: 200 });
      return json({});
    }),
  );
}

/**
 * Mirrors RepoPage's scenarios-tab wiring: hoisted data hooks + the guard-scoped
 * scenario tab set feeding the UNIFIED list rows (scenarios ∪ findings), the
 * shared main-pane GuardTabStrip (permanent Overview tab first), and the
 * scenario/finding detail-or-overview dispatch. Tabs label by human title with the
 * id/binding on hover; findings take the crossed-flask glyph.
 */
function Harness({ onOpenSpec }: { onOpenSpec: (doc: string, section: string) => void }) {
  const scenarios = useGuardScenarios('r', true);
  const { report } = useGuardReport('r', true);
  const tabs = useGuardScenarioTabs('r');
  const location = useLocation();
  const findingRows = buildFindingRows(report, scenarios.rows);
  const listRows = buildListRows(scenarios.rows, findingRows);
  const activeScenario = tabs.activeId ? scenarios.rows.find((r) => r.id === tabs.activeId) ?? null : null;
  const activeFinding = tabs.activeId ? findingRows.find((r) => r.id === tabs.activeId) ?? null : null;
  return (
    <div>
      <span data-testid="gscn">{new URLSearchParams(location.search).get('gscn') ?? '∅'}</span>
      <GuardTabStrip
        tabs={tabs.openTabs.map((t) => {
          const s = scenarios.rows.find((r) => r.id === t.id);
          if (s) return { ...t, label: s.title, title: s.id };
          const f = findingRows.find((r) => r.id === t.id);
          // (RepoPage also passes a distinct finding glyph; the icon is cosmetic
          // and unasserted, so the harness leaves the strip's default.)
          if (f) return { ...t, label: f.title, title: `${docBasename(f.doc)} · ${f.headingText ?? sectionLeaf(f.anchor)}` };
          return { ...t, label: t.id, title: t.id };
        })}
        activeId={tabs.activeId}
        onSelect={(t) => tabs.open(t.id, t.pinned)}
        onSelectOverview={tabs.selectOverview}
        onClose={tabs.close}
      />
      <GuardScenariosPanel
        rows={listRows}
        loading={scenarios.loading}
        error={scenarios.error}
        activeId={tabs.activeId}
        onOpen={tabs.open}
      />
      {activeScenario ? (
        <GuardScenarioDetail
          key={activeScenario.id}
          repoId="r"
          row={activeScenario}
          runId={scenarios.runId}
          onClose={() => tabs.close(activeScenario.id)}
          onOpenSpec={onOpenSpec}
        />
      ) : activeFinding ? (
        <GuardFindingDetail
          key={activeFinding.id}
          row={activeFinding}
          onClose={() => tabs.close(activeFinding.id)}
          onOpenSpec={onOpenSpec}
        />
      ) : (
        <GuardScenariosOverview
          recipe={scenarios.recipe}
          report={report}
          scenarioRows={scenarios.rows}
          hasScenarios={scenarios.rows.length > 0}
          loading={scenarios.loading}
          error={scenarios.error}
          onOpenSpec={onOpenSpec}
        />
      )}
    </div>
  );
}

function renderHarness(initialEntry = '/repos/r?section=guard&tab=scenarios') {
  const onOpenSpec = vi.fn();
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Harness onOpenSpec={onOpenSpec} />
    </MemoryRouter>,
  );
  return { onOpenSpec };
}

const inventoryList = () => screen.getByRole('list', { name: 'Scenario inventory' });
const panelRow = (title: string) => within(inventoryList()).getByText(title);
const overview = () => screen.getByRole('region', { name: 'Scenarios overview' });
const gscn = () => screen.getByTestId('gscn').textContent;

// GuardTabStrip renders each open item as a <div> containing the visible LABEL
// (the human title, italic when preview / bold when pinned) plus a `Close <id>`
// button; the id itself surfaces only on hover. The permanent Overview tab renders
// first and has no close button.
const closeBtn = (id: string) => screen.getByLabelText(`Close ${id}`);
const tabEl = (id: string) => closeBtn(id).parentElement as HTMLElement;
const tabLabel = (id: string, label: string) => within(tabEl(id)).getByText(label);
const overviewTab = () => screen.getByText('Overview');

afterEach(() => vi.unstubAllGlobals());

describe('GuardScenariosPanel — grouped inventory + flags', () => {
  beforeEach(() => stubFetch());

  it('groups rows doc › section with every committed scenario and its joined badge', async () => {
    renderHarness();
    await screen.findByText('alpha claim');
    const list = inventoryList();
    // Doc group headers…
    expect(within(list).getByText('auth.md')).toBeInTheDocument();
    expect(within(list).getByText('other.md')).toBeInTheDocument();
    // Generated fail, hand-written pass, orphaned, and a never-run (neutral guarded).
    expect(within(list).getByText('Failing')).toBeInTheDocument();
    expect(within(list).getByText('Orphaned')).toBeInTheDocument();
    expect(within(list).getByText('Guarded (no run)')).toBeInTheDocument();
    // The hand-written scenario is flagged; the generated ones are not.
    expect(within(list).getAllByText('hand-written')).toHaveLength(1);
  });

  it('section headers show the HUMAN heading text, never the anchor slug', async () => {
    renderHarness();
    await screen.findByText('alpha claim');
    const list = inventoryList();
    // Human heading text from the joined section index…
    expect(within(list).getByText('10.7 The Local Developer Loop')).toBeInTheDocument();
    expect(within(list).getByText('Beta Rules')).toBeInTheDocument();
    expect(within(list).getByText('New Things')).toBeInTheDocument();
    // …never the raw slug.
    expect(within(list).queryByText(/10-7-the-local-developer-loop/)).not.toBeInTheDocument();
    // A section that no longer exists (o1, orphaned) has no headingText — the
    // group falls back to the slug leaf rather than vanishing.
    expect(within(list).getByText('gone')).toBeInTheDocument();
  });

  it('filters by document (rows and group headers)', async () => {
    const user = userEvent.setup();
    renderHarness();
    await screen.findByText('alpha claim');
    await user.selectOptions(screen.getByLabelText('Filter by document'), 'docs/other.md');
    const list = inventoryList();
    expect(within(list).getByText('orphan claim')).toBeInTheDocument();
    expect(within(list).queryByText('alpha claim')).not.toBeInTheDocument();
    expect(within(list).queryByText('hand rolled')).not.toBeInTheDocument();
    expect(within(list).queryByText('auth.md')).not.toBeInTheDocument();
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    renderHarness();
    await screen.findByText('alpha claim');
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'fail');
    const list = inventoryList();
    expect(within(list).getByText('alpha claim')).toBeInTheDocument();
    expect(within(list).queryByText('hand rolled')).not.toBeInTheDocument();
    expect(within(list).queryByText('orphan claim')).not.toBeInTheDocument();
  });

  it('filters by free text search', async () => {
    const user = userEvent.setup();
    renderHarness();
    await screen.findByText('alpha claim');
    await user.type(screen.getByLabelText('Search scenarios'), 'orphan');
    const list = inventoryList();
    expect(within(list).getByText('orphan claim')).toBeInTheDocument();
    expect(within(list).queryByText('alpha claim')).not.toBeInTheDocument();
  });
});

describe('GuardScenariosPanel — birth findings as first-class rows', () => {
  beforeEach(() => stubFetch());

  it('renders each finding as a row with a distinct "finding" chip in its section group', async () => {
    renderHarness();
    await panelRowAsync('login rate limits');
    const list = inventoryList();
    // The finding row: its title + the distinct red chip (lowercase DOM text).
    expect(within(list).getByText('login rate limits')).toBeInTheDocument();
    expect(within(list).getByText('finding')).toBeInTheDocument();
    // Its findings-only section still gets a group header — no scenario binds this
    // anchor, so the heading falls back to the slug leaf.
    expect(within(list).getByText('rate-limiting')).toBeInTheDocument();
  });

  it('counts scenarios and findings separately in the count line', async () => {
    renderHarness();
    await panelRowAsync('login rate limits');
    const line = screen.getByText(/of 4 scenarios/);
    expect(line).toHaveTextContent('4 of 4 scenarios · 1 finding');
  });

  it('the "finding" status filter isolates findings in one click', async () => {
    const user = userEvent.setup();
    renderHarness();
    await panelRowAsync('login rate limits');
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'finding');
    const list = inventoryList();
    expect(within(list).getByText('login rate limits')).toBeInTheDocument();
    expect(within(list).queryByText('alpha claim')).not.toBeInTheDocument();
    expect(within(list).queryByText('orphan claim')).not.toBeInTheDocument();
  });

  it('free-text search matches finding titles', async () => {
    const user = userEvent.setup();
    renderHarness();
    await panelRowAsync('login rate limits');
    await user.type(screen.getByLabelText('Search scenarios'), 'rate limits');
    const list = inventoryList();
    expect(within(list).getByText('login rate limits')).toBeInTheDocument();
    expect(within(list).queryByText('alpha claim')).not.toBeInTheDocument();
  });

  it('clicking a finding opens a PREVIEW tab with its expected/actual and a synthesized ?gscn key', async () => {
    const user = userEvent.setup();
    renderHarness();
    await panelRowAsync('login rate limits');
    await user.click(within(inventoryList()).getByText('login rate limits'));
    // The finding detail opens (title heading + expected/actual).
    expect(await screen.findByRole('heading', { name: 'login rate limits' })).toBeInTheDocument();
    expect(screen.getByText('exit code 1')).toBeInTheDocument();
    expect(screen.getByText('exit code 0')).toBeInTheDocument();
    // Transient tab, addressable via the deterministic finding key.
    expect(tabLabel(FINDING_KEY, 'login rate limits')).toHaveClass('italic');
    expect(gscn()).toBe(FINDING_KEY);
  });

  it('a pinned scenario tab coexists with a finding preview tab', async () => {
    const user = userEvent.setup();
    renderHarness();
    await panelRowAsync('login rate limits');
    // Pin a scenario, then preview a finding — both tabs stay open.
    await user.dblClick(panelRow('alpha claim'));
    await user.click(within(inventoryList()).getByText('login rate limits'));
    expect(closeBtn('a1')).toBeInTheDocument();
    expect(closeBtn(FINDING_KEY)).toBeInTheDocument();
    expect(tabLabel('a1', 'alpha claim')).toHaveClass('font-medium');
    expect(tabLabel(FINDING_KEY, 'login rate limits')).toHaveClass('italic');
    expect(gscn()).toBe(FINDING_KEY);
  });

  it('a ?gscn=finding:… deep link reopens the finding while the report is on disk', async () => {
    renderHarness(`/repos/r?section=guard&tab=scenarios&gscn=${FINDING_KEY}`);
    expect(await screen.findByRole('heading', { name: 'login rate limits' })).toBeInTheDocument();
    expect(screen.getByText('exit code 1')).toBeInTheDocument();
    // The finding detail's view-in-spec targets the finding's doc + anchor.
    expect(tabLabel(FINDING_KEY, 'login rate limits')).toHaveClass('font-medium');
  });

  it('the finding detail jumps into the coverage view via view-in-spec', async () => {
    const user = userEvent.setup();
    const { onOpenSpec } = renderHarness(`/repos/r?section=guard&tab=scenarios&gscn=${FINDING_KEY}`);
    await screen.findByRole('heading', { name: 'login rate limits' });
    await user.click(screen.getByText('View in spec'));
    expect(onOpenSpec).toHaveBeenCalledWith('docs/auth.md', 'authentication/login/rate-limiting');
  });
});

describe('Guard scenario tabs — preview / replace / pin / close', () => {
  beforeEach(() => stubFetch());

  it('single-click opens a PREVIEW tab with the full detail and mirrors ?gscn', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByText('alpha claim'));
    // The detail opens (title heading) with the auto-loaded YAML source.
    expect(screen.getByRole('heading', { name: 'alpha claim' })).toBeInTheDocument();
    expect(await screen.findByText(/source of a1/)).toBeInTheDocument();
    // A transient (unpinned → italic) tab labelled by the human title; addressable.
    expect(tabLabel('a1', 'alpha claim')).toHaveClass('italic');
    expect(gscn()).toBe('a1');
  });

  it('the next single-click REPLACES the preview tab', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByText('alpha claim'));
    await user.click(panelRow('hand rolled'));
    // One tab only — h1 took the transient slot from a1.
    expect(screen.queryByLabelText('Close a1')).not.toBeInTheDocument();
    expect(tabLabel('h1', 'hand rolled')).toHaveClass('italic');
    expect(screen.getByRole('heading', { name: 'hand rolled' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'alpha claim' })).not.toBeInTheDocument();
    expect(gscn()).toBe('h1');
  });

  it('double-click PINS the tab so the next preview coexists with it', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.dblClick(await screen.findByText('alpha claim'));
    expect(tabLabel('a1', 'alpha claim')).toHaveClass('font-medium');
    await user.click(panelRow('hand rolled'));
    // Both tabs open: the pinned a1 plus the transient h1; h1 is active.
    expect(tabLabel('a1', 'alpha claim')).toHaveClass('font-medium');
    expect(tabLabel('h1', 'hand rolled')).toHaveClass('italic');
    expect(gscn()).toBe('h1');
  });

  it('closing the tab returns to the overview and clears ?gscn', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByText('alpha claim'));
    await user.click(closeBtn('a1'));
    expect(screen.queryByLabelText('Close a1')).not.toBeInTheDocument();
    // Back on the overview: the recipe card shows again.
    expect(await screen.findByText('Recipe')).toBeInTheDocument();
    expect(gscn()).toBe('∅');
  });

  it('a ?gscn deep link opens the scenario as a pinned tab', async () => {
    renderHarness('/repos/r?section=guard&tab=scenarios&gscn=a1');
    expect(await screen.findByRole('heading', { name: 'alpha claim' })).toBeInTheDocument();
    expect(tabLabel('a1', 'alpha claim')).toHaveClass('font-medium');
  });
});

describe('Guard scenario tabs — permanent Overview tab', () => {
  beforeEach(() => stubFetch());

  it('renders an Overview tab FIRST — non-italic and never closable', async () => {
    const user = userEvent.setup();
    renderHarness();
    await screen.findByText('Recipe');
    expect(overviewTab()).toBeInTheDocument();
    expect(overviewTab()).not.toHaveClass('italic');
    expect(overviewTab()).toHaveClass('font-medium');
    // Open a scenario: the Overview stays, still with no close affordance, and it
    // sits before the item tab in the strip.
    await user.click(panelRow('alpha claim'));
    expect(screen.queryByLabelText('Close Overview')).toBeNull();
    expect(
      overviewTab().compareDocumentPosition(closeBtn('a1')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('is active with no ?gscn; clicking it clears the item selection WITHOUT closing tabs', async () => {
    const user = userEvent.setup();
    renderHarness();
    await screen.findByText('Recipe');
    expect(overviewTab().parentElement).toHaveClass('bg-background');

    await user.dblClick(panelRow('alpha claim'));
    expect(gscn()).toBe('a1');
    await user.click(overviewTab());
    expect(gscn()).toBe('∅');
    expect(await screen.findByText('Recipe')).toBeInTheDocument();
    expect(closeBtn('a1')).toBeInTheDocument();
    expect(overviewTab().parentElement).toHaveClass('bg-background');
  });

  it('activates the Overview when the last item tab closes', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByText('alpha claim'));
    expect(gscn()).toBe('a1');
    await user.click(closeBtn('a1'));
    expect(gscn()).toBe('∅');
    expect(overviewTab().parentElement).toHaveClass('bg-background');
    expect(await screen.findByText('Recipe')).toBeInTheDocument();
  });
});

describe('GuardScenarioDetail — full scenario story', () => {
  beforeEach(() => stubFetch());

  it('renders the failure detail, binding, and on-demand evidence', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByText('alpha claim'));
    expect(await screen.findByText('exit code 1')).toBeInTheDocument();
    expect(screen.getByText('exit code 0')).toBeInTheDocument();
    expect(screen.getByText('docs/auth.md')).toBeInTheDocument();
    expect(screen.getByText('§ auth/10-7-the-local-developer-loop')).toBeInTheDocument();
    await user.click(screen.getByText('View evidence'));
    expect(await screen.findByText('EVIDENCE-TRANSCRIPT-XYZ')).toBeInTheDocument();
  });

  it('shows the never-run hint for a scenario without a joined result', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByText('never run'));
    expect(await screen.findByText(/No result in the last run/)).toBeInTheDocument();
    expect(screen.getByText('truecourse guard run')).toBeInTheDocument();
  });

  it('calls onOpenSpec with the scenario doc + anchor on "view in spec"', async () => {
    const user = userEvent.setup();
    const { onOpenSpec } = renderHarness();
    await user.click(await screen.findByText('orphan claim'));
    await user.click(await screen.findByText('View in spec'));
    expect(onOpenSpec).toHaveBeenCalledWith('docs/other.md', 'other/gone');
  });
});

describe('Scenarios surface — title-first labels + long-id overflow', () => {
  const LONG_ID = '3-11-how-curateinprocess-drives-the-pipeline.1';
  const LONG_TITLE = 'How curate-in-process drives the pipeline';

  it('a long slug id renders as truncated mono meta, never the primary label', () => {
    const rows = buildListRows(
      [
        {
          id: LONG_ID,
          title: LONG_TITLE,
          doc: 'docs/pipeline.md',
          anchor: 'pipeline/3-11',
          headingText: '3.11 Pipeline',
          file: 'core/x.yaml',
          handWritten: false,
          lastResult: null,
        },
      ],
      [],
    );
    render(<GuardScenariosPanel rows={rows} loading={false} error={null} activeId={null} onOpen={vi.fn()} />);
    const list = screen.getByRole('list', { name: 'Scenario inventory' });
    // PRIMARY row text is the human title, truncated to one line.
    const title = within(list).getByText(LONG_TITLE);
    expect(title).toHaveClass('truncate');
    // The id demotes to small mono meta that can shrink + truncate (no overflow).
    const idMeta = within(list).getByText(LONG_ID);
    expect(idMeta).toHaveClass('font-mono');
    expect(idMeta).toHaveClass('truncate');
    expect(idMeta).toHaveClass('min-w-0');
    // Rows sit flush at the house `px-3` edge (like the Runs list), not a column
    // pushed far right by a doc→section→row indent stair.
    expect(within(list).getByRole('listitem')).toHaveClass('px-3');
  });

  it('the tab strip labels by title, truncated within a max width, so a long id cannot stretch it', () => {
    render(
      <GuardTabStrip
        tabs={[{ id: LONG_ID, pinned: true, label: LONG_TITLE, title: LONG_ID }]}
        activeId={LONG_ID}
        onSelect={vi.fn()}
        onSelectOverview={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const label = screen.getByText(LONG_TITLE);
    expect(label).toHaveClass('truncate');
    expect(label.className).toMatch(/max-w-/);
  });
});

describe('GuardScenariosOverview — recipe + last-generate strip', () => {
  it('shows the recipe card with build/entry/env, short fingerprint, and staleness', async () => {
    stubFetch();
    renderHarness();
    await screen.findByText('Recipe');
    expect(screen.getByText('pnpm build')).toBeInTheDocument();
    expect(screen.getByText('node dist/index.js')).toBeInTheDocument();
    expect(screen.getByText('APP_MODE=test')).toBeInTheDocument();
    expect(screen.getByText(/fingerprint 9f2caabbccdd/)).toBeInTheDocument();
    expect(screen.getByText('inputs changed')).toBeInTheDocument();
  });

  it('renders prominent stat chips (settled/unsettled · authored · birth-passed · findings · calls/cost)', async () => {
    stubFetch();
    renderHarness();
    await screen.findByText('Last generate');
    const region = overview();
    // Envelope line: when · status.
    expect(within(region).getByText(/· ok/)).toBeInTheDocument();
    // Each stat is a number-first chip: label span, its enclosing chip carries the value.
    const chip = (label: string) => within(region).getByText(label).closest('div') as HTMLElement;
    expect(chip('settled')).toHaveTextContent('8');
    expect(chip('unsettled')).toHaveTextContent('4');
    expect(chip('authored')).toHaveTextContent('2');
    expect(chip('birth-passed')).toHaveTextContent('2');
    expect(chip('findings')).toHaveTextContent('1');
    expect(chip('calls')).toHaveTextContent('14');
    expect(chip('cost')).toHaveTextContent('$1.23');
  });

  it('renders the Last generate block FLAT — a small-cap heading + summary, no boxed panel', async () => {
    stubFetch();
    renderHarness();
    await screen.findByText('Last generate');
    const heading = screen.getByText('Last generate');
    expect(heading.tagName).not.toBe('BUTTON');
    expect(heading).toHaveClass('uppercase');
    const blockRoot = heading.parentElement?.parentElement as HTMLElement;
    expect(blockRoot).not.toHaveClass('border');
    expect(blockRoot).not.toHaveClass('rounded');
    expect(blockRoot.className).not.toMatch(/bg-muted/);
  });

  it('renders the deferred-errors line but NOT birth findings (findings live only in the left list)', async () => {
    stubFetch();
    renderHarness();
    await screen.findByText('Last generate');
    // Birth findings are gone from the overview — they live only in the left panel.
    expect(within(overview()).queryByText('login rate limits')).not.toBeInTheDocument();
    // The ONE deferred line stays — counted as DISTINCT sections, not a raw error count.
    expect(
      within(overview()).getByText('3 sections deferred — will re-attempt on the next generate'),
    ).toBeInTheDocument();
  });

  it('expands a deferred pattern to the FULL message + human section links (view-in-spec)', async () => {
    const user = userEvent.setup();
    stubFetch();
    const { onOpenSpec } = renderHarness();
    await screen.findByText('Last generate');
    // Expand the most-affected pattern.
    await user.click(within(overview()).getByText(/invalid verb .+ at step N/));
    // The FULL message shows verbatim — wrapped, never truncated.
    const msg = within(overview()).getByText('invalid verb "frobnicate" at step 3');
    expect(msg).toHaveClass('whitespace-pre-wrap');
    expect(msg.className).not.toMatch(/truncate/);
    // Affected sections read by HUMAN heading ("Beta Rules" resolves from h1); each
    // is a live view-in-spec jump, not a dead slug chip.
    await user.click(within(overview()).getByText('Beta Rules'));
    expect(onOpenSpec).toHaveBeenCalledWith('docs/auth.md', 'auth/beta');
  });

  it('renders the stats but no deferred line when the last generate settled clean', async () => {
    stubFetch(INVENTORY, LATEST, CLEAN_REPORT);
    renderHarness();
    await screen.findByText('Last generate');
    // Stats still render — findings is 0 (honest), settled absorbs the clean sections.
    const region = overview();
    expect(within(region).getByText('findings')).toBeInTheDocument();
    expect(within(region).getByText('settled')).toBeInTheDocument();
    // Nothing unsettled → no deferred housekeeping line.
    expect(within(region).queryByText(/deferred/)).not.toBeInTheDocument();
  });

  it('hides the strip entirely when there is no generate report', async () => {
    stubFetch(INVENTORY, LATEST, null);
    renderHarness();
    await screen.findByText('Recipe');
    expect(screen.queryByText('Last generate')).not.toBeInTheDocument();
  });
});

describe('Guard Scenarios — empty state', () => {
  it('points at guard generate in both the panel and the overview when nothing exists', async () => {
    stubFetch(null, null, null);
    renderHarness();
    expect(await screen.findAllByText('No scenarios yet')).toHaveLength(2);
    expect(screen.getAllByText('truecourse guard generate').length).toBeGreaterThan(0);
  });
});

/** Wait for a panel row to render — the list mounts after inventory loads, and
 *  finding rows after the report loads (a second fetch). */
async function panelRowAsync(title: string) {
  await screen.findByRole('list', { name: 'Scenario inventory' });
  await within(inventoryList()).findByText(title);
}
