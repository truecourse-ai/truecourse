/**
 * PR guard-scope resolution: a `?pr=N` guard view must never read (or render)
 * repo-BASELINE guard data while the PR's head SHA is unknown — either because
 * the gate-runs fetch is still in flight (→ loading state) or because the PR has
 * no recorded gate run at all (→ explicit "gate hasn't run" state). Covers the
 * pieces RepoPage composes: `useRepoGateRuns` (now exposing a settled flag), the
 * pure `resolvePrGuardScope`, the `GuardPrScopeGate` pane gate, and
 * `useGuardRuns`' selection/cache reset when the ref changes. Fetches are
 * stubbed the house way (`vi.stubGlobal('fetch', …)` routed by URL).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { GuardLatest } from '@truecourse/shared';
import { useRepoGateRuns } from '@/ee/useRepoGateRuns';
import { resolvePrGuardScope, guardReadsEnabled, type PrGuardScope } from '@/ee/pr-guard-scope';
import * as api from '@/lib/api';
import { GuardPrScopeGate } from '@/ee/GuardPrScopeGate';
import { useGuardStaleness } from '@/hooks/useGuardStaleness';
import { useGuardReport } from '@/hooks/useGuardReport';
import { useGuardScenarios } from '@/hooks/useGuardScenarios';
import { GuardDriftsView } from '@/components/guard/GuardDriftsView';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const GATE_RUNS = {
  runs: [
    {
      id: 'run1',
      prNumber: 7,
      headSha: 'prhead1234567',
      conclusion: 'passed',
      createdAt: '2026-07-10T00:00:00.000Z',
    },
  ],
};

/** Renders the hook's settled flag + run count so both are assertable. */
function GateRunsProbe({ repo }: { repo?: string }) {
  const { runs, loaded } = useRepoGateRuns(repo);
  return (
    <div data-testid="gate">
      {loaded ? 'settled' : 'loading'} · {runs.length}
    </div>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('useRepoGateRuns — settled flag', () => {
  it('reports loading until the runs fetch resolves, then settled with the runs', async () => {
    let release!: (r: Response) => void;
    const pending = new Promise<Response>((r) => {
      release = r;
    });
    vi.stubGlobal('fetch', vi.fn(() => pending));

    render(<GateRunsProbe repo="acme/repo" />);
    // Fetch in flight — the scope is NOT settled (no way to know the head SHA yet).
    expect(screen.getByTestId('gate')).toHaveTextContent('loading · 0');

    release(json(GATE_RUNS));
    expect(await screen.findByText(/settled · 1/)).toBeInTheDocument();
  });

  it('settles (with no runs) when the fetch fails — the PR view shows its explicit empty state, not a forever-spinner', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network down'))));
    render(<GateRunsProbe repo="acme/repo" />);
    expect(await screen.findByText(/settled · 0/)).toBeInTheDocument();
  });

  it('never settles without a repo name (nothing was fetched, so nothing is known)', () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<GateRunsProbe />);
    expect(screen.getByTestId('gate')).toHaveTextContent('loading · 0');
  });
});

describe('resolvePrGuardScope', () => {
  it('is the repo scope (baseline reads correct) when no PR is in view', () => {
    expect(resolvePrGuardScope({ prNumber: null, headSha: undefined, gateRunsLoaded: false })).toEqual({
      state: 'repo',
      ref: undefined,
    });
  });

  it('holds guard reads (loading) while the PR head SHA is unknown and the runs fetch has not settled', () => {
    expect(resolvePrGuardScope({ prNumber: 7, headSha: undefined, gateRunsLoaded: false })).toEqual({
      state: 'loading',
      ref: undefined,
    });
  });

  it('is the explicit no-run scope when the runs fetch settled without a gate run for the PR', () => {
    expect(resolvePrGuardScope({ prNumber: 7, headSha: undefined, gateRunsLoaded: true })).toEqual({
      state: 'no-run',
      ref: undefined,
    });
  });

  it('resolves to the PR head SHA once known', () => {
    expect(resolvePrGuardScope({ prNumber: 7, headSha: 'prhead1234567', gateRunsLoaded: true })).toEqual({
      state: 'resolved',
      ref: 'prhead1234567',
    });
  });
});

