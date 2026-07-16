/**
 * Guard Runs view tests: the selected run's FULL results — severity-first ordering
 * of the non-pass drifts, the collapsible "passed" group (expanded when small,
 * collapsed when large, previewable pass rows), row → detail (failing step's
 * expected/actual for a drift; the `pass · Nms` last result for a pass — with its
 * own evidence transcript when the run captured one, none for an older pass without),
 * the evidence transcript fetched on mount and shown expanded (no
 * toggle), the "view in spec"
 * deep-link params, the all-green green-list (never an empty state), and the
 * no-run empty state. Fetches are stubbed the house way (`vi.stubGlobal('fetch', …)`
 * routed by URL); mounted under a MemoryRouter (the view reads/writes `?gdrift=`
 * and writes `?guard=`/`?gsec=` on the spec jump).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import type { GuardLatest, GuardScenarioResult } from '@truecourse/shared';
import { GuardDriftsView } from '@/components/guard/GuardDriftsView';
import { PASS_GROUP_EXPAND_MAX } from '@/components/guard/GuardDriftList';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const notFound = () => new Response(JSON.stringify({ error: 'nope' }), { status: 404 });

const binds = (section: string, doc = 'docs/auth.md') => ({ doc, section, fingerprint: 'sha256:abc123def456' });

const LATEST: GuardLatest = {
  run: {
    runId: '2026-07-07T00-00-00Z_run1',
    ranAt: '2026-07-07T00:00:00.000Z',
    branch: 'main',
    commit: 'abcdef1234567890',
    recipeFingerprint: 'sha256:9f2caabbccdd',
    scenarioFormat: 1,
  },
  summary: { total: 5, pass: 1, fail: 1, stale: 1, orphaned: 1, error: 1 },
  scenarios: [
    // Deliberately scrambled so ordering must do work.
    { id: 's-orphan', title: 'orphaned claim', binds: binds('auth/gone'), outcome: 'orphaned', durationMs: 0 },
    { id: 's-pass', title: 'passing claim', binds: binds('auth/ok'), outcome: 'pass', durationMs: 4 },
    {
      id: 's-fail',
      title: 'login rate limits',
      binds: binds('authentication/login/rate-limiting'),
      outcome: 'fail',
      durationMs: 12,
      failure: { step: 2, expected: 'exit code 1', actual: 'exit code 0' },
      evidencePath: 'guard/evidence/run1/s-fail/transcript.txt',
    },
    { id: 's-stale', title: 'stale claim', binds: binds('auth/edited'), outcome: 'stale', durationMs: 0, currentFingerprint: 'sha256:new' },
    {
      id: 's-error',
      title: 'infra broke',
      binds: binds('auth/infra'),
      outcome: 'error',
      durationMs: 3,
      failure: { step: 1, expected: 'built', actual: 'crash' },
      evidencePath: 'guard/evidence/run1/s-error/transcript.txt',
    },
  ],
  sections: [],
};

const HISTORY = {
  runs: [
    { runId: '2026-07-07T00-00-00Z_run1', ranAt: '2026-07-07T00:00:00.000Z', branch: 'main', commit: 'abc', summary: LATEST.summary },
    { runId: '2026-07-06T00-00-00Z_run0', ranAt: '2026-07-06T00:00:00.000Z', branch: 'main', commit: 'def', summary: { total: 3, pass: 3, fail: 0, stale: 0, orphaned: 0, error: 0 } },
  ],
};

/** A pass-heavy run: `n` passing scenarios plus (optionally) one failing drift. */
function runWithPasses(n: number, withDrift = true): GuardLatest {
  const passes: GuardScenarioResult[] = Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    title: `green ${i}`,
    binds: binds(`a/${i}`),
    outcome: 'pass',
    durationMs: i,
  }));
  const drift: GuardScenarioResult[] = withDrift
    ? [
        {
          id: 's-fail',
          title: 'login rate limits',
          binds: binds('authentication/login/rate-limiting'),
          outcome: 'fail',
          durationMs: 12,
          failure: { step: 2, expected: 'exit code 1', actual: 'exit code 0' },
          evidencePath: 'guard/evidence/run1/s-fail/transcript.txt',
        },
      ]
    : [];
  return {
    ...LATEST,
    summary: { total: n + drift.length, pass: n, fail: drift.length, stale: 0, orphaned: 0, error: 0 },
    scenarios: [...drift, ...passes],
  };
}

