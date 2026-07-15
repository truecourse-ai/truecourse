/**
 * Injectable seam: read the workspace Knowledge ledger's display metadata (title +
 * deep-link) for a hosted repo's inherited docs.
 *
 * A connected repo's curated corpus can contain workspace-inherited docs (refs that
 * start `knowledge/`, folded in before curate). The repo corpus GET tags those with
 * `layer: 'workspace'` and — hosted only — enriches them with the ledger's human
 * title + source URL for display. The OSS dashboard route hands the repoKey + the
 * inherited doc paths through this seam without importing any EE package (a sibling
 * adapter over core — same rule as `repo-doc-reader` / `spec-conflicts-resolved-hook`).
 *
 * Installed by the enterprise edition (which resolves the repo's workspace org from
 * its stored gate records and batches one ledger query); unset in OSS/tests → the
 * caller adds no title/url and the client falls back to the ref. Reads only.
 */

/** The ledger's human title + source deep-link for one inherited doc. */
export interface KnowledgeDocMeta {
  title: string;
  url: string | null;
}

/**
 * Title/url for a repo's inherited doc paths, keyed by docPath. A path with no live
 * ledger row (pruned since the corpus was built) is simply absent from the map, so
 * the caller leaves it un-enriched. Empty map when the repo has no workspace.
 */
export type KnowledgeLedgerReader = (
  repoKey: string,
  docPaths: string[],
) => Promise<Map<string, KnowledgeDocMeta>>;

let reader: KnowledgeLedgerReader | null = null;

/** Install the EE reader (or clear it with null). Called once at boot. */
export function setKnowledgeLedgerReader(fn: KnowledgeLedgerReader | null): void {
  reader = fn;
}

/** The active reader, or null when none is registered (OSS/tests). */
export function getKnowledgeLedgerReader(): KnowledgeLedgerReader | null {
  return reader;
}
