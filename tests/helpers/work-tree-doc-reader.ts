/**
 * A document reader backed by a working TREE — the test double for a suite that
 * seeds its documents as files in a temp repo and then reads them back through
 * the seam.
 *
 * Production reads a document out of the store (the workspace's live body, else
 * a scan's snapshot); a test that has already written the document into the tree
 * the engine runs on is served by reading it from there. `repoKey` is the tree
 * root, and the read is confined to it.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  setRepoDocReader as setRepoDocReaderByPackage,
  resetRepoDocReader as resetRepoDocReaderByPackage,
  type RepoDocReader,
} from '@truecourse/core/lib/repo-doc-reader';
import {
  setRepoDocReader as setRepoDocReaderBySource,
  resetRepoDocReader as resetRepoDocReaderBySource,
} from '../../packages/core/src/lib/repo-doc-reader';

export const workTreeDocReader: RepoDocReader = async (repoKey, docPath) => {
  const root = path.resolve(repoKey);
  const full = path.resolve(root, docPath);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return fs.readFileSync(full, 'utf-8');
};

/**
 * Install the tree-backed reader for a suite. Pair with
 * {@link resetRepoDocReader}.
 *
 * Installed through both specifiers a test can reach the seam by — the package
 * (which resolves to the built `dist`) and the source path — because a test
 * imports the code under test either way, and the two are separate module
 * instances with separate state.
 */
export function installWorkTreeDocReader(): void {
  setRepoDocReaderByPackage(workTreeDocReader);
  setRepoDocReaderBySource(workTreeDocReader);
}

export function resetRepoDocReader(): void {
  resetRepoDocReaderByPackage();
  resetRepoDocReaderBySource();
}
