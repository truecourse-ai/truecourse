/**
 * The dependencies view of a HOSTED repository, as the wire carries it. The view
 * is composed over a scratch tree (`withGuardReadTree`), so the file paths it
 * names are that tree's — a server temp dir no reader can open. They travel
 * repo-relative instead, the way the setup bundle names the same files.
 */

import path from 'node:path';
import type { GuardDependenciesView } from '@truecourse/core/commands/guard-dependencies';

/** Absolute paths inside `tree` become repo-relative posix paths. */
export function hostedDependenciesView(tree: string, view: GuardDependenciesView): GuardDependenciesView {
  const rel = (abs: string): string => path.relative(tree, abs).split(path.sep).join('/');
  return {
    ...view,
    catalogPath: rel(view.catalogPath),
    localPath: rel(view.localPath),
    recipePath: rel(view.recipePath),
  };
}
