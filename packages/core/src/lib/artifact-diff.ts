/**
 * Generic base-vs-head diff primitives, shared by the dashboard PR-diff endpoints
 * (spec claims, decisions ledger, contracts). Pure + edition-agnostic — the caller
 * supplies the key (or path→content map); the diff logic is identical for OSS and
 * EE, only the data source differs. Mirrors `diffDrifts` (verify) and `diffDecisions`
 * (inferred), the other two diffs in the codebase.
 */

export interface AddedRemoved<T> {
  /** In head, not in base. */
  added: T[];
  /** In base, not in head. */
  removed: T[];
  unchangedCount: number;
}

/** Diff two lists by a stable key → added (head-only) / removed (base-only). */
export function diffByKey<T>(base: T[], head: T[], keyOf: (t: T) => string): AddedRemoved<T> {
  const baseKeys = new Set(base.map(keyOf));
  const headKeys = new Set(head.map(keyOf));
  const added = head.filter((t) => !baseKeys.has(keyOf(t)));
  const removed = base.filter((t) => !headKeys.has(keyOf(t)));
  return { added, removed, unchangedCount: head.length - added.length };
}

export interface ContentDiff {
  /** Paths only in head. */
  added: string[];
  /** Paths only in base. */
  removed: string[];
  /** Paths in both whose content differs. */
  modified: string[];
}

/**
 * A `.tc` `origin` line (`origin "src" "section" 11..15`) is provenance, not an
 * obligation: its line range shifts whenever the source doc moves (or the model
 * re-reports it), so it churns a contract diff with no real change. Strip origin
 * lines before comparing so a contract counts as "modified" only when its actual
 * content changed.
 */
export function stripOriginLines(tc: string): string {
  return tc
    .split('\n')
    .filter((l) => !/^\s*origin\s/.test(l))
    .join('\n');
}

/**
 * Diff two path→content maps → added / removed / modified. `normalize` is applied
 * to both sides before the content comparison (defaults to identity); pass
 * {@link stripOriginLines} for `.tc` contracts so provenance-only changes don't
 * read as modifications.
 */
export function diffContents(
  base: Map<string, string>,
  head: Map<string, string>,
  normalize: (s: string) => string = (s) => s,
): ContentDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const [p, c] of head) {
    if (!base.has(p)) added.push(p);
    else if (normalize(base.get(p)!) !== normalize(c)) modified.push(p);
  }
  for (const p of base.keys()) if (!head.has(p)) removed.push(p);
  return { added, removed, modified };
}