describe('GuardPrScopeGate', () => {
  it('shows a loading state — and never mounts the children — while the PR scope is loading', () => {
    render(
      <GuardPrScopeGate scope={{ state: 'loading', ref: undefined }}>
        <div>BASELINE-GUARD-CONTENT</div>
      </GuardPrScopeGate>,
    );
    expect(screen.getByRole('status', { name: 'Resolving pull request scope' })).toBeInTheDocument();
    expect(screen.queryByText('BASELINE-GUARD-CONTENT')).toBeNull();
  });

  it('shows the explicit "gate hasn\'t run" card — never the children — when the PR has no gate run', () => {
    render(
      <GuardPrScopeGate scope={{ state: 'no-run', ref: undefined }}>
        <div>BASELINE-GUARD-CONTENT</div>
      </GuardPrScopeGate>,
    );
    expect(screen.getByText("Guard gate hasn't run for this pull request yet")).toBeInTheDocument();
    expect(screen.queryByText('BASELINE-GUARD-CONTENT')).toBeNull();
  });

  it('renders the children in the repo scope and once the PR head is resolved', () => {
    const { unmount } = render(
      <GuardPrScopeGate scope={{ state: 'repo', ref: undefined }}>
        <div>REPO-GUARD-CONTENT</div>
      </GuardPrScopeGate>,
    );
    expect(screen.getByText('REPO-GUARD-CONTENT')).toBeInTheDocument();
    unmount();
    render(
      <GuardPrScopeGate scope={{ state: 'resolved', ref: 'prhead1234567' }}>
        <div>PR-GUARD-CONTENT</div>
      </GuardPrScopeGate>,
    );
    expect(screen.getByText('PR-GUARD-CONTENT')).toBeInTheDocument();
  });
});

