/**
 * The SINGLE empty-corpus derivation + user-facing explanation — ONE copy in
 * @truecourse/shared, imported by the spec-scan CLI, the guard CLI, and the
 * dashboard client so every surface explains an empty corpus identically.
 *
 * "Empty corpus" has two distinct flavors, and silence-as-success (reporting an
 * empty corpus as "nothing changed") is the bug this closes:
 *   - 'no-docs-found'   — nothing was discoverable (docsScanned === 0). The repo
 *                         may hold non-markdown docs (.rst/.adoc/…), out-of-scope
 *                         markdown, or ignored paths — only markdown is scanned.
 *   - 'all-docs-dropped' — docs were scanned but the relevance filter kept none
 *                         (docsScanned > 0, docsKept === 0). Drop reasons live in
 *                         the corpus's skippedDocs; force-include via decisions.
 *
 * The messages carry generic remedy pointers and NEVER point at `guard generate`
 * (an empty corpus has nothing to guard) — see the surface layers that render them.
 */

export type EmptyCorpusFlavor = 'no-docs-found' | 'all-docs-dropped';

/** The scan counts an empty-corpus classification and message need. */
export interface CorpusScanCounts {
  /** Docs discovered in scope before the relevance filter (the "Scanned N" number). */
  docsScanned: number;
  /** Kept docs (the corpus's `docs` length). */
  docsKept: number;
  /** Ignored doc-like non-markdown files by extension (`.rst` → count), keys carry the dot. */
  ignoredNonMarkdown: Record<string, number>;
}

/**
 * The minimal persisted-corpus shape `corpusScanCounts` reads — structural, so the
 * server-side CuratedCorpus, the tolerant guard-generator parse, and the client's
 * corpus payload all satisfy it without depending on each other's full types.
 * (Named for its role — `CorpusLike` is taken by the overlap derivation's shape.)
 */
export interface CorpusCountsSource {
  docs: readonly unknown[];
  skippedDocs?: readonly unknown[];
  stats?: { docsScanned?: number; ignoredNonMarkdown?: Record<string, number> };
}

/**
 * The ONE corpus → scan-counts derivation, including the legacy fallback: a corpus
 * written before the stats block existed reconstructs `docsScanned` as kept +
 * skipped (exact — every discovered doc lands in one of the two lists). Accepts
 * a missing corpus for caller convenience (all-zero counts).
 */
export function corpusScanCounts(corpus: CorpusCountsSource | null | undefined): CorpusScanCounts {
  if (!corpus) return { docsScanned: 0, docsKept: 0, ignoredNonMarkdown: {} };
  const docsKept = corpus.docs.length;
  return {
    docsScanned: corpus.stats?.docsScanned ?? docsKept + (corpus.skippedDocs?.length ?? 0),
    docsKept,
    ignoredNonMarkdown: corpus.stats?.ignoredNonMarkdown ?? {},
  };
}

/**
 * Classify a corpus's empty-ness, or `undefined` when it holds at least one kept
 * doc. `no-docs-found` wins whenever nothing was discoverable (docsScanned === 0),
 * regardless of docsKept.
 */
export function deriveEmptyCorpus(
  counts: Pick<CorpusScanCounts, 'docsScanned' | 'docsKept'>,
): EmptyCorpusFlavor | undefined {
  if (counts.docsScanned === 0) return 'no-docs-found';
  if (counts.docsKept === 0) return 'all-docs-dropped';
  return undefined;
}

export interface EmptyCorpusMessageInput {
  flavor: EmptyCorpusFlavor;
  /** Docs discovered (in scope) before the relevance filter — the N in "Scanned N docs". */
  docsScanned: number;
  /**
   * Per-extension counts of ignored doc-like non-markdown files (`.rst` → count),
   * surfaced only for the 'no-docs-found' flavor to explain why nothing was found.
   * rst support itself is a separate feature (#806); this is just the count.
   */
  ignoredNonMarkdown?: Record<string, number>;
}

/** "23 .rst, 2 .adoc" — counts descending, extension ascending on ties. Empty ⇒ "". */
function formatIgnoredBreakdown(ignored: Record<string, number>): string {
  return Object.entries(ignored)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([ext, n]) => `${n} ${ext}`)
    .join(', ');
}

/**
 * The one user-facing explanation of an empty corpus, as a single string (one or
 * more sentences). Callers render it via a WARNING channel (CLI `p.log.warn`, a
 * warning-styled toast, or an EmptyState body) — the wording itself is neutral.
 */
export function formatEmptyCorpus(input: EmptyCorpusMessageInput): string {
  if (input.flavor === 'no-docs-found') {
    const parts = ['No spec documents found — only markdown (.md) documents are scanned.'];
    const breakdown = formatIgnoredBreakdown(input.ignoredNonMarkdown ?? {});
    if (breakdown) parts.push(`Ignored ${breakdown} files.`);
    parts.push(
      'Check your .truecourseignore and the spec.include scope in .truecourse/config.json.',
    );
    return parts.join(' ');
  }
  // all-docs-dropped
  return (
    `Scanned ${input.docsScanned} docs but kept none — every doc was dropped as not spec-relevant. ` +
    'Review the drop reasons and force-include any real specs via spec decisions (manualIncludes).'
  );
}