function stubFetch(opts: { latest?: GuardLatest | null } = {}) {
  const latest = opts.latest === undefined ? LATEST : opts.latest;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/guard/latest')) return latest ? json(latest) : notFound();
      if (u.includes('/guard/history')) return json(HISTORY);
      if (u.includes('/guard/evidence')) return new Response('EVIDENCE-TRANSCRIPT-XYZ', { status: 200 });
      if (u.includes('/guard/scenario')) return json({ id: 's-fail', file: 's-fail.yaml', content: 'guard: 1\nid: s-fail' });
      if (u.includes('/guard/runs/')) return json(LATEST);
      return json({});
    }),
  );
}

/** Surfaces the live query string so the spec-jump params can be asserted. */
function LocationProbe() {
  const [params] = useSearchParams();
  return <div data-testid="qs">{params.toString()}</div>;
}

function renderView(url = '/repos/r?section=guard&tab=guarddrifts') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <GuardDriftsView repoId="r" />
      <LocationProbe />
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('GuardDriftsView — PR-scoped empty / pending state', () => {
  function stubEnvelope(body: { latest: GuardLatest | null; pending: unknown }) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/latest')) return json(body);
        if (u.includes('/guard/history')) return json(HISTORY);
        return json({});
      }),
    );
  }
  function renderPr(prRef = 'prhead1234567') {
    return render(
      <MemoryRouter initialEntries={['/repos/r?section=guard&tab=guarddrifts&pr=7']}>
        <GuardDriftsView repoId="r" prRef={prRef} />
      </MemoryRouter>,
    );
  }

  it('shows a "gate running" card when a gate is in flight for the head', async () => {
    stubEnvelope({ latest: null, pending: { status: 'running', jobId: 'job_1' } });
    renderPr();
    expect(await screen.findByText('Guard gate running')).toBeInTheDocument();
  });

  it('shows a "gate queued" card', async () => {
    stubEnvelope({ latest: null, pending: { status: 'queued', jobId: 'job_1' } });
    renderPr();
    expect(await screen.findByText('Guard gate queued')).toBeInTheDocument();
  });

  it("shows an explicit \"hasn't run at this commit yet\" card (never baseline data)", async () => {
    stubEnvelope({ latest: null, pending: null });
    renderPr();
    expect(await screen.findByText("Guard gate hasn't run at this commit yet")).toBeInTheDocument();
    // The baseline run's content must NOT leak in under the PR header.
    expect(screen.queryByText('login rate limits')).toBeNull();
  });

  it('renders the PR head run normally when one is stored at that commit', async () => {
    stubEnvelope({ latest: LATEST, pending: null });
    renderPr();
    expect(await screen.findByText('login rate limits')).toBeInTheDocument();
  });

  it('never lists the repo run history under a PR ref (baseline runs not selectable)', async () => {
    // The history stub still answers with the repo's baseline runs — the PR view
    // must not fetch/render them: only the head run, no run-picker rows.
    stubEnvelope({ latest: LATEST, pending: null });
    renderPr();
    await screen.findByText('login rate limits');
    expect(screen.getByText('No earlier runs recorded.')).toBeInTheDocument();
  });
});