describe('useGuardStaleness — enabled gate', () => {
  function StalenessProbe({ enabled }: { enabled: boolean }) {
    const { staleness } = useGuardStaleness('r', undefined, enabled);
    return <div>{staleness.generateStale ? 'stale' : 'fresh'}</div>;
  }

  it('issues no staleness fetch while disabled (an unresolved PR scope must not read baseline staleness)', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<StalenessProbe enabled={false} />);
    // Give any (wrong) fetch a beat to fire.
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();

    // Enabling fetches — the gate holds reads, it doesn't kill the signal.
    rerender(<StalenessProbe enabled />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});

describe('useGuardRuns — ref switch resets the run selection and cache', () => {
  const binds = (section: string) => ({ doc: 'docs/auth.md', section, fingerprint: 'sha256:abc123' });
  const runShell = (runId: string, commit: string) => ({
    runId,
    ranAt: '2026-07-07T00:00:00.000Z',
    branch: 'main',
    commit,
    recipeFingerprint: 'sha256:9f2caabbccdd',
    scenarioFormat: 3,
  });
  const summary = { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 };
  const BASELINE_LATEST: GuardLatest = {
    run: runShell('run1-baseline', 'base1111'),
    summary,
    scenarios: [{ id: 'b1', title: 'baseline latest claim', binds: binds('a/1'), outcome: 'pass', durationMs: 1 }],
    sections: [],
  };
  const BASELINE_OLDER: GuardLatest = {
    run: runShell('run0-baseline', 'base0000'),
    summary,
    scenarios: [{ id: 'b0', title: 'baseline older claim', binds: binds('a/0'), outcome: 'pass', durationMs: 1 }],
    sections: [],
  };
  const HEAD_RUN: GuardLatest = {
    run: runShell('run-pr-head', 'head2222'),
    summary,
    scenarios: [{ id: 'h1', title: 'pr head claim', binds: binds('a/9'), outcome: 'pass', durationMs: 1 }],
    sections: [],
  };
  const REPO_HISTORY = {
    runs: [
      { runId: 'run1-baseline', ranAt: '2026-07-07T00:00:00.000Z', branch: 'main', commit: 'base1111', summary },
      { runId: 'run0-baseline', ranAt: '2026-07-06T00:00:00.000Z', branch: 'main', commit: 'base0000', summary },
    ],
  };
  const PR_HISTORY = {
    runs: [{ runId: 'run-pr-head', ranAt: '2026-07-08T00:00:00.000Z', branch: 'feat/x', commit: 'head2222', summary }],
  };

  function stubScopedFetch() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = new URL(String(url), 'http://x');
        if (u.pathname.includes('/guard/latest')) {
          return u.searchParams.get('ref') ? json({ latest: HEAD_RUN, pending: null }) : json(BASELINE_LATEST);
        }
        if (u.pathname.includes('/guard/history')) {
          return u.searchParams.get('pr') ? json(PR_HISTORY) : json(REPO_HISTORY);
        }
        if (u.pathname.includes('/guard/runs/')) return json(BASELINE_OLDER);
        return json({});
      }),
    );
  }

  it('drops a baseline run selected before the head SHA arrived — the head run renders, not the cached snapshot', async () => {
    const user = userEvent.setup();
    stubScopedFetch();
    const view = (prRef?: string, prNumber?: number) => (
      <MemoryRouter initialEntries={['/repos/r?section=guard&tab=guarddrifts']}>
        <GuardDriftsView repoId="r" prRef={prRef} prNumber={prNumber} />
      </MemoryRouter>
    );
    const { rerender } = render(view());
    await screen.findByText('baseline latest claim');

    // Select the OLDER baseline run — it loads into the per-run cache.
    await user.click(screen.getByText(/run0-baseline/));
    expect(await screen.findByText('baseline older claim')).toBeInTheDocument();

    // The PR head SHA arrives (the transient `?pr=` window closes): the view is
    // re-keyed to the head — the cached baseline selection must NOT keep rendering.
    rerender(view('head2222', 7));
    expect(await screen.findByText('pr head claim')).toBeInTheDocument();
    expect(screen.queryByText('baseline older claim')).toBeNull();
    expect(screen.queryByText('baseline latest claim')).toBeNull();
  });
});

