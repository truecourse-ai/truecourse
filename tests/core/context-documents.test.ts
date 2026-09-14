/**
 * The rows of the Documents view: what a document's row SAYS, and how its one
 * status is arrived at.
 *
 * The fold is the whole point of composing these on the server — a document is
 * read by every repository linked to its source, each of which may say
 * something different about it, and the reader is owed the worst of those. Pure,
 * so every case here is stated without a store.
 */

import { describe, it, expect } from 'vitest';
import {
  composeContextDocumentRows,
  filterContextDocumentRows,
  type ContextRowDocument,
  type ContextRowSource,
} from '@truecourse/core/services/context';
import {
  CONTEXT_DOCUMENT_STATUS_ORDER,
  contextDecisionPending,
  type ContextDocumentRow,
  type GuardCoveragePlainStatus,
} from '@truecourse/shared';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';

const REPO = (path: string): string => `context/repo-acme-web/${path}`;
const SITE = (path: string): string => `context/site-docs-acme/${path}`;

const SOURCES: ContextRowSource[] = [
  { id: 'repo-acme-web', title: 'acme/web', kind: 'repository' },
  { id: 'site-docs-acme', title: 'docs.acme.com', kind: 'site' },
];

const LEDGER: ContextRowDocument[] = [
  {
    sourceId: 'repo-acme-web',
    docPath: 'docs/refunds.md',
    title: 'Refunds',
    updatedAt: '2026-09-01T10:00:00.000Z',
  },
  {
    sourceId: 'site-docs-acme',
    docPath: 'webhooks.md',
    title: 'Webhooks',
    updatedAt: '2026-09-02T10:00:00.000Z',
  },
];

function corpus(): CuratedCorpus {
  return {
    version: 3,
    generatedAt: '2026-09-03T00:00:00.000Z',
    docs: [
      {
        ref: REPO('docs/refunds.md'),
        kind: 'prd',
        lastTouched: '',
        areaTags: ['acme/payments'],
        sourceId: 'repo-acme-web',
        sourceKind: 'repository',
      },
      {
        ref: SITE('webhooks.md'),
        kind: 'reference',
        lastTouched: '',
        areaTags: ['acme/platform'],
        sourceId: 'site-docs-acme',
        sourceKind: 'site',
      },
      {
        ref: REPO('docs/orphan.md'),
        kind: 'prd',
        lastTouched: '',
        areaTags: [],
        sourceId: 'repo-acme-web',
        sourceKind: 'repository',
      },
    ],
    areas: [],
    relations: [],
    skippedDocs: [],
  } as unknown as CuratedCorpus;
}

/** A coverage map in the shape the route hands in: repository → ref → word. */
function coverage(
  entries: Record<string, Record<string, GuardCoveragePlainStatus>>,
): Map<string, Map<string, GuardCoveragePlainStatus>> {
  return new Map(
    Object.entries(entries).map(([repo, refs]) => [repo, new Map(Object.entries(refs))]),
  );
}

