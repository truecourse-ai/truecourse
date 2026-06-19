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

/** Diff two path→content maps → added / removed / modified. */
export function diffContents(base: Map<string, string>, head: Map<string, string>): ContentDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const [p, c] of head) {
    if (!base.has(p)) added.push(p);
    else if (base.get(p) !== c) modified.push(p);
  }
  for (const p of base.keys()) if (!head.has(p)) removed.push(p);
  return { added, removed, modified };
}