describe('GuardDriftsView — PR run timeline (prNumber)', () => {
  const PR_HISTORY = {
    runs: [
      {
        runId: 'run-pr-head1',
        ranAt: '2026-07-08T00:00:00.000Z',
        branch: 'feat/x',
        commit: 'head1111',
        summary: { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
      },
      {
        runId: 'run-pr-head2',
        ranAt: '2026-07-09T00:00:00.000Z',
        branch: 'feat/x',
        commit: 'head2222',
        summary: LATEST.summary,
      },
    ],
  };
  const HEAD_RUN: GuardLatest = { ...LATEST, run: { ...LATEST.run, runId: 'run-pr-head2', commit: 'head2222' } };
  const OLDER_RUN: GuardLatest = {
    ...LATEST,
    run: { ...LATEST.run, runId: 'run-pr-head1', commit: 'head1111' },
    summary: { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
    scenarios: [{ id: 'old-pass', title: 'older head claim', binds: binds('auth/ok'), outcome: 'pass', durationMs: 1 }],
  };

  function stubPrTimeline() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/latest')) return json({ latest: HEAD_RUN, pending: null });
        // The PR view must ask for the PR-scoped timeline — the pr-less answer
        // is the repo baseline history, which must never render here.
        if (u.includes('/guard/history'))
          return new URL(u, 'http://x').searchParams.get('pr') === '7' ? json(PR_HISTORY) : json(HISTORY);
        if (u.includes('/guard/runs/run-pr-head1')) return json(OLDER_RUN);
        return json({});
      }),
    );
  }

  function renderPrTimeline() {
    return render(
      <MemoryRouter initialEntries={['/repos/r?section=guard&tab=guarddrifts&pr=7']}>
        <GuardDriftsView repoId="r" prRef="head2222" prNumber={7} />
      </MemoryRouter>,
    );
  }

  it("lists this PR's runs — one per pushed head — from the pr-scoped history", async () => {
    stubPrTimeline();
    renderPrTimeline();
    await screen.findByText('login rate limits');
    expect(screen.getByText('run-pr-head1')).toBeInTheDocument();
    expect(screen.getByText('run-pr-head2')).toBeInTheDocument();
    expect(screen.queryByText('No earlier runs recorded.')).toBeNull();
    // The repo baseline history rows never leak in.
    expect(screen.queryByText(/2026-07-06T00-00-00Z/)).toBeNull();
  });

  it("selecting an earlier head's run loads its snapshot", async () => {
    stubPrTimeline();
    renderPrTimeline();
    const user = userEvent.setup();
    await screen.findByText('login rate limits');
    await user.click(screen.getByText('run-pr-head1'));
    expect(await screen.findByText('older head claim')).toBeInTheDocument();
  });
});

describe('GuardDriftsView — ordering + list', () => {
  beforeEach(() => stubFetch());

  it('renders the non-pass scenarios severity-first (fail, error, stale, orphaned), then the passed group', async () => {
    renderView();
    await screen.findByText('login rate limits');
    const rows = screen.getAllByTitle('Click to preview, double-click to pin');
    // 4 non-pass drifts, then the single pass (auto-expanded — 1 ≤ threshold).
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveTextContent('Failing');
    expect(rows[1]).toHaveTextContent('Error');
    expect(rows[2]).toHaveTextContent('Stale');
    expect(rows[3]).toHaveTextContent('Orphaned');
    expect(rows[4]).toHaveTextContent('Passing');
    // The passing scenario is now surfaced (in the passed group), not dropped.
    expect(screen.getByText('passing claim')).toBeInTheDocument();
  });

  it('keeps the left panel to the run picker — tallies/envelope live in the overview', async () => {
    renderView();
    await screen.findByText('login rate limits');
    // No tallies group or envelope in the left panel; the run overview owns them.
    expect(screen.queryByRole('group', { name: 'Run outcomes' })).toBeNull();
    expect(screen.getByText('Recent runs')).toBeInTheDocument();
  });
});