describe('guard dismiss/undismiss — inert while the PR scope is unresolved', () => {
  const claim = { doc: 'docs/auth.md', section: 'a/1', claimText: 'auth claim' };

  /** Mirrors RepoPage's onDismiss/onUndismiss wiring: the shared predicate
   *  gates the API write, so a decision can never land against findings the
   *  user could only have seen on the baseline. */
  function DismissProbe({ scope }: { scope: PrGuardScope }) {
    const dismiss = async () => {
      if (!guardReadsEnabled(scope)) return;
      await api.dismissGuardClaim('r', claim, 7);
    };
    return <button onClick={dismiss}>Dismiss</button>;
  }

  it.each([
    ['loading', { state: 'loading', ref: undefined } as const],
    ['no-run', { state: 'no-run', ref: undefined } as const],
  ])('writes no dismissal in the %s scope', async (_label, scope) => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    render(<DismissProbe scope={scope} />);

    await user.click(screen.getByText('Dismiss'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a resolved scope writes the dismissal to the PR overlay', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    render(<DismissProbe scope={{ state: 'resolved', ref: 'prhead1234567' }} />);

    await user.click(screen.getByText('Dismiss'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/guard/dismiss?pr=7');
  });
});

describe('PR guard view — the RepoPage wiring never reads baseline data under a PR header', () => {
  const summary = { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0 };
  const BASELINE_LATEST: GuardLatest = {
    run: {
      runId: 'run1-baseline',
      ranAt: '2026-07-07T00:00:00.000Z',
      branch: 'main',
      commit: 'base1111',
      recipeFingerprint: 'sha256:9f2caabbccdd',
      scenarioFormat: 3,
    },
    summary,
    scenarios: [
      {
        id: 'b1',
        title: 'baseline latest claim',
        binds: { doc: 'docs/auth.md', section: 'a/1', fingerprint: 'sha256:abc123' },
        outcome: 'pass',
        durationMs: 1,
      },
    ],
    sections: [],
  };

  /** Mirrors RepoPage's PR-guard wiring: gate runs → scope → page-level guard
   *  hooks gated on it → the drifts pane behind GuardPrScopeGate. */
  function PrGuardHarness({ pr }: { pr: number | null }) {
    const { runs, loaded } = useRepoGateRuns('acme/repo');
    const activePrRun = pr != null ? runs.find((r) => r.prNumber === pr) ?? null : null;
    const scope = resolvePrGuardScope({ prNumber: pr, headSha: activePrRun?.headSha, gateRunsLoaded: loaded });
    const enabled = guardReadsEnabled(scope);
    useGuardStaleness('r', scope.ref, enabled);
    useGuardReport('r', enabled, 0, scope.ref);
    useGuardScenarios('r', enabled, 0, scope.ref);
    return (
      <MemoryRouter initialEntries={['/repos/r?section=guard&tab=guarddrifts&pr=7']}>
        <GuardPrScopeGate scope={scope}>
          <GuardDriftsView repoId="r" prRef={scope.ref} prNumber={pr ?? undefined} />
        </GuardPrScopeGate>
      </MemoryRouter>
    );
  }

  function stubRoutedFetch(gateRuns: Promise<Response> | Response) {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        calls.push(u);
        if (u.includes('/github/repos/')) return gateRuns;
        if (u.includes('/guard/latest')) {
          return new URL(u, 'http://x').searchParams.get('ref')
            ? json({ latest: null, pending: null })
            : json(BASELINE_LATEST);
        }
        return json({});
      }),
    );
    return calls;
  }
  const guardCalls = (calls: string[]) => calls.filter((u) => u.includes('/guard/'));

  it('holds ALL guard fetches (and shows the loading state) while the gate-runs fetch is in flight', async () => {
    let release!: (r: Response) => void;
    const pending = new Promise<Response>((r) => {
      release = r;
    });
    const calls = stubRoutedFetch(pending);
    render(<PrGuardHarness pr={7} />);

    expect(screen.getByRole('status', { name: 'Resolving pull request scope' })).toBeInTheDocument();
    expect(screen.queryByText('baseline latest claim')).toBeNull();
    // NOT ONE ref-less guard fetch during the transient window.
    expect(guardCalls(calls)).toEqual([]);

    // Once the head resolves, every guard read is PR-scoped — keyed to the head
    // SHA (`ref=`) or the PR timeline (`pr=`) — never an unscoped baseline read.
    release(json(GATE_RUNS));
    await vi.waitFor(() => expect(guardCalls(calls).length).toBeGreaterThan(0));
    for (const u of guardCalls(calls)) {
      const params = new URL(u, 'http://x').searchParams;
      expect(params.get('ref') ?? `pr:${params.get('pr')}`).toMatch(/^(prhead1234567|pr:7)$/);
    }
  });

  it('shows the explicit "gate hasn\'t run" state — with zero guard fetches — when the PR has no recorded gate run', async () => {
    const calls = stubRoutedFetch(json({ runs: [] }));
    render(<PrGuardHarness pr={7} />);

    expect(
      await screen.findByText("Guard gate hasn't run for this pull request yet"),
    ).toBeInTheDocument();
    expect(screen.queryByText('baseline latest claim')).toBeNull();
    expect(guardCalls(calls)).toEqual([]);
  });
});