describe('the rows of the Documents view', () => {
  it('names each document from the ledger, the corpus and its source', () => {
    const rows = composeContextDocumentRows({
      corpus: corpus(),
      sources: SOURCES,
      documents: LEDGER,
      bindings: [{ repoFullName: 'acme/web', sourceId: 'repo-acme-web' }],
      coverage: coverage({ 'acme/web': { [REPO('docs/refunds.md')]: 'succeeded' } }),
    });

    const refunds = rows.find((row) => row.ref === REPO('docs/refunds.md'))!;
    expect(refunds.title).toBe('Refunds');
    expect(refunds.area).toBe('acme/payments');
    expect(refunds.sourceId).toBe('repo-acme-web');
    expect(refunds.sourceTitle).toBe('acme/web');
    expect(refunds.sourceKind).toBe('repository');
    expect(refunds.repositories).toEqual(['acme/web']);
    expect(refunds.status).toBe('proved');
    expect(refunds.updatedAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('falls back to the file name for a document the ledger has lost', () => {
    const rows = composeContextDocumentRows({
      corpus: corpus(),
      sources: SOURCES,
      documents: LEDGER,
      bindings: [],
      coverage: coverage({}),
    });
    const orphan = rows.find((row) => row.ref === REPO('docs/orphan.md'))!;
    expect(orphan.title).toBe('orphan.md');
    expect(orphan.updatedAt).toBeNull();
  });

  it('folds the status worst-first across every repository that reads it', () => {
    const rows = composeContextDocumentRows({
      corpus: corpus(),
      sources: SOURCES,
      documents: LEDGER,
      bindings: [
        { repoFullName: 'acme/web', sourceId: 'site-docs-acme' },
        { repoFullName: 'acme/api', sourceId: 'site-docs-acme' },
      ],
      coverage: coverage({
        'acme/web': { [SITE('webhooks.md')]: 'succeeded' },
        'acme/api': { [SITE('webhooks.md')]: 'failed' },
      }),
    });

    const webhooks = rows.find((row) => row.ref === SITE('webhooks.md'))!;
    expect(webhooks.repositories).toEqual(['acme/api', 'acme/web']);
    // A failure in one repository is never hidden behind a proof in another.
    expect(webhooks.status).toBe('failed');
    expect(webhooks.readings).toEqual([
      { repository: 'acme/api', status: 'failed' },
      { repository: 'acme/web', status: 'proved' },
    ]);
  });

  it('is Not linked when no repository reads its source', () => {
    const rows = composeContextDocumentRows({
      corpus: corpus(),
      sources: SOURCES,
      documents: LEDGER,
      bindings: [],
      coverage: coverage({}),
    });
    expect(rows.every((row) => row.status === 'not-linked')).toBe(true);
    expect(rows.every((row) => row.repositories.length === 0)).toBe(true);
  });

  it('is Not run when a repository reads it but could say nothing about it', () => {
    const rows = composeContextDocumentRows({
      corpus: corpus(),
      sources: SOURCES,
      documents: LEDGER,
      bindings: [{ repoFullName: 'acme/web', sourceId: 'repo-acme-web' }],
      coverage: coverage({ 'acme/web': {} }),
    });
    expect(rows.find((row) => row.ref === REPO('docs/refunds.md'))!.status).toBe('not-run');
  });

  it('leaves out a repository the caller cannot see', () => {
    const rows = composeContextDocumentRows({
      corpus: corpus(),
      sources: SOURCES,
      documents: LEDGER,
      bindings: [
        { repoFullName: 'acme/web', sourceId: 'site-docs-acme' },
        { repoFullName: 'other/thing', sourceId: 'site-docs-acme' },
      ],
      coverage: coverage({
        'acme/web': { [SITE('webhooks.md')]: 'blocked' },
        'other/thing': { [SITE('webhooks.md')]: 'failed' },
      }),
      visibleRepos: new Set(['acme/web']),
    });
    const webhooks = rows.find((row) => row.ref === SITE('webhooks.md'))!;
    expect(webhooks.repositories).toEqual(['acme/web']);
    expect(webhooks.status).toBe('blocked');
  });

  it('orders the rows worst first, then by title', () => {
    const rows = composeContextDocumentRows({
      corpus: corpus(),
      sources: SOURCES,
      documents: LEDGER,
      bindings: [
        { repoFullName: 'acme/web', sourceId: 'repo-acme-web' },
        { repoFullName: 'acme/web', sourceId: 'site-docs-acme' },
      ],
      coverage: coverage({
        'acme/web': {
          [REPO('docs/refunds.md')]: 'succeeded',
          [SITE('webhooks.md')]: 'failed',
          [REPO('docs/orphan.md')]: 'blocked',
        },
      }),
    });
    expect(rows.map((row) => row.status)).toEqual(['failed', 'blocked', 'proved']);
  });

  it('names a source the scan knew and the workspace has since dropped', () => {
    const rows = composeContextDocumentRows({
      corpus: corpus(),
      sources: [],
      documents: LEDGER,
      bindings: [],
      coverage: coverage({}),
    });
    expect(rows.find((row) => row.ref === SITE('webhooks.md'))!.sourceTitle).toBe('site-docs-acme');
  });
});

describe('narrowing the rows', () => {
  const rows = composeContextDocumentRows({
    corpus: corpus(),
    sources: SOURCES,
    documents: LEDGER,
    bindings: [
      { repoFullName: 'acme/web', sourceId: 'repo-acme-web' },
      { repoFullName: 'acme/api', sourceId: 'site-docs-acme' },
    ],
    coverage: coverage({
      'acme/web': { [REPO('docs/refunds.md')]: 'failed' },
      'acme/api': { [SITE('webhooks.md')]: 'succeeded' },
    }),
  });

  it('is AND across dimensions and OR within one', () => {
    expect(filterContextDocumentRows(rows, { status: ['failed'] }).map((r) => r.ref)).toEqual([
      REPO('docs/refunds.md'),
    ]);
    expect(
      filterContextDocumentRows(rows, { status: ['failed', 'proved'] }).map((r) => r.ref),
    ).toEqual([REPO('docs/refunds.md'), SITE('webhooks.md')]);
    expect(
      filterContextDocumentRows(rows, { status: ['failed'], source: ['site-docs-acme'] }),
    ).toEqual([]);
  });

  it('narrows by the repository that reads it, and by its area', () => {
    expect(filterContextDocumentRows(rows, { repo: ['acme/api'] }).map((r) => r.ref)).toEqual([
      SITE('webhooks.md'),
    ]);
    expect(filterContextDocumentRows(rows, { area: ['acme/payments'] }).map((r) => r.ref)).toEqual([
      REPO('docs/refunds.md'),
    ]);
  });

  it('keeps everything when no dimension is named', () => {
    expect(filterContextDocumentRows(rows, {})).toHaveLength(3);
  });
});

/**
 * INCLUSION, the dimension coverage is not. The rows widen past the corpus only
 * when the caller hands the decisions in, because a document with no row
 * anywhere cannot be decided about — and Home, which counts what is proven,
 * hands none in and sees the corpus alone.
 */
describe('where a document stands with the corpus', () => {
  const CHANGELOG = SITE('changelog.md');
  const LEGACY = SITE('legacy.md');

  const WIDE_LEDGER: ContextRowDocument[] = [
    ...LEDGER,
    {
      sourceId: 'site-docs-acme',
      docPath: 'changelog.md',
      title: 'Changelog',
      updatedAt: '2026-09-04T10:00:00.000Z',
    },
    {
      sourceId: 'site-docs-acme',
      docPath: 'legacy.md',
      title: 'Legacy',
      updatedAt: '2026-09-05T10:00:00.000Z',
    },
  ];

  /** The corpus with one document the scan skipped, and its words for it. */
  function skipped(): CuratedCorpus {
    return {
      ...corpus(),
      skippedDocs: [
        { ref: CHANGELOG, reason: 'a changelog, not a specification', category: 'changelog' },
      ],
    } as CuratedCorpus;
  }

  const compose = (
    over: Partial<Parameters<typeof composeContextDocumentRows>[0]> = {},
  ): ReturnType<typeof composeContextDocumentRows> =>
    composeContextDocumentRows({
      corpus: skipped(),
      sources: SOURCES,
      documents: WIDE_LEDGER,
      bindings: [{ repoFullName: 'acme/web', sourceId: 'site-docs-acme' }],
      coverage: coverage({ 'acme/web': { [SITE('webhooks.md')]: 'failed' } }),
      ...over,
    });

  const find = (
    rows: ReturnType<typeof composeContextDocumentRows>,
    ref: string,
  ): ContextDocumentRow | undefined => rows.find((row) => row.ref === ref);

  it('holds to the corpus when no decisions are handed in', () => {
    const rows = compose();
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.inCorpus)).toBe(true);
    expect(rows.every((row) => row.inclusion === 'in-corpus')).toBe(true);
    expect(rows.every((row) => row.status !== null)).toBe(true);
  });

  it('gives the document the scan skipped a row, with the scan’s own reason', () => {
    const row = find(compose({ decisions: {} }), CHANGELOG)!;
    expect(row.title).toBe('Changelog');
    expect(row.inCorpus).toBe(false);
    expect(row.inclusion).toBe('not-included');
    expect(row.skipReason).toBe('a changelog, not a specification');
    // Nothing reads what the corpus does not hold, so nothing has a reading.
    expect(row.status).toBeNull();
    expect(row.repositories).toEqual([]);
    expect(row.readings).toEqual([]);
  });

  it('says a force-include stands that the corpus has not applied', () => {
    const row = find(compose({ decisions: { manualIncludes: [CHANGELOG] } }), CHANGELOG)!;
    expect(row.decision).toBe('include');
    expect(row.inclusion).toBe('not-included');
    expect(contextDecisionPending(row)).toBe(true);
  });

  it('reads a force-include a scan has since applied as in the corpus', () => {
    const row = find(
      compose({ decisions: { manualIncludes: [SITE('webhooks.md')] } }),
      SITE('webhooks.md'),
    )!;
    expect(row.decision).toBe('include');
    expect(row.inclusion).toBe('in-corpus');
    expect(contextDecisionPending(row)).toBe(false);
  });

  it('reads an exclusion the corpus still holds as excluded, keeping its coverage word', () => {
    const row = find(
      compose({ decisions: { manualExcludes: [SITE('webhooks.md')] } }),
      SITE('webhooks.md'),
    )!;
    expect(row.inclusion).toBe('excluded');
    expect(row.inCorpus).toBe(true);
    expect(row.status).toBe('failed');
    expect(contextDecisionPending(row)).toBe(true);
  });

  it('gives a document the scan dropped whole a row off the ledger alone', () => {
    const row = find(compose({ decisions: { manualExcludes: [LEGACY] } }), LEGACY)!;
    expect(row.title).toBe('Legacy');
    expect(row.inclusion).toBe('excluded');
    expect(row.inCorpus).toBe(false);
    expect(row.status).toBeNull();
    // The scan said nothing about it: the decision is the whole reason.
    expect(row.skipReason).toBeNull();
    expect(contextDecisionPending(row)).toBe(false);
  });

  it('names no document the ledger has forgotten', () => {
    const rows = compose({ decisions: { manualExcludes: [SITE('gone.md')] } });
    expect(find(rows, SITE('gone.md'))).toBeUndefined();
  });

  it('sorts every document the corpus does not hold after every one it does', () => {
    const rows = compose({ decisions: { manualExcludes: [LEGACY] } });
    expect(rows.map((row) => row.status === null)).toEqual([false, false, false, true, true]);
    expect(rows.slice(3).map((row) => row.title)).toEqual(['Changelog', 'Legacy']);
  });

  it('narrows by inclusion, and never answers a status with what has none', () => {
    const rows = compose({ decisions: { manualExcludes: [LEGACY] } });
    expect(
      filterContextDocumentRows(rows, { inclusion: ['not-included'] }).map((r) => r.ref),
    ).toEqual([CHANGELOG]);
    expect(filterContextDocumentRows(rows, { inclusion: ['excluded'] }).map((r) => r.ref)).toEqual([
      LEGACY,
    ]);
    expect(filterContextDocumentRows(rows, { inclusion: ['in-corpus'] })).toHaveLength(3);
    // The two statusless rows answer no coverage question, not even Not linked.
    expect(
      filterContextDocumentRows(rows, { status: [...CONTEXT_DOCUMENT_STATUS_ORDER] }),
    ).toHaveLength(3);
  });
});