describe('GuardDriftsView — passed group', () => {
  it('auto-expands the passed group at the threshold (≤ max shows the pass rows)', async () => {
    stubFetch({ latest: runWithPasses(PASS_GROUP_EXPAND_MAX, true) });
    renderView();
    await screen.findByText('login rate limits');
    // The passes render inline.
    expect(screen.getByText('green 0')).toBeInTheDocument();
    expect(screen.getByText(`green ${PASS_GROUP_EXPAND_MAX - 1}`)).toBeInTheDocument();
  });

  it('collapses a large passed group by default and expands it on click', async () => {
    const user = userEvent.setup();
    stubFetch({ latest: runWithPasses(PASS_GROUP_EXPAND_MAX + 1, true) });
    renderView();
    await screen.findByText('login rate limits');
    // Collapsed: the pass rows are hidden, but the failing drift still shows.
    expect(screen.queryByText('green 0')).not.toBeInTheDocument();
    // The group header carries the count and an expand affordance.
    const header = screen.getByRole('button', { name: 'Expand passed scenarios' });
    expect(header).toHaveTextContent(String(PASS_GROUP_EXPAND_MAX + 1));
    await user.click(header);
    expect(await screen.findByText('green 0')).toBeInTheDocument();
    // The affordance flips to collapse.
    expect(screen.getByRole('button', { name: 'Collapse passed scenarios' })).toBeInTheDocument();
  });

  it('opens a passing scenario WITHOUT evidence (older run) — last result, no evidence section', async () => {
    const user = userEvent.setup();
    stubFetch();
    renderView();
    await user.click(await screen.findByText('passing claim'));
    // Positive last-result block instead of a failure block ("Last result" label is
    // unique to the detail pane; the `pass · 4ms` string also appears on the row).
    expect(await screen.findByText('Last result')).toBeInTheDocument();
    expect(screen.getAllByText('pass · 4ms').length).toBeGreaterThanOrEqual(1);
    // A pass from a run that captured no transcript (no evidencePath) shows none —
    // no evidence block, no toggle, no placeholder noise.
    expect(screen.queryByText('View evidence')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('evidence transcript')).not.toBeInTheDocument();
    // The YAML source renders open (no toggle), and the binding is shown.
    expect(screen.queryByText('View YAML source')).not.toBeInTheDocument();
    expect(await screen.findByLabelText('scenario source')).toHaveTextContent('guard: 1');
    expect(screen.getByText('§ auth/ok')).toBeInTheDocument();
    // No expected/actual failure detail for a pass.
    expect(screen.queryByText('Expected')).not.toBeInTheDocument();
  });

  it('opens a passing scenario WITH evidence — renders its transcript open on mount (evidence for passes too)', async () => {
    const user = userEvent.setup();
    // A pass whose run captured a transcript carries an evidencePath.
    const withPassEvidence: GuardLatest = {
      ...LATEST,
      summary: { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios: [
        {
          id: 's-pass',
          title: 'passing claim',
          binds: binds('auth/ok'),
          outcome: 'pass',
          durationMs: 4,
          evidencePath: 'guard/evidence/run1/s-pass/transcript.txt',
        },
      ],
    };
    stubFetch({ latest: withPassEvidence });
    renderView();
    await user.click(await screen.findByText('passing claim'));
    // Still the positive last-result block…
    expect(await screen.findByText('Last result')).toBeInTheDocument();
    // …plus its own transcript, fetched on mount and shown open like a failure's
    // (no toggle) — a green guard's proof of what executed.
    expect(screen.queryByText('View evidence')).not.toBeInTheDocument();
    expect(await screen.findByText('EVIDENCE-TRANSCRIPT-XYZ')).toBeInTheDocument();
    expect(screen.getByLabelText('evidence transcript')).toBeInTheDocument();
    // No failure detail, though — a pass has no expected/actual.
    expect(screen.queryByText('Expected')).not.toBeInTheDocument();
  });
});

describe('GuardDriftsView — detail', () => {
  beforeEach(() => stubFetch());

  it('opens the detail with the failing step expected/actual on row click', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByText('login rate limits'));
    expect(await screen.findByText('exit code 1')).toBeInTheDocument();
    expect(screen.getByText('exit code 0')).toBeInTheDocument();
    // The binding doc + section are shown in the detail.
    expect(screen.getByText('§ authentication/login/rate-limiting')).toBeInTheDocument();
  });

  it('renders the evidence transcript expanded on mount', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByText('login rate limits'));
    // No View/Hide evidence toggle — the transcript loads on mount, shown expanded.
    expect(screen.queryByText('View evidence')).not.toBeInTheDocument();
    expect(await screen.findByText('EVIDENCE-TRANSCRIPT-XYZ')).toBeInTheDocument();
  });

  it('renders no close X of its own — the tab strip owns the close', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByText('login rate limits'));
    await screen.findByText('exit code 1');
    // The detail pane renders no own X (its old "Close scenario" affordance)…
    expect(screen.queryByLabelText('Close scenario')).not.toBeInTheDocument();
    // …only the tab strip's per-tab close (Close s-fail) remains.
    expect(screen.getByLabelText('Close s-fail')).toBeInTheDocument();
  });

  // Fix 1 (PR 1) — a drift detail shows the failing run's raw program output.
  it('renders the Program output section with stdout/stderr beneath expected/actual', async () => {
    const user = userEvent.setup();
    const withOutput: GuardLatest = {
      ...LATEST,
      scenarios: LATEST.scenarios.map((s) =>
        s.id === 's-fail'
          ? { ...s, failure: { ...s.failure!, stdout: 'drift-stdout-line', stderr: 'usage: login --token <t>' } }
          : s,
      ),
    };
    stubFetch({ latest: withOutput });
    renderView();
    await user.click(await screen.findByText('login rate limits'));
    expect(await screen.findByText('exit code 1')).toBeInTheDocument();
    expect(screen.getByText('Program output')).toBeInTheDocument();
    expect(screen.getByText('drift-stdout-line')).toBeInTheDocument();
    expect(screen.getByText('usage: login --token <t>')).toBeInTheDocument();
  });

  it('omits the Program output section when the failure carries no excerpts', async () => {
    const user = userEvent.setup();
    renderView(); // default s-fail failure has no stdout/stderr
    await user.click(await screen.findByText('login rate limits'));
    await screen.findByText('exit code 1');
    expect(screen.queryByText('Program output')).not.toBeInTheDocument();
  });

  it('carries the doc + section params on the "view in spec" jump', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByText('login rate limits'));
    await user.click(await screen.findByText('View in spec'));
    const qs = screen.getByTestId('qs').textContent ?? '';
    const params = new URLSearchParams(qs);
    expect(params.get('guard')).toBe('docs/auth.md');
    expect(params.get('gsec')).toBe('authentication/login/rate-limiting');
    // The jump lands on the Guard section's coverage tab and drops the drift selection.
    expect(params.get('section')).toBe('guard');
    expect(params.get('tab')).toBe('coverage');
    expect(params.get('gdrift')).toBeNull();
  });
});

