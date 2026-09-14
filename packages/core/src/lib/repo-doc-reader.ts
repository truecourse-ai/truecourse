/**
 * Seam for reading one document's content by its ref.
 *
 * A repository has no persistent checkout, so a document is never read from a
 * tree: boot installs a reader over the stored state — a `context/` ref through
 * the workspace's live body (else the scan's snapshot), any other ref through
 * the repository's own snapshot. Callers use `readRepoDoc` and never touch `fs`.
 */

/** Options for a doc read. `commit` pins the snapshot a PR view reads. */
export interface RepoDocReadOptions {
  /** The commit whose snapshot to read the document from. */
  commit?: string;
}

/** Read `docPath` for `repoKey`; resolves to null when the document is absent. */
export type RepoDocReader = (
  repoKey: string,
  docPath: string,
  opts?: RepoDocReadOptions,
) => Promise<string | null>;

let reader: RepoDocReader | null = null;

/** Install the reader (boot: the one over the stored documents). */
export function setRepoDocReader(fn: RepoDocReader): void {
  reader = fn;
}

/** Forget the installed reader (tests). */
export function resetRepoDocReader(): void {
  reader = null;
}

/** Read one document through the installed reader. */
export function readRepoDoc(
  repoKey: string,
  docPath: string,
  opts?: RepoDocReadOptions,
): Promise<string | null> {
  if (!reader) throw new Error('No repo doc reader installed (boot did not run installDbStores).');
  return reader(repoKey, docPath, opts);
}
