/**
 * Where a decision is WRITTEN, wherever it is made.
 *
 * A repository's corpus is its slice of the workspace's, folded with the
 * WORKSPACE's decisions — so a force-include, a force-exclude and a conflict
 * verdict made while reading through a repository must land in that workspace
 * ledger, not in a repository-scoped one nothing reads back. The reads stay the
 * repository's: its slice, its documents.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import { createRepoSpecSource } from '@/components/spec/spec-source';
import { createWorkspaceContextSource } from '@/dashboard/pages/context-spec-source';

const realFetch = window.fetch;

const DOC_A = 'context/site-docs-acme/refunds.md';
const DOC_B = 'context/site-docs-acme/payouts.md';

const VERDICT = {
  docA: DOC_A,
  sentenceA: 's-refunds',
  docB: DOC_B,
  sentenceB: 's-window',
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
        corpus: { version: 5, generatedAt: '', docs: [], areas: [], skippedDocs: [] },
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
    await source.deleteConflictResolution({ docA: DOC_A, sentenceA: 's-refunds', docB: DOC_B, sentenceB: 's-window' });

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
});
