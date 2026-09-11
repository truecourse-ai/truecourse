/**
 * Code: the repositories of the workspace, and what the server stored about
 * each one. The table moved off Home when Home became the product owner's
 * dashboard, so the reads it makes and the words its cells wear are asserted
 * here; Home's own test is the smoke file's, since Home now holds nothing.
 */

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toPreviewRepo } from '@/preview/data/real-repos';
import { REPOS } from '@/preview/data/repos';
import { statusSummary } from '@/preview/data/corpus-fixtures';
import type { GuardStatusSummary } from '@/preview/vendor/shared';
import CodePage from '@/preview/pages/CodePage';

const state = vi.hoisted(() => ({ repos: [] as ReturnType<typeof toPreviewRepo>[] }));
const listeners = vi.hoisted(() => new Map<string, Set<(payload: unknown) => void>>());
vi.mock('@/preview/shell/preview-state', () => ({
  usePreviewState: () => ({ workspace: { name: 'Test workspace' }, repos: state.repos }),
}));
vi.mock('@/preview/pages/ConnectDialog', () => ({ ConnectDialog: () => null }));
vi.mock('@/lib/socket', () => ({
  connectSocket: () => ({
    on(event: string, handler: (payload: unknown) => void) {
      const handlers = listeners.get(event) ?? new Set();
      handlers.add(handler);
      listeners.set(event, handlers);
    },
    off(event: string, handler: (payload: unknown) => void) { listeners.get(event)?.delete(handler); },
  }),
}));

const repo = toPreviewRepo({ id: 'expense-tracker', name: 'expenses', path: '/expenses', remoteUrl: 'https://github.com/spiderhands/expense-tracker' });
const corpus = { corpus: { version: 3, generatedAt: new Date().toISOString(), docs: [], areas: [] }, corpusCommit: '58899f746bc470cfafb802d1cb27b35893631ad6' };
const empty: GuardStatusSummary = { sections: null, coverage: null, lastRun: null, lastGenerate: null };
const counts = { failed: 1, blocked: 1, 'never-run': 1, succeeded: 3, 'not-testable': 0 };
function summary(): GuardStatusSummary {
  return {
    ...empty,
    sections: { total: 6, byStatus: counts },
    coverage: {
      totalSections: 4, withScenarios: 4, byStatus: { ...counts, succeeded: 2, 'never-run': 0 },
      classification: { api: 2, web: 2, cli: 0, unclassified: 0, untestable: 0 },
      flows: { total: 2, guarded: 1, partial: 1, blocked: 0, gapLabels: [], byStatus: { ...counts, succeeded: 1, blocked: 0, 'never-run': 0 } },
    },
    lastRun: { ranAt: new Date().toISOString(), commit: '58899f7', branch: 'main', summary: { total: 2, pass: 1, fail: 1, error: 0, blocked: 0, stale: 0, orphaned: 0 } },
  };
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function serve(initial = summary()) {
  const server = { summary: initial, corpus: corpus as typeof corpus | null, statusCode: 200, corpusCode: 200 };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/guard/status')) return json(server.summary, server.statusCode);
    if (path.endsWith('/spec/corpus')) return json(server.corpus, server.corpus ? server.corpusCode : 404);
    return json({ error: 'Unexpected endpoint' }, 404);
  }));
  return server;
}
function renderCode() {
  return render(<MemoryRouter initialEntries={['/preview/code']}><Routes>
    <Route path="/preview/code" element={<CodePage />} />
    <Route path="/preview/repos/:id" element={<p>Console destination</p>} />
    <Route path="/preview/repos/:id/runs" element={<p>Runs destination</p>} />
  </Routes></MemoryRouter>);
}
function row() { return within(screen.getByText(repo.fullName).closest('tr')!); }
function complete(id = repo.id) {
  act(() => { for (const handler of listeners.get('spec:complete') ?? []) handler({ repoId: id, kind: 'guard-run' }); });
}
beforeEach(() => { state.repos = [repo]; listeners.clear(); });
afterEach(() => vi.unstubAllGlobals());

