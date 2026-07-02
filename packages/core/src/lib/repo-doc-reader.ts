/**
 * Seam for reading a repo doc's content by its repo-relative path.
 *
 * The Spec tab renders source docs (README.md, docs/adr/*.md) by path. OSS reads
 * them straight off the working tree — `repoKey` IS the checkout root. Hosted EE
 * has no persistent checkout (the repo lives on GitHub), so it installs a reader
 * at boot that fetches the file via the GitHub App installation. Callers use
 * `readRepoDoc` and never touch `fs` directly, so a single route works in both
 * editions with no edition branching.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Read `docPath` (repo-relative) for `repoKey`; resolves to null when absent. */
export type RepoDocReader = (repoKey: string, docPath: string) => Promise<string | null>;

/**
 * OSS default: read from the local working tree, where `repoKey` is the checkout
 * root. Confined to the repo tree (no traversal); returns null for a missing path
 * or a non-file.
 */
const fileRepoDocReader: RepoDocReader = async (repoKey, docPath) => {
  const root = path.resolve(repoKey);
  const full = path.resolve(root, docPath);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return fs.readFileSync(full, 'utf-8');
};

let reader: RepoDocReader = fileRepoDocReader;

/** Install a reader (EE swaps in a GitHub-backed one at boot). */
export function setRepoDocReader(fn: RepoDocReader): void {
  reader = fn;
}

/** Read a repo doc through the installed reader (FS in OSS, GitHub in EE). */
export function readRepoDoc(repoKey: string, docPath: string): Promise<string | null> {
  return reader(repoKey, docPath);
}
