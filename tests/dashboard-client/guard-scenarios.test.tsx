/**
 * Guard Scenarios-tab tests for the list-in-panel layout: the LEFT PANEL
 * (doc › section grouped inventory of committed scenarios AND the quiet tool-defect
 * residue — headers show the section's HUMAN heading text, never the anchor slug;
 * rows label by human TITLE with the id demoted to mono meta so a long slug can't
 * overflow; the residue carries a muted "tool defect" chip and a "Tool defect"
 * status filter, listed AFTER the committed scenarios),
 * the MAIN-PANE OVERVIEW (recipe card + the flat "last generate" strip with its
 * stat chips and the deferred-authoring-errors detail; the residue lives only in the
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
import { buildFamilyEscalationRows, buildFindingRows, buildListRows } from '@/lib/guard-list-rows';
import { dismissedClaimKey } from '@truecourse/shared';
import { sectionLeaf } from '@/lib/guard-drifts';

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
          if (f) return { ...t, label: f.title, title: `${f.doc} · ${f.headingText ?? sectionLeaf(f.anchor)}` };
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
          repoId="r"
          row={activeFinding}
          onClose={() => tabs.close(activeFinding.id)}
          onOpenSpec={onOpenSpec}
          onDismiss={async () => {}}
          onUndismiss={async () => {}}
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

describe('GuardScenariosPanel — flat inventory + flags', () => {
  beforeEach(() => stubFetch());

  it('renders a FLAT list — every row badged, no doc or section headers', async () => {
    renderHarness();
    await screen.findByText('alpha claim');
    const list = inventoryList();
    // Generated fail, hand-written pass, orphaned, and a never-run (neutral guarded).
    expect(within(list).getByText('Failing')).toBeInTheDocument();
    expect(within(list).getByText('Orphaned')).toBeInTheDocument();
    expect(within(list).getByText('Guarded (no run)')).toBeInTheDocument();
    // The hand-written scenario is flagged; the generated ones are not.
    expect(within(list).getAllByText('hand-written')).toHaveLength(1);
    // NO grouping headers: neither doc paths nor section heading text render in
    // the list — that context lives in the detail pane.
    expect(within(list).queryByText('docs/auth.md')).not.toBeInTheDocument();
    expect(within(list).queryByText('docs/other.md')).not.toBeInTheDocument();
    expect(within(list).queryByText('10.7 The Local Developer Loop')).not.toBeInTheDocument();
    expect(within(list).queryByText('Beta Rules')).not.toBeInTheDocument();
  });

  it('filters by document', async () => {
    const user = userEvent.setup();
    renderHarness();
    await screen.findByText('alpha claim');
    await user.selectOptions(screen.getByLabelText('Filter by document'), 'docs/other.md');
    const list = inventoryList();
    expect(within(list).getByText('orphan claim')).toBeInTheDocument();
    expect(within(list).queryByText('alpha claim')).not.toBeInTheDocument();
    expect(within(list).queryByText('hand rolled')).not.toBeInTheDocument();
    expect(within(list).queryByText('docs/auth.md')).not.toBeInTheDocument();
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

describe('GuardScenariosPanel — tool-defect residue rows', () => {
  beforeEach(() => stubFetch());

  it('renders each defect as a row with a muted "tool defect" chip', async () => {
    renderHarness();
    await panelRowAsync('login rate limits');
    const list = inventoryList();
    // The tool-defect row: its title + the muted chip (lowercase DOM text) — never
    // the red "finding"/"drift" wording.
    expect(within(list).getByText('login rate limits')).toBeInTheDocument();
    expect(within(list).getByText('tool defect')).toBeInTheDocument();
    expect(within(list).queryByText('finding')).not.toBeInTheDocument();
    // No section header renders for it — the flat list carries rows only.
    expect(within(list).queryByText('rate-limiting')).not.toBeInTheDocument();
  });

  it('lists the tool-defect residue AFTER the committed scenarios, with no block headers', async () => {
    renderHarness();
    await panelRowAsync('login rate limits');
    const list = inventoryList();
    expect(within(list).queryByText('Findings')).not.toBeInTheDocument();
    expect(within(list).queryByText('Scenarios')).not.toBeInTheDocument();
    // Quiet, never bad-news-first: the FIRST listitem is a committed scenario, and the
    // tool-defect row follows the scenario rows rather than leading them.
    expect(within(list).getAllByRole('listitem')[0]).not.toHaveTextContent('login rate limits');
    const defect = within(list).getByText('login rate limits');
    const scenario = within(list).getByText('alpha claim');
    expect(scenario.compareDocumentPosition(defect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders neither block header when no findings are visible', async () => {
    const user = userEvent.setup();
    renderHarness();
    await panelRowAsync('login rate limits');
    // Isolate a scenario status → the finding drops out of the visible set.
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'fail');
    const list = inventoryList();
    expect(within(list).getByText('alpha claim')).toBeInTheDocument();
    expect(within(list).queryByText('login rate limits')).not.toBeInTheDocument();
    // With no visible findings the list reads as one plain doc › section inventory —
    // neither the "Findings" nor the "Scenarios" block label renders.
    expect(within(list).queryByText('Findings')).not.toBeInTheDocument();
    expect(within(list).queryByText('Scenarios')).not.toBeInTheDocument();
  });

  it('counts scenarios and tool defects separately in the count line', async () => {
    renderHarness();
    await panelRowAsync('login rate limits');
    const line = screen.getByText(/of 4 scenarios/);
    expect(line).toHaveTextContent('4 of 4 scenarios · 1 tool defect');
  });

  it('the "Tool defect" status filter isolates the residue in one click', async () => {
    const user = userEvent.setup();
    renderHarness();
    await panelRowAsync('login rate limits');
    // The residue's list status value is unchanged (the "finding" pseudo-status); only
    // its label reads "Tool defect" now.
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'finding');
    expect(screen.getByRole('option', { name: 'Tool defect' })).toBeInTheDocument();
    const list = inventoryList();
    expect(within(list).getByText('login rate limits')).toBeInTheDocument();
    expect(within(list).queryByText('alpha claim')).not.toBeInTheDocument();
    expect(within(list).queryByText('orphan claim')).not.toBeInTheDocument();
  });

  it('free-text search matches tool-defect titles', async () => {
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


describe('buildFindingRows — section-heading preference', () => {
  // A committed scenario donates a DIFFERENT heading for the same doc/anchor so the
  // preference order is observable.
  const scenarioRows = [
    { id: 'h1', title: 'h1', doc: 'docs/auth.md', anchor: 'auth/beta', headingText: 'Client Resolver Heading', file: 'h1.yaml', handWritten: true, lastResult: null },
  ] as const;
  const reportWith = (headingText?: string): GuardGenerateReport => ({
    ...REPORT,
    birthFindings: [{ doc: 'docs/auth.md', anchor: 'auth/beta', title: 'f', step: 1, expected: 'x', actual: 'y', ...(headingText ? { headingText } : {}) }],
  });

  it('prefers the report server-joined headingText over the client resolver', () => {
    const [row] = buildFindingRows(reportWith('Server Joined Heading'), scenarioRows);
    expect(row.headingText).toBe('Server Joined Heading');
  });

  it('falls back to the client resolver when the report carries no headingText', () => {
    const [row] = buildFindingRows(reportWith(), scenarioRows);
    expect(row.headingText).toBe('Client Resolver Heading');
  });

  it('leaves headingText undefined when neither the report nor a scenario joins', () => {
    const [row] = buildFindingRows(reportWith(), []);
    expect(row.headingText).toBeUndefined();
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
    // No item tabs → no strip and no Overview chip; the overview content is the pane.
    expect(screen.queryByText('Overview')).toBeNull();
    // Open a scenario: the strip appears with Overview FIRST — non-italic, never a
    // close affordance — sitting before the item tab.
    await user.click(panelRow('alpha claim'));
    expect(overviewTab()).toBeInTheDocument();
    expect(overviewTab()).not.toHaveClass('italic');
    expect(overviewTab()).toHaveClass('font-medium');
    expect(screen.queryByLabelText('Close Overview')).toBeNull();
    expect(tabLabel('a1', 'alpha claim')).toBeInTheDocument();
    expect(
      overviewTab().compareDocumentPosition(closeBtn('a1')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('is active with no ?gscn; clicking it clears the item selection WITHOUT closing tabs', async () => {
    const user = userEvent.setup();
    renderHarness();
    await screen.findByText('Recipe');
    // No item tabs yet → no strip at all.
    expect(screen.queryByText('Overview')).toBeNull();

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
    expect(overviewTab()).toBeInTheDocument();
    await user.click(closeBtn('a1'));
    expect(gscn()).toBe('∅');
    // Last item tab closed → overview content returns AND the strip/chip is gone.
    expect(await screen.findByText('Recipe')).toBeInTheDocument();
    expect(screen.queryByText('Overview')).toBeNull();
  });
});

describe('GuardScenarioDetail — full scenario story', () => {
  beforeEach(() => stubFetch());

  it('renders the failure detail, binding, and the evidence transcript expanded on mount', async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(await screen.findByText('alpha claim'));
    expect(await screen.findByText('exit code 1')).toBeInTheDocument();
    expect(screen.getByText('exit code 0')).toBeInTheDocument();
    // The doc now also heads the left-list group, so scope to the detail's binding.
    const binding = screen.getByText('Binding').parentElement as HTMLElement;
    expect(within(binding).getByText('docs/auth.md')).toBeInTheDocument();
    expect(screen.getByText('§ auth/10-7-the-local-developer-loop')).toBeInTheDocument();
    // No View/Hide evidence toggle — the transcript loads on mount, shown expanded.
    expect(screen.queryByText('View evidence')).not.toBeInTheDocument();
    expect(await screen.findByText('EVIDENCE-TRANSCRIPT-XYZ')).toBeInTheDocument();
  });

  it('renders a passing scenario’s evidence transcript open on mount when the run captured one', async () => {
    const user = userEvent.setup();
    // The passing h1 carries an evidencePath (evidence for passes too).
    const withPassEvidence: GuardLatest = {
      ...LATEST,
      scenarios: LATEST.scenarios.map((s) =>
        s.id === 'h1' ? { ...s, evidencePath: 'guard/evidence/RUN1/h1/transcript.txt' } : s,
      ),
    };
    stubFetch(INVENTORY, withPassEvidence);
    renderHarness();
    await user.click(await screen.findByText('hand rolled'));
    // The transcript loads on mount, shown expanded — no toggle, same as a failure's.
    expect(screen.queryByText('View evidence')).not.toBeInTheDocument();
    expect(await screen.findByText('EVIDENCE-TRANSCRIPT-XYZ')).toBeInTheDocument();
    // But no failure detail — a pass has no expected/actual.
    expect(screen.queryByText('Expected')).not.toBeInTheDocument();
  });

  it('renders no evidence section for a pass without a captured transcript (older run)', async () => {
    const user = userEvent.setup();
    renderHarness(); // the default LATEST's h1 pass has no evidencePath
    await user.click(await screen.findByText('hand rolled'));
    await screen.findByRole('heading', { name: 'hand rolled' });
    expect(screen.queryByLabelText('evidence transcript')).not.toBeInTheDocument();
    expect(screen.queryByText('EVIDENCE-TRANSCRIPT-XYZ')).not.toBeInTheDocument();
  });

  it('the scenario and finding details render no close X of their own', async () => {
    const user = userEvent.setup();
    stubFetch(INVENTORY, LATEST, REPORT);
    renderHarness();
    await panelRowAsync('alpha claim');

    // Scenario detail — its own "Close scenario" X is gone.
    await user.click(within(inventoryList()).getByText('alpha claim'));
    await screen.findByRole('heading', { name: 'alpha claim' });
    expect(screen.queryByLabelText('Close scenario')).not.toBeInTheDocument();

    // Finding detail — its own "Close finding" X is gone.
    await user.click(within(inventoryList()).getByText('login rate limits'));
    await screen.findByRole('heading', { name: 'login rate limits' });
    expect(screen.queryByLabelText('Close finding')).not.toBeInTheDocument();

    // The only close affordances left are the tab strip's per-tab X buttons.
    expect(screen.getAllByLabelText(/^Close /).length).toBeGreaterThan(0);
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

  // Fix 1 (PR 1) — the failing run's raw program output rides on the failure.
  it('renders the Program output section with stdout/stderr beneath expected/actual', async () => {
    const user = userEvent.setup();
    const withOutput: GuardLatest = {
      ...LATEST,
      scenarios: LATEST.scenarios.map((s) =>
        s.id === 'a1'
          ? { ...s, failure: { ...s.failure!, stdout: 'expense-add-ran-ok', stderr: 'usage: add --amount <n>' } }
          : s,
      ),
    };
    stubFetch(INVENTORY, withOutput);
    renderHarness();
    await user.click(await screen.findByText('alpha claim'));
    await screen.findByText('exit code 1');
    expect(screen.getByText('Program output')).toBeInTheDocument();
    expect(screen.getByText('expense-add-ran-ok')).toBeInTheDocument();
    expect(screen.getByText('usage: add --amount <n>')).toBeInTheDocument();
  });

  it('omits the Program output section when the failure carries no excerpts', async () => {
    const user = userEvent.setup();
    renderHarness(); // default a1 failure has no stdout/stderr
    await user.click(await screen.findByText('alpha claim'));
    await screen.findByText('exit code 1');
    expect(screen.queryByText('Program output')).not.toBeInTheDocument();
  });
});

describe('GuardFindingDetail — program-output excerpts (Fix 1)', () => {
  it('renders the Program output section from the finding excerpts', async () => {
    const user = userEvent.setup();
    const report: GuardGenerateReport = {
      ...REPORT,
      birthFindings: [{ ...REPORT.birthFindings[0], stdout: 'add-partial-output', stderr: 'usage: expense add --amount' }],
    };
    stubFetch(INVENTORY, LATEST, report);
    renderHarness();
    await user.click(await screen.findByText('login rate limits'));
    await screen.findByRole('heading', { name: 'login rate limits' });
    expect(screen.getByText('Program output')).toBeInTheDocument();
    expect(screen.getByText('add-partial-output')).toBeInTheDocument();
    expect(screen.getByText('usage: expense add --amount')).toBeInTheDocument();
  });

  it('omits the Program output section for a finding without excerpts', async () => {
    const user = userEvent.setup();
    stubFetch(INVENTORY, LATEST, REPORT); // REPORT finding has no stdout/stderr
    renderHarness();
    await user.click(await screen.findByText('login rate limits'));
    await screen.findByRole('heading', { name: 'login rate limits' });
    expect(screen.queryByText('Program output')).not.toBeInTheDocument();
  });
});

describe('GuardScenariosPanel — PR baseline-fallback label', () => {
  const FALLBACK_LABEL = "Showing the baseline scenarios — this PR didn't regenerate them.";
  const rows = () =>
    buildListRows(
      [
        {
          id: 'a1',
          title: 'alpha claim',
          doc: 'docs/auth.md',
          anchor: 'auth/alpha',
          headingText: 'Alpha',
          file: 'core/a1.yaml',
          handWritten: false,
          lastResult: null,
        },
      ],
      [],
    );

  it('labels a PR view whose inventory fell back to the baseline set', () => {
    render(
      <GuardScenariosPanel
        rows={rows()}
        loading={false}
        error={null}
        activeId={null}
        onOpen={vi.fn()}
        prRef="headsha456"
        scenariosCommit="basesha123"
      />,
    );
    expect(screen.getByText(FALLBACK_LABEL)).toBeInTheDocument();
  });

  it('shows no label when the head stored its own set, or outside a PR view', () => {
    const { rerender } = render(
      <GuardScenariosPanel
        rows={rows()}
        loading={false}
        error={null}
        activeId={null}
        onOpen={vi.fn()}
        prRef="headsha456"
        scenariosCommit="headsha456"
      />,
    );
    expect(screen.queryByText(FALLBACK_LABEL)).not.toBeInTheDocument();
    // Repo-level view (no PR ref): the baseline IS the view — never a label.
    rerender(
      <GuardScenariosPanel
        rows={rows()}
        loading={false}
        error={null}
        activeId={null}
        onOpen={vi.fn()}
        scenariosCommit="basesha123"
      />,
    );
    expect(screen.queryByText(FALLBACK_LABEL)).not.toBeInTheDocument();
  });
});

describe('GuardScenariosPanel — family escalation group (item 4)', () => {
  const FAMILY_REPORT: GuardGenerateReport = {
    generatedAt: '2026-07-21T00:00:00.000Z',
    status: 'ok',
    sectionsTotal: 3,
    sectionsChanged: 3,
    skippedUnchanged: 0,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
    familyEscalations: [
      {
        id: 'fam1',
        description: 'Scenarios assert a weaker proxy than the claim.',
        count: 3,
        members: [
          { doc: 'docs/cli.md', anchor: 'alpha', title: 'alpha claim' },
          { doc: 'docs/cli.md', anchor: 'beta', title: 'beta claim' },
          { doc: 'docs/cli.md', anchor: 'gamma', title: 'gamma claim' },
        ],
      },
    ],
  };

  it('lifts report.familyEscalations into rows (description + count, dismissed=false)', () => {
    const rows = buildFamilyEscalationRows(FAMILY_REPORT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'fam1', description: 'Scenarios assert a weaker proxy than the claim.', count: 3, dismissed: false });
  });

  it('marks a family dismissed once every member claim is dismissed', () => {
    const dismissed = new Set(FAMILY_REPORT.familyEscalations!.map((f) => f.members).flat().map((m) => dismissedClaimKey(m.doc, m.anchor, m.title)));
    expect(buildFamilyEscalationRows(FAMILY_REPORT, dismissed)[0].dismissed).toBe(true);
  });

  it('renders a collapsed "Tool limitations" group with a Dismiss + prefilled Report-issue link', async () => {
    const rows = buildFamilyEscalationRows(FAMILY_REPORT);
    const onDismissFamily = vi.fn();
    render(
      <GuardScenariosPanel
        rows={[]}
        families={rows}
        issueMeta={{ version: '0.7.3', repo: 'my-project' }}
        onDismissFamily={onDismissFamily}
        loading={false}
        error={null}
        activeId={null}
        onOpen={vi.fn()}
      />,
    );
    const header = screen.getByRole('button', { name: /Tool limitations/ });
    expect(header).toHaveTextContent('1');
    // Collapsed: the description is hidden until expanded.
    expect(screen.queryByText('Scenarios assert a weaker proxy than the claim.')).not.toBeInTheDocument();
    await userEvent.click(header);
    expect(screen.getByText('Scenarios assert a weaker proxy than the claim.')).toBeInTheDocument();
    expect(screen.getByText('3 claims')).toBeInTheDocument();
    // The member claims are NEVER rendered (no per-claim anything).
    expect(screen.queryByText('alpha claim')).not.toBeInTheDocument();
    // The Report-issue link points at the prefilled github issues/new URL.
    const link = screen.getByRole('link', { name: /Report issue/ });
    expect(link.getAttribute('href')).toContain('https://github.com/truecourse-ai/truecourse/issues/new?');
    // Dismiss fans out to the whole family (its member identities).
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismissFamily).toHaveBeenCalledWith(rows[0]);
  });

  it('a fully-dismissed family shows "dismissed" instead of the Dismiss button', async () => {
    const dismissed = new Set(FAMILY_REPORT.familyEscalations!.map((f) => f.members).flat().map((m) => dismissedClaimKey(m.doc, m.anchor, m.title)));
    render(
      <GuardScenariosPanel
        rows={[]}
        families={buildFamilyEscalationRows(FAMILY_REPORT, dismissed)}
        loading={false}
        error={null}
        activeId={null}
        onOpen={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Tool limitations/ }));
    expect(screen.getByText('dismissed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
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

  it('renders prominent stat chips (settled/unsettled · authored · failing · birth-passed · tool-defects · calls/cost)', async () => {
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
    // No committed drift in this report (no `written` carries a diagnosis) → 0 failing.
    expect(chip('failing')).toHaveTextContent('0');
    expect(chip('birth-passed')).toHaveTextContent('2');
    // The tool-defect residue reads quietly as "tool defects", never "findings".
    expect(chip('tool defects')).toHaveTextContent('1');
    expect(within(region).queryByText('findings')).not.toBeInTheDocument();
    expect(chip('calls')).toHaveTextContent('14');
    expect(chip('cost')).toHaveTextContent('$1.23');
  });

  it('the failing stat counts written scenarios committed with a diagnosis (real drift)', async () => {
    const withDrift: GuardGenerateReport = {
      ...REPORT,
      written: [
        { id: 'w1', title: 'w1', doc: 'd', anchor: 'a1', file: 'a1.yaml' },
        {
          id: 'w2',
          title: 'w2',
          doc: 'd',
          anchor: 'a2',
          file: 'a2.yaml',
          diagnosis: {
            step: 2,
            expected: 'exit 1',
            actual: 'exit 0',
            triage: { verdict: 'code-drift', confidence: 'high', brief: 'b', recommendation: 'r' },
          },
        },
      ],
    };
    stubFetch(INVENTORY, LATEST, withDrift);
    renderHarness();
    await screen.findByText('Last generate');
    const region = overview();
    const chip = (label: string) => within(region).getByText(label).closest('div') as HTMLElement;
    expect(chip('authored')).toHaveTextContent('2');
    expect(chip('failing')).toHaveTextContent('1');
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

  it('renders the deferred-errors line but NOT the tool-defect residue (it lives only in the left list)', async () => {
    stubFetch();
    renderHarness();
    await screen.findByText('Last generate');
    // The tool-defect residue is absent from the overview — it lives only in the left panel.
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
    // Stats still render — tool defects is 0 (honest), settled absorbs the clean sections.
    const region = overview();
    expect(within(region).getByText('tool defects')).toBeInTheDocument();
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
  it('carries a single CTA card in the main pane and a quiet muted line in the left panel', async () => {
    stubFetch(null, null, null);
    renderHarness();
    // The main pane owns the ONE CTA empty state — its title renders exactly once,
    // never a duplicate card in the left panel.
    expect(await screen.findAllByText('No scenarios yet')).toHaveLength(1);
    // The left panel is quiet: one muted line (period), not a second card.
    expect(screen.getByText('No scenarios yet.')).toBeInTheDocument();
    // The CTA points at guard generate…
    expect(screen.getByText('truecourse guard generate')).toBeInTheDocument();
    // …with no hand-written clause anywhere in the onboarding copy.
    expect(screen.queryByText(/hand-written ones under/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\.truecourse\/scenarios\//)).not.toBeInTheDocument();
  });
});

/** Wait for a panel row to render — the list mounts after inventory loads, and
 *  finding rows after the report loads (a second fetch). */
async function panelRowAsync(title: string) {
  await screen.findByRole('list', { name: 'Scenario inventory' });
  await within(inventoryList()).findByText(title);
}