describe('Code, the repositories and their stored summaries', () => {
  it('loads each repository’s proven percentage, verdict and baseline from the server, and no workspace bars', async () => {
    serve();
    renderCode();
    expect(await screen.findByText('50%')).toBeInTheDocument();
    expect(screen.queryByText(/sections · /)).toBeNull();
    expect(screen.queryByRole('img', { name: /^Flows:/ })).toBeNull();
    expect(row().getByText('Failing')).toBeInTheDocument();
    expect(row().getByText('58899f7')).toHaveAttribute('title', corpus.corpusCommit);
    expect(row().queryByText('no corpus yet')).toBeNull();
    await userEvent.click(row().getByRole('link'));
    expect(screen.getByText('Runs destination')).toBeInTheDocument();
  });

  it('refreshes only the changed repository after a scan or run completes', async () => {
    const server = serve();
    const { unmount } = renderCode();
    await screen.findByText('50%');
    const calls = vi.mocked(fetch).mock.calls.length;
    complete('unrelated-repo');
    expect(vi.mocked(fetch).mock.calls.length).toBe(calls);
    server.summary = { ...summary(), sections: { total: 6, byStatus: { ...counts, failed: 0, succeeded: 4 } }, lastRun: { ...summary().lastRun!, summary: { total: 2, pass: 2, fail: 0, error: 0, blocked: 0, stale: 0, orphaned: 0 } } };
    complete();
    expect(await row().findByText('67%')).toBeInTheDocument();
    expect(row().getByText('Passing')).toBeInTheDocument();
    unmount();
    expect(listeners.get('spec:complete')?.size).toBe(0);
    expect(listeners.get('connect')?.size).toBe(0);
  });

  it('keeps an empty repository distinct from loading and renders the missing baseline once', async () => {
    const server = serve(empty);
    server.corpus = null;
    renderCode();
    expect(screen.getByText('Loading repository summaries…')).toBeInTheDocument();
    expect(row().queryByText('no corpus yet')).toBeNull();
    expect(await screen.findByText('no corpus yet')).toBeInTheDocument();
    expect(row().getAllByText('no baseline yet')).toHaveLength(1);
    expect(row().getByText('—')).toBeInTheDocument();
    expect(row().getByRole('link')).toHaveAttribute('href', `/preview/agent?repo=${repo.id}`);
  });

  it('reports failed reads instead of claiming there is no corpus, and recovers on reconnect', async () => {
    const server = serve();
    server.statusCode = 500;
    server.corpusCode = 500;
    renderCode();
    expect(await screen.findByText('Coverage unavailable')).toBeInTheDocument();
    expect(row().getByText('Baseline unavailable')).toBeInTheDocument();
    expect(screen.getByText("Some repositories' coverage could not be loaded.")).toBeInTheDocument();
    server.statusCode = 200;
    server.corpusCode = 200;
    act(() => { for (const handler of listeners.get('connect') ?? []) handler(undefined); });
    expect(await screen.findByText('50%')).toBeInTheDocument();
  });

  it('does not call a blocked or empty test run passing', async () => {
    const server = serve({ ...summary(), lastRun: { ...summary().lastRun!, summary: { total: 2, pass: 1, blocked: 1, fail: 0, error: 0, stale: 0, orphaned: 0 } } });
    renderCode();
    await screen.findByText('50%');
    expect(row().getByText('Neutral')).toBeInTheDocument();
    server.summary.lastRun!.summary = { total: 0, pass: 0, blocked: 0, fail: 0, error: 0, stale: 0, orphaned: 0 };
    complete();
    await waitFor(() => expect(row().getByRole('link')).toHaveAttribute('title', '0 passed, 0 failed, 0 errors, 0 blocked, 0 stale, 0 orphaned'));
    expect(row().getByText('Neutral')).toBeInTheDocument();
  });

  it('lists a fixture repository from its fixtures without fetching it', async () => {
    serve();
    state.repos = [repo, REPOS[0]!];
    renderCode();
    await screen.findByText('50%');
    expect(screen.getByText(REPOS[0]!.fullName)).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.every(([input]) => String(input).includes(`/repos/${repo.id}/`))).toBe(true);
  });

  it('retains coverage when the baseline read fails and uses manifest totals before whole-corpus totals exist', async () => {
    const server = serve({ ...summary(), sections: null });
    server.corpusCode = 500;
    renderCode();
    expect(await row().findByText('50%')).toBeInTheDocument();
    expect(row().getByText('Baseline unavailable')).toBeInTheDocument();
    expect(row().getByText('Failing')).toBeInTheDocument();
  });

  it('ignores an older response that finishes after a completion-triggered refresh', async () => {
    serve();
    let resolveOld!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }));
    renderCode();
    complete();
    await screen.findByText('50%');
    await act(async () => { resolveOld(json(empty)); });
    expect(row().getByText('50%')).toBeInTheDocument();
    expect(row().getByText('Failing')).toBeInTheDocument();
  });

  it('opens the repository console from the row keyboard action', async () => {
    serve();
    renderCode();
    await screen.findByText('50%');
    screen.getByText(repo.fullName).closest('tr')!.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByText('Console destination')).toBeInTheDocument();
  });

  it('is headed Code, and connecting a repository is its one action', async () => {
    serve();
    renderCode();
    expect(await screen.findByRole('heading', { name: 'Code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect repository' })).toBeInTheDocument();
  });
});