describe('GuardDriftsView — flat results list', () => {
  beforeEach(() => stubFetch());

  it('renders results as one flat list — no severity headers, no inline explainers', async () => {
    renderView();
    await screen.findByText('stale claim');
    // The stale/orphaned mechanism notes live in the DETAIL pane, not the list.
    expect(screen.queryByText(/— not run\. Regenerate to re-anchor\.$/)).not.toBeInTheDocument();
    // Within the LIST, outcome text appears exactly once per row (its badge) — no
    // extra copy from a severity group header above the rows.
    const list = screen.getByTestId('drift-list');
    const staleRows = within(list).getAllByText('stale claim');
    expect(within(list).getAllByText('Stale')).toHaveLength(staleRows.length);
  });
});

describe('GuardDriftsView — selected-run header', () => {
  beforeEach(() => stubFetch());

  it('never shows a fixed "Last run" label', async () => {
    renderView();
    await screen.findByText('login rate limits');
    expect(screen.queryByText('Last run')).not.toBeInTheDocument();
  });

  it('has no Run Trend strip (removed until EE analytics)', async () => {
    renderView();
    await screen.findByText('login rate limits');
    expect(screen.queryByRole('group', { name: 'Run trend' })).toBeNull();
  });
});

describe('GuardDriftsView — run history', () => {
  it('loads a run when its history row is clicked', async () => {
    const user = userEvent.setup();
    const RUN0: GuardLatest = {
      ...LATEST,
      run: {
        ...LATEST.run,
        runId: '2026-07-06T00-00-00Z_run0',
        ranAt: '2026-07-06T00:00:00.000Z',
        recipeFingerprint: 'sha256:0000run0abcd',
      },
      summary: { total: 3, pass: 3, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios: [{ id: 'p', title: 'p', binds: binds('a/1'), outcome: 'pass', durationMs: 1 }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/latest')) return json(LATEST);
        if (u.includes('/guard/history')) return json(HISTORY);
        if (u.includes('/guard/runs/')) return json(RUN0);
        return json({});
      }),
    );
    renderView();
    await screen.findByText('login rate limits');

    // Click the older run's history row — the whole view retargets to it: the
    // overview's recipe fingerprint flips to the loaded run's.
    await user.click(screen.getByText(/2026-07-06T00-00-00Z/));
    expect(await screen.findByText(/0000run0abcd/)).toBeInTheDocument();
  });
});

