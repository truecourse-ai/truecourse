/**
 * Context › Documents and Conflicts: the rows an open pull request's check
 * adds. A document the check moved a section of is listed again under the
 * pull request's number; a conflict the head would create is a row of its
 * own, with no page to open. Both narrow by `?pr=<owner/repo>#<n>`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ContextDocumentRow, WorkspacePullRequestRow } from '@truecourse/shared';

vi.mock('@/lib/socket', () => {
  const socket = { connected: false, on: () => socket, off: () => socket, emit: vi.fn(), connect: vi.fn() };
  return {
    connectSocket: () => socket,
    getSocket: () => socket,
    disconnectSocket: vi.fn(),
    joinRepoRoom: vi.fn(),
    leaveRepoRoom: vi.fn(),
  };
});

import DashboardApp from '@/dashboard/DashboardApp';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

const REPO = { id: 'web', name: 'acme/web', path: 'acme/web', provider: 'github' };
const REFUNDS_REF = 'context/repo-acme-web/docs/refunds.md';
const PAYOUTS_REF = 'context/repo-acme-web/docs/payouts.md';

const doc = (ref: string, title: string): ContextDocumentRow => ({
  ref,
  title,
  area: 'acme/payments',
  sourceId: 'repo-acme-web',
  sourceTitle: 'acme/web',
  sourceKind: 'repository',
  repositories: [REPO.name],
  readings: [{ repoFullName: REPO.name, status: 'covered' }] as ContextDocumentRow['readings'],
  status: 'covered',
  inCorpus: true,
  decision: null,
  inclusion: 'in-corpus',
  skipReason: null,
  updatedAt: '2026-08-20T10:00:00.000Z',
});

const DOCUMENTS = [doc(REFUNDS_REF, 'Refunds'), doc(PAYOUTS_REF, 'Payouts')];

/** #7 moved a section of Refunds and would put Refunds in conflict with Payouts. */
const PULL: WorkspacePullRequestRow = {
  repoFullName: REPO.name,
  number: 7,
  workspaceOrgId: 'org_1',
  provider: 'github',
  title: 'Shorten the refund window',
  authorLogin: 'octocat',
  headSha: 'f00d123',
  headRef: 'refund-window',
  baseRef: 'main',
  headRepoFullName: REPO.name,
  draft: false,
  state: 'open',
  openedAt: '2026-09-01T00:00:00.000Z',
  closedAt: null,
  updatedAt: '2026-09-02T00:00:00.000Z',
  check: {
    id: 'check_1',
    conclusion: 'failure',
    reason: 'conflict',
    settledAt: '2026-09-02T01:00:00.000Z',
    sectionsMoved: [{ doc: REFUNDS_REF, anchor: 'window', flows: [] }],
    conflictsCreated: [
      {
        docs: [REFUNDS_REF, PAYOUTS_REF],
        sections: [['window'], ['timing']],
        note: 'the refund window is two days in one and five in the other',
        path: 'docs/refunds.md',
        line: 3,
        blocksRepositories: [REPO.name],
      },
    ],
  },
};

/** The workspace's own corpus, with one open conflict of its own between the two documents. */
const CORPUS = {
  corpus: {
    version: 3,
    generatedAt: '2026-09-02T00:00:00.000Z',
    docs: [
      { ref: REFUNDS_REF, kind: 'prd', lastTouched: '', areaTags: ['acme/payments'] },
      { ref: PAYOUTS_REF, kind: 'prd', lastTouched: '', areaTags: ['acme/payments'] },
    ],
    areas: [
      {
        id: 'acme/payments',
        product: 'acme',
        concern: 'payments',
        docRefs: [REFUNDS_REF, PAYOUTS_REF],
        overlaps: [{ docs: [REFUNDS_REF, PAYOUTS_REF], note: 'who owns the refund window', sections: [] }],
      },
    ],
    relations: [],
    skippedDocs: [],
  },
  manualIncludes: [],
  manualExcludes: [],
  conflictResolutions: [],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function serve() {
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    if (url.pathname === '/api/repos') return json([REPO]);
    if (url.pathname === '/api/llm/config') return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    if (url.pathname === '/api/sessions/runs') return json({ runs: [] });
    if (url.pathname === '/api/context/documents') return json({ documents: DOCUMENTS, corpusAt: null });
    if (url.pathname === '/api/context/sources') return json({ sources: [], changedAt: null });
    if (url.pathname === '/api/context/staleness') return json({ changedAt: null, corpusAt: null, stale: false });
    if (url.pathname === '/api/context/corpus') return json(CORPUS);
    if (url.pathname === '/api/context/pull-requests') return json({ pullRequests: [PULL] });
    return json({ error: `not found: ${url.pathname}` }, 404);
  }) as unknown as typeof window.fetch;
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/*" element={<DashboardApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

function rows(name: string) {
  const table = screen.getByRole('table', { name });
  return within(table).getAllByRole('row').slice(1);
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('Context › Documents, the pull request rows', () => {
  it('lists the document the check moved once more, under #<n>, and narrows to it', async () => {
    serve();
    renderAt('/context/documents');
    await waitFor(() => expect(rows('Documents')).toHaveLength(4));
    const marked = rows('Documents').filter((row) => within(row).queryByText('#7') !== null);
    expect(marked.map((row) => within(row).getByText(/Refunds|Payouts/).textContent)).toEqual(['Refunds', 'Payouts']);
    // The hover surface, portaled to the body: one per marked row.
    expect(screen.getAllByText('Shorten the refund window · refund-window')).toHaveLength(2);
  });

  it('narrows to the pull request from the address', async () => {
    serve();
    renderAt(`/context/documents?pr=${encodeURIComponent('acme/web#7')}`);
    await waitFor(() => expect(rows('Documents')).toHaveLength(2));
    for (const row of rows('Documents')) expect(within(row).getByText('#7')).toBeInTheDocument();
  });
});

describe('Context › Conflicts, the pull request rows', () => {
  it('lists the conflict the head would create under #<n>, open and not openable', async () => {
    serve();
    renderAt('/context/conflicts');
    const note = await screen.findByText('the refund window is two days in one and five in the other');
    const row = note.closest('tr')!;
    // The workspace's own conflict beside it, which opens; the pull request's does not.
    expect(rows('Conflicts')).toHaveLength(2);
    expect(within(row).getByText('#7')).toBeInTheDocument();
    expect(within(row).getByText('Open')).toBeInTheDocument();
    expect(row).not.toHaveAttribute('tabindex', '0');
    expect(within(screen.getByText('who owns the refund window').closest('tr')!).queryByText('#7')).toBeNull();
    expect(screen.getByText('who owns the refund window').closest('tr')).toHaveAttribute('tabindex', '0');
  });

  it('narrows to the pull request from the address, dropping the workspace’s own conflict', async () => {
    serve();
    renderAt(`/context/conflicts?pr=${encodeURIComponent('acme/web#7')}`);
    await screen.findByText('the refund window is two days in one and five in the other');
    expect(rows('Conflicts')).toHaveLength(1);
    expect(screen.queryByText('who owns the refund window')).toBeNull();
  });

  it('matches nothing for a pull request that created no conflict', async () => {
    serve();
    renderAt(`/context/conflicts?pr=${encodeURIComponent('acme/web#8')}`);
    await screen.findByText('No conflict matches.');
    cleanup();
  });
});
