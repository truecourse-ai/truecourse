/**
 * Injectable seam: read the workspace Knowledge ledger's display metadata (title +
 * deep-link) for a hosted repo's inherited docs.
 *
 * A connected repo's curated corpus can contain workspace-inherited docs (refs that
 * start `knowledge/`, folded in before curate). The repo corpus GET tags those with
 * `layer: 'workspace'` and — hosted only — enriches them with the ledger's human
 * title + source URL for display. The OSS dashboard route hands the repoKey + the
 * inherited doc paths through this seam without importing any EE package (a sibling
 * adapter over core — same rule as `repo-doc-reader` / `spec-inheritance-hook`).
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

/**
 * The STORED body of a repo's inherited doc, by its `knowledge/`-prefixed path — the
 * inherited layer folds workspace docs into the repo corpus at scan time, but their
 * bodies live in the workspace document store, not the repo tree. The repo Spec-tab
 * doc route reads them through this seam so a `knowledge/` ref serves the same content
 * that scan folded in. Null when the repo has no workspace, no ledger row for the path,
 * or the body is absent (the route renders that as its 404). Same seam idiom as the
 * title reader above; EE installs it, unset in OSS/tests. Reads only.
 */
export type KnowledgeDocBodyReader = (
  repoKey: string,
  docPath: string,
) => Promise<string | null>;

let bodyReader: KnowledgeDocBodyReader | null = null;

/** Install the EE body reader (or clear it with null). Called once at boot. */
export function setKnowledgeDocBodyReader(fn: KnowledgeDocBodyReader | null): void {
  bodyReader = fn;
}

/** The active body reader, or null when none is registered (OSS/tests). */
export function getKnowledgeDocBodyReader(): KnowledgeDocBodyReader | null {
  return bodyReader;
}