describe('GuardDriftsView — states', () => {
  it('points at guard run when there is no run', async () => {
    stubFetch({ latest: null });
    renderView();
    expect(await screen.findByText('No guard run yet')).toBeInTheDocument();
    expect(screen.getByText('truecourse guard run')).toBeInTheDocument();
  });

  it('renders the green list (never an empty state) when every scenario passed', async () => {
    const allPass: GuardLatest = {
      ...LATEST,
      summary: { total: 3, pass: 3, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios: [
        { id: 'g1', title: 'green one', binds: binds('a/1'), outcome: 'pass', durationMs: 1 },
        { id: 'g2', title: 'green two', binds: binds('a/2'), outcome: 'pass', durationMs: 1 },
        { id: 'g3', title: 'green three', binds: binds('a/3'), outcome: 'pass', durationMs: 1 },
      ],
    };
    stubFetch({ latest: allPass });
    renderView();
    // Positive header line — not the old "No drift" empty state.
    expect(await screen.findByText('3 passed · no drift')).toBeInTheDocument();
    expect(screen.queryByText('No drift')).not.toBeInTheDocument();
    // The passes are listed (all-green auto-expands — it is the point of the view).
    expect(screen.getByText('green one')).toBeInTheDocument();
    expect(screen.getByText('green three')).toBeInTheDocument();
  });
});

// The tab strip renders each open scenario as a `<div>` with the scenario id as its
// (italic-when-preview / bold-when-pinned) label plus a `Close <id>` button.
const closeBtn = (id: string) => screen.getByLabelText(`Close ${id}`);
const tabEl = (id: string) => closeBtn(id).parentElement as HTMLElement;
const tabLabel = (id: string) => within(tabEl(id)).getByText(id);
const gdrift = () => new URLSearchParams(screen.getByTestId('qs').textContent ?? '').get('gdrift');
// The permanent Overview tab renders first with no close button (the way back).
const overviewTab = () => screen.getByText('Overview');

describe('GuardDriftsView — bug 1: evidence state resets across selections', () => {
  /** Per-scenario evidence bodies so a stale transcript is detectable by content. */
  function stubPerScenarioEvidence() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/latest')) return json(LATEST);
        if (u.includes('/guard/history')) return json(HISTORY);
        if (u.includes('/guard/evidence')) {
          const sid = new URL(u, 'http://x').searchParams.get('scenarioId');
          return new Response(`EVIDENCE-FOR-${sid}`, { status: 200 });
        }
        if (u.includes('/guard/scenario')) return json({ id: 's', file: 's.yaml', content: 'guard: 1' });
        if (u.includes('/guard/runs/')) return json(LATEST);
        return json({});
      }),
    );
  }

  it('renders each scenario’s OWN evidence on selection and never bleeds a stale transcript across selections', async () => {
    const user = userEvent.setup();
    stubPerScenarioEvidence();
    renderView();

    // Open the failed scenario — its evidence loads on mount, shown expanded.
    await user.click(await screen.findByText('login rate limits'));
    expect(await screen.findByText('EVIDENCE-FOR-s-fail')).toBeInTheDocument();

    // Single-click the passing scenario (preview replaces the tab): a pass has NO
    // evidence section and the failed transcript must be gone (fresh keyed instance).
    await user.click(screen.getByText('passing claim'));
    expect(await screen.findByText('Last result')).toBeInTheDocument();
    expect(screen.queryByLabelText('evidence transcript')).not.toBeInTheDocument();
    expect(screen.queryByText('EVIDENCE-FOR-s-fail')).not.toBeInTheDocument();

    // Select ANOTHER failing scenario: only its OWN transcript loads on mount, and
    // the stale s-fail transcript never bleeds through (the mounted-ref race guard).
    await user.click(screen.getByText('infra broke'));
    expect(await screen.findByText('EVIDENCE-FOR-s-error')).toBeInTheDocument();
    expect(screen.queryByText('EVIDENCE-FOR-s-fail')).not.toBeInTheDocument();
  });
});

