// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/lib/spec-web-source.ts; delete with the preview.
/**
 * Display mapping for WEB-SOURCE spec docs, pages snapshotted from a registered
 * llms.txt site by `truecourse spec source add`.
 *
 * Their corpus ref is the real repo-relative path of the snapshot file
 * (`.truecourse/specs/sources/<sourceId>/<page>.md`), which is what every
 * downstream consumer reads, but it is unreadable in a list. Everything that
 * shows one to a person renders `<source title> / <page path>` instead, and the
 * ref itself stays the identity (selection, tabs, decisions are unchanged).
 *
 * The source title comes from the corpus payload's enrichment (the server reads
 * `sources.json`); when it is missing, a ref carried by a decision list, or a
 * source that was removed, the id in the ref is used, so a label is always
 * derivable from the ref alone.
 */

import type { SpecCorpusResponse } from '@/preview/vendor/lib/api';

/** The repo-relative prefix every snapshot ref starts with (server-side constant). */
export const SPEC_SOURCES_REF_PREFIX = '.truecourse/specs/sources';

export interface WebDocRef {
  /** The source's registry id, from the ref's own path segment. */
  sourceId: string;
  /** The page's path inside the source (`cms/installation.md`). */
  page: string;
}

/** Split a snapshot ref into its source id + page path; null for a repo doc. */
export function parseWebDocRef(ref: string): WebDocRef | null {
  if (!ref.startsWith(`${SPEC_SOURCES_REF_PREFIX}/`)) return null;
  const rest = ref.slice(SPEC_SOURCES_REF_PREFIX.length + 1);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { sourceId: rest.slice(0, slash), page: rest.slice(slash + 1) };
}

/** True when a ref names a page of a registered web source. */
export function isWebDocRef(ref: string): boolean {
  return parseWebDocRef(ref) !== null;
}

/** `<source title> / <page path>` for a web ref, else null (a repo doc). */
export function webDocLabel(ref: string, sourceTitle?: string): string | null {
  const parsed = parseWebDocRef(ref);
  if (!parsed) return null;
  return `${sourceTitle ?? parsed.sourceId} / ${parsed.page}`;
}

/** The display label of any doc row: its web label, its title, else the ref. */
export function specDocLabel(
  doc: { ref: string; title?: string; sourceTitle?: string },
): string {
  return webDocLabel(doc.ref, doc.sourceTitle) ?? doc.title ?? doc.ref;
}

/**
 * True when the last scan has SEEN this ref, kept as a corpus doc, or dropped
 * into "Not included". Either way the Coverage tree carries a row for it, so
 * opening it there lands on something. A null corpus (never scanned, or the read
 * 404'd) knows no ref at all.
 */
export function corpusHasDoc(corpus: SpecCorpusResponse | null, ref: string): boolean {
  if (!corpus) return false;
  return (
    corpus.corpus.docs.some((d) => d.ref === ref) ||
    (corpus.corpus.skippedDocs ?? []).some((d) => d.ref === ref)
  );
}

/** Why a link in a site's llms.txt produced no snapshot page, in plain words. */
export const SKIP_REASON: Record<string, string> = {
  'external-origin': 'links off this site',
  'not-markdown': 'page is not markdown',
  'fetch-failed': 'could not be fetched',
};

/** "1 page" / "214 pages", one phrasing across the sources UI. */
export function pageCount(n: number): string {
  return `${n} page${n === 1 ? '' : 's'}`;
}
