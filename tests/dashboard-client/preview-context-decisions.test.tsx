/**
 * Where a decision is WRITTEN, wherever it is made.
 *
 * A repository's corpus is its slice of the workspace's, folded with the
 * WORKSPACE's decisions — so a force-include, a force-exclude and a conflict
 * verdict made while reading through a repository must land in that workspace
 * ledger, not in a repository-scoped one nothing reads back. The reads stay the
 * repository's: its slice, its documents.
 *
 * The one exception is the pull-request gate, which keeps a decisions overlay
 * of its own on the repository's routes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { createRepoSpecSource } from '@/components/spec/spec-source';
import { createWorkspaceContextSource } from '@/preview/pages/context-spec-source';
import { FindingCard, FindingResolveProvider } from '@/components/sessions/conversation-pieces';

const realFetch = window.fetch;

const DOC_A = 'context/site-docs-acme/refunds.md';
const DOC_B = 'context/site-docs-acme/payouts.md';

const VERDICT = {
  docA: DOC_A,
  anchorA: 'Refunds',
  docB: DOC_B,
  anchorB: 'Refund window',
  verdict: 'b' as const,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Record every request, answering each decision route with its own ack. */
function serve(): string[] {
  const calls: string[] = [];
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith('/conflict-resolution')) return json({ conflictResolutions: [] });
    if (url.pathname.endsWith('/corpus')) {
      return json({
        corpus: { version: 3, generatedAt: '', docs: [], areas: [], skippedDocs: [] },
        manualIncludes: [],
        manualExcludes: [],
        conflictResolutions: [],
      });
    }
    return json({ manualIncludes: [], manualExcludes: [] });
  }) as unknown as typeof window.fetch;
  return calls;
}

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('the source a document page reads through one repository', () => {
  it('writes every decision to the workspace, and reads the repository', async () => {
    const calls = serve();
    const source = createRepoSpecSource('web');

    await source.addInclude(DOC_A);
    await source.removeInclude(DOC_A);
    await source.addExclude(DOC_B);
    await source.removeExclude(DOC_B);
    await source.postConflictResolution(VERDICT);
    await source.deleteConflictResolution({
      docA: DOC_A,
      anchorA: 'Refunds',
      docB: DOC_B,
      anchorB: 'Refund window',
    });

    expect(calls).toEqual([
      'POST /api/context/includes',
      'DELETE /api/context/includes',
      'POST /api/context/excludes',
      'DELETE /api/context/excludes',
      'POST /api/context/conflict-resolution',
      'DELETE /api/context/conflict-resolution',
    ]);

    // The reads are still the repository's — its slice, and its documents.
    calls.length = 0;
    await source.getCorpus();
    await source.getDoc(DOC_A);
    expect(calls).toEqual([
      'GET /api/repos/web/spec/corpus',
      `GET /api/repos/web/spec/doc?ref=${encodeURIComponent(DOC_A)}`,
    ]);
  });

  it('writes the same places the workspace source does', async () => {
    const calls = serve();
    const workspace = createWorkspaceContextSource();

    await workspace.addInclude(DOC_A);
    await workspace.addExclude(DOC_B);
    await workspace.postConflictResolution(VERDICT);

    expect(calls).toEqual([
      'POST /api/context/includes',
      'POST /api/context/excludes',
      'POST /api/context/conflict-resolution',
    ]);
  });

  it('keeps a pull request’s decisions on the pull request', async () => {
    const calls = serve();
    const source = createRepoSpecSource('web', { pr: 42, ref: 'headsha' });

    await source.addInclude(DOC_A);
    await source.postConflictResolution(VERDICT);

    expect(calls).toEqual([
      'POST /api/repos/web/spec/includes?pr=42&ref=headsha',
      'POST /api/repos/web/spec/conflict-resolution?pr=42&ref=headsha',
    ]);
  });
});

describe('a verdict recorded on a finding of a repository’s run', () => {
  const FINDING = {
    claim: 'Refunds settle in two days, or five.',
    quotes: [
      { doc: DOC_A, heading: 'Refunds', quote: 'two business days' },
      { doc: DOC_B, heading: 'Refund window', quote: 'five business days' },
    ],
    dispute: {
      docA: DOC_A,
      anchorA: 'Refunds',
      quoteA: 'two business days',
      docB: DOC_B,
      anchorB: 'Refund window',
      quoteB: 'five business days',
    },
  };

  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('writes it to the workspace, though the run was a repository’s', async () => {
    const calls = serve();
    render(
      <MemoryRouter>
        <FindingResolveProvider repoId="web" active>
          <FindingCard finding={FINDING as never} />
        </FindingResolveProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup();

    // The conflicts it reads are the repository's slice of the corpus.
    await waitFor(() => expect(calls).toContain('GET /api/repos/web/spec/corpus'));

    await user.click(await screen.findByRole('button', { name: /payouts/i }));

    await waitFor(() => expect(calls).toContain('POST /api/context/conflict-resolution'));
    expect(calls.some((c) => c.includes('/api/repos/web/spec/conflict-resolution'))).toBe(false);
  });
});