describe('GuardDriftsView — bug 2: preview / pin tab model', () => {
  beforeEach(() => stubFetch());

  it('single-click previews (italic tab + ?gdrift); the next single-click replaces it', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByText('login rate limits'));
    expect(tabLabel('s-fail')).toHaveClass('italic');
    expect(gdrift()).toBe('s-fail');
    expect(await screen.findByText('exit code 1')).toBeInTheDocument();

    // A second single-click takes the transient slot — one tab only.
    await user.click(screen.getByText('infra broke'));
    expect(screen.queryByLabelText('Close s-fail')).not.toBeInTheDocument();
    expect(tabLabel('s-error')).toHaveClass('italic');
    expect(gdrift()).toBe('s-error');
  });

  it('double-click pins the tab so the next preview coexists with it', async () => {
    const user = userEvent.setup();
    renderView();
    await user.dblClick(await screen.findByText('login rate limits'));
    expect(tabLabel('s-fail')).toHaveClass('font-medium');
    await user.click(screen.getByText('infra broke'));
    // Both tabs open: pinned s-fail + transient s-error, the latter active.
    expect(tabLabel('s-fail')).toHaveClass('font-medium');
    expect(tabLabel('s-error')).toHaveClass('italic');
    expect(gdrift()).toBe('s-error');
  });

  it('closing the last tab returns to the run overview and clears ?gdrift', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByText('login rate limits'));
    await user.click(closeBtn('s-fail'));
    expect(screen.queryByLabelText('Close s-fail')).not.toBeInTheDocument();
    expect(await screen.findByText('Provenance')).toBeInTheDocument();
    expect(gdrift()).toBeNull();
  });

  it('a ?gdrift deep link opens the scenario as a pinned tab', async () => {
    renderView('/repos/r?section=guard&tab=guarddrifts&gdrift=s-fail');
    expect(await screen.findByText('exit code 1')).toBeInTheDocument();
    expect(tabLabel('s-fail')).toHaveClass('font-medium');
  });
});

