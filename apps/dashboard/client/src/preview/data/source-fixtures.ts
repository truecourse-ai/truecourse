// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * The fake documentation sites (./orders-api.catalog.ts, ./other-repos.ts)
 * folded into the EXACT payload shapes the real SOURCES page consumes, so the
 * Sources tab renders the existing `SpecSourceDetail` /
 * `SpecSourceAddForm` / `SpecDocViewer` unchanged.
 *
 * A page's corpus REF is `sources/<id>-docs/<slug>.md`, which is the same path
 * the spec corpus carries for a fetched doc, so previewing the Stripe refunds
 * page finds its row in the corpus and offers the jump into Coverage, while a
 * page no scan has seen says what would put it there.
 *
 * The mutations (add, refresh, remove) are answered from a per-repo registry
 * held in memory for the life of the page. Nothing is persisted: a reload is a
 * fresh registry, which is the whole contract of a mock.
 */

import type {
  SpecSourceAddResult,
  SpecSourceDetailView,
  SpecSourceDoc,
  SpecSourcePreview,
  SpecSourceRefreshResult,
  SpecSourceSkip,
  SpecSourceView,
} from '@/preview/vendor/lib/api';
import { agoIso, slugify } from './flow-fixtures';
import { REPO_GUARD } from './index';
import type { DocSource, SourcePage } from './types';

/** The per-repo registry, seeded from the board and mutated by the page's actions. */
const REGISTRY = new Map<string, DocSource[]>();

function registry(repoId: string): DocSource[] {
  let sources = REGISTRY.get(repoId);
  if (!sources) {
    sources = (REPO_GUARD[repoId]?.sources ?? []).map((s) => ({ ...s, pages: [...s.pages] }));
    REGISTRY.set(repoId, sources);
  }
  return sources;
}

/** Where a site's snapshot lands in the repo, the corpus refs the docs carry. */
function refBase(sourceId: string): string {
  return `sources/${sourceId}-docs`;
}

export function pageRef(sourceId: string, page: SourcePage): string {
  return `${refBase(sourceId)}/${slugify(page.title)}.md`;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** The links a fetch passed over, derived from the site so every site has some. */
function skipsFor(source: DocSource): SpecSourceSkip[] {
  const origin = originOf(source.llmsTxtUrl);
  return [
    { url: `${origin}/changelog`, reason: 'not-markdown', detail: 'text/html' },
    { url: 'https://github.com/example/repo', reason: 'external-origin' },
  ];
}

function view(source: DocSource): SpecSourceView {
  return {
    id: source.id,
    title: source.title,
    llmsTxtUrl: source.llmsTxtUrl,
    fetchedAt: agoIso(source.fetchedAt),
    docCount: source.pages.length,
    skipped: skipsFor(source),
  };
}

function docs(source: DocSource): SpecSourceDoc[] {
  return source.pages.map((page) => ({
    ref: pageRef(source.id, page),
    path: `${slugify(page.title)}.md`,
    title: page.title,
    url: page.url,
  }));
}

export function listSources(repoId: string): { sources: SpecSourceView[] } {
  return { sources: registry(repoId).map(view) };
}

export function sourceDetail(repoId: string, sourceId: string): { source: SpecSourceDetailView } | null {
  const source = registry(repoId).find((s) => s.id === sourceId);
  return source ? { source: { ...view(source), docs: docs(source) } } : null;
}

/** One snapshotted page's markdown, by its corpus ref. */
export function sourcePageMarkdown(repoId: string, ref: string): string | null {
  for (const source of registry(repoId)) {
    for (const page of source.pages) {
      if (pageRef(source.id, page) === ref) return page.body;
    }
  }
  return null;
}

/** What an add WOULD fetch, the confirmation step, which writes nothing. */
export function previewSource(url: string): SpecSourcePreview {
  const host = originOf(url).replace(/^https?:\/\//, '');
  return {
    llmsTxtUrl: url,
    title: `${host} documentation`,
    totalLinks: 9,
    fetchableLinks: 7,
    skipped: [
      { url: `${originOf(url)}/pricing`, reason: 'not-markdown', detail: 'text/html' },
      { url: 'https://status.example.com', reason: 'external-origin' },
    ],
  };
}

/** Register a site and snapshot the pages its llms.txt lists. */
export function addSource(repoId: string, url: string, id?: string): SpecSourceAddResult {
  const host = originOf(url).replace(/^https?:\/\//, '');
  const sourceId = id ?? slugify(host.split('.')[0] ?? host);
  const fetchedAt = 'a moment ago';
  const pages: SourcePage[] = [
    {
      id: `${sourceId}-overview`,
      title: 'Overview',
      url: `${originOf(url)}/overview`,
      fetchedAt,
      body: `# Overview\n\nThe entry page of ${host}, snapshotted into this repository as a spec doc. The next Scan folds it into the corpus beside your own markdown.`,
    },
    {
      id: `${sourceId}-reference`,
      title: 'Reference',
      url: `${originOf(url)}/reference`,
      fetchedAt,
      body: `# Reference\n\nEvery operation ${host} documents, with the arguments it accepts and the responses it promises.`,
    },
  ];
  const source: DocSource = { id: sourceId, title: `${host} documentation`, llmsTxtUrl: url, fetchedAt, pages };
  const sources = registry(repoId);
  const existing = sources.findIndex((s) => s.id === sourceId);
  if (existing >= 0) sources.splice(existing, 1, source);
  else sources.push(source);
  return { source: view(source), written: pages.length, skipped: skipsFor(source) };
}

/** Refetch one site, or every registered one, and reconcile its snapshot. */
export function refreshSources(repoId: string, sourceId?: string): { results: SpecSourceRefreshResult[] } {
  const sources = registry(repoId).filter((s) => !sourceId || s.id === sourceId);
  const results = sources.map((source) => {
    source.fetchedAt = 'a moment ago';
    const changed = source.pages.slice(0, 1).map((p) => `${slugify(p.title)}.md`);
    return {
      source: view(source),
      added: [],
      changed,
      removed: [],
      unchanged: Math.max(0, source.pages.length - changed.length),
      skipped: skipsFor(source),
    };
  });
  return { results };
}

/** Drop a site: its snapshot and its registry entry. */
export function removeSource(repoId: string, sourceId: string): { removed: SpecSourceView } | null {
  const sources = registry(repoId);
  const index = sources.findIndex((s) => s.id === sourceId);
  if (index < 0) return null;
  const [removed] = sources.splice(index, 1);
  return { removed: view(removed!) };
}