describe('GuardDriftsView — permanent Overview tab', () => {
  beforeEach(() => stubFetch());

  it('renders an Overview tab FIRST — non-italic and never closable', async () => {
    const user = userEvent.setup();
    renderView();
    await screen.findByText('login rate limits');
    // No item tabs → no strip and no Overview chip; the run overview is the pane.
    expect(screen.queryByText('Overview')).toBeNull();
    // Open a drift: the strip appears with Overview FIRST — non-italic, never a
    // close affordance — sitting before the item tab.
    await user.click(screen.getByText('login rate limits'));
    expect(overviewTab()).toBeInTheDocument();
    expect(overviewTab()).not.toHaveClass('italic');
    expect(overviewTab()).toHaveClass('font-medium');
    expect(screen.queryByLabelText('Close Overview')).toBeNull();
    expect(tabLabel('s-fail')).toBeInTheDocument();
    expect(
      overviewTab().compareDocumentPosition(closeBtn('s-fail')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('is active with no ?gdrift; clicking it clears the selection WITHOUT closing the tab', async () => {
    const user = userEvent.setup();
    renderView();
    await screen.findByText('login rate limits');
    // No item tabs yet → no strip; the run overview is the whole pane.
    expect(screen.queryByText('Overview')).toBeNull();
    expect(screen.getByText('Provenance')).toBeInTheDocument();

    // Pin a drift, then click Overview: the selection clears, the overview returns,
    // and the pinned tab stays open.
    await user.dblClick(screen.getByText('login rate limits'));
    expect(gdrift()).toBe('s-fail');
    expect(screen.queryByText('Provenance')).not.toBeInTheDocument();
    await user.click(overviewTab());
    expect(gdrift()).toBeNull();
    expect(await screen.findByText('Provenance')).toBeInTheDocument();
    expect(closeBtn('s-fail')).toBeInTheDocument();
    expect(overviewTab().parentElement).toHaveClass('bg-background');
  });

  it('activates the Overview when the last item tab closes', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByText('login rate limits'));
    expect(gdrift()).toBe('s-fail');
    expect(overviewTab()).toBeInTheDocument();
    await user.click(closeBtn('s-fail'));
    expect(gdrift()).toBeNull();
    // Last item tab closed → run overview returns AND the strip/chip is gone.
    expect(await screen.findByText('Provenance')).toBeInTheDocument();
    expect(screen.queryByText('Overview')).toBeNull();
  });
});

describe('GuardDriftsView — run overview (default main pane)', () => {
  beforeEach(() => stubFetch());

  it('shows the run overview — envelope, tallies, duration — when no tab is open, not a bare placeholder', async () => {
    renderView();
    await screen.findByText('login rate limits');
    expect(screen.getByText('Provenance')).toBeInTheDocument();
    expect(screen.getByText('Outcomes')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    // Duration stats: total scenario time + the slowest one-liner (s-fail, 12ms).
    expect(screen.getByText(/5 scenarios .* 19ms total/)).toBeInTheDocument();
    expect(screen.getByText(/Slowest: login rate limits · 12ms/)).toBeInTheDocument();
    // The old bare placeholder string is gone.
    expect(screen.queryByText('Select a scenario from the list to inspect it.')).not.toBeInTheDocument();
  });

  it('returns to the overview when the last tab closes', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(await screen.findByText('login rate limits'));
    // Overview hidden while a tab is open…
    expect(screen.queryByText('Provenance')).not.toBeInTheDocument();
    await user.click(closeBtn('s-fail'));
    // …and back once it closes.
    expect(await screen.findByText('Provenance')).toBeInTheDocument();
  });
});

describe('GuardDriftsView — run-switch tab re-resolution', () => {
  // An older run where s-fail PASSED and a scenario `p` exists that the latest run
  // does not have — the two ends of re-resolution (present-but-different, absent).
  const RUN0: GuardLatest = {
    ...LATEST,
    run: {
      ...LATEST.run,
      runId: '2026-07-06T00-00-00Z_run0',
      ranAt: '2026-07-06T00:00:00.000Z',
      recipeFingerprint: 'sha256:0000run0abcd',
    },
    summary: { total: 2, pass: 2, fail: 0, stale: 0, orphaned: 0, error: 0 },
    scenarios: [
      { id: 's-fail', title: 'login rate limits', binds: binds('authentication/login/rate-limiting'), outcome: 'pass', durationMs: 8 },
      { id: 'p', title: 'green p', binds: binds('a/1'), outcome: 'pass', durationMs: 7 },
    ],
  };

  function stubTwoRuns() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/latest')) return json(LATEST);
        if (u.includes('/guard/history')) return json(HISTORY);
        if (u.includes('/guard/runs/')) return json(RUN0);
        if (u.includes('/guard/evidence')) return new Response('E', { status: 200 });
        if (u.includes('/guard/scenario')) return json({ id: 's', file: 's.yaml', content: 'guard: 1' });
        return json({});
      }),
    );
  }

  it('re-resolves a pinned tab to the newly selected run’s result for that scenario', async () => {
    const user = userEvent.setup();
    stubTwoRuns();
    renderView();
    // Pin s-fail — it FAILED in the latest run (expected/actual shown).
    await user.dblClick(await screen.findByText('login rate limits'));
    expect(await screen.findByText('exit code 1')).toBeInTheDocument();

    // Load the older run: same tab, but s-fail PASSED there → last-result, no failure.
    await user.click(screen.getByText(/2026-07-06T00-00-00Z/));
    expect(await screen.findByText('Last result')).toBeInTheDocument();
    expect(screen.queryByText('exit code 1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Close s-fail')).toBeInTheDocument();
  });

  it('keeps the tab but shows "not in this run" when the scenario is absent from the selected run', async () => {
    const user = userEvent.setup();
    stubTwoRuns();
    renderView();
    // Switch to the older run and pin its scenario `p`.
    await user.click(await screen.findByText(/2026-07-06T00-00-00Z/));
    await user.dblClick(await screen.findByText('green p'));
    expect(screen.getByLabelText('Close p')).toBeInTheDocument();

    // Back to the latest run — `p` was not part of it.
    await user.click(screen.getByText(/2026-07-07T00-00-00Z/));
    expect(await screen.findByText('Not in this run')).toBeInTheDocument();
    // The tab persists (re-resolution keeps the set; only the detail re-resolves).
    expect(screen.getByLabelText('Close p')).toBeInTheDocument();
  });
});
