/**
 * A repository's DEPENDENCIES — the starting state its flows need — read and
 * registered: what the guard routes and the MCP tools both call.
 *
 * The view is composed over a scratch tree of the repository's stored state
 * (the setup bundle, the scenario set, the generate report and the encrypted
 * overlays) with an EMPTY host env, so the server's own variables never read
 * as a registered account. A registration runs the writer over the same kind
 * of tree, and what it leaves in the two overlay files becomes the
 * repository's encrypted overlay row.
 *
 * A registered secret never comes back: the engine's view masks it, and a
 * caller that must not see even the mask reads `filled` flags instead.
 */

import { readGuardDependenciesView, writeGuardDependency } from '@truecourse/core/commands/guard-dependencies';
import type {
  GuardDependenciesView,
  GuardDependencyPatch,
} from '@truecourse/core/commands/guard-dependencies';
import { readGuardOverlaysFromTree, writeGuardOverlays } from '@truecourse/core/lib/guard-overlays';
import { withGuardReadTree } from '@truecourse/core/lib/guard-read-tree';
import { hostedDependenciesView } from '../routes/guard-dependencies-hosted.js';
import { emitSpecComplete } from '../socket/handlers.js';

/** The dependencies view of one repository, at `ref` when one is named. */
export function readRepoDependencies(repoPath: string, ref?: string): Promise<GuardDependenciesView> {
  return withGuardReadTree(repoPath, ref, (tree) =>
    hostedDependenciesView(tree, readGuardDependenciesView(tree, { env: {}, hostless: true })),
  );
}

/** A refused registration: no name was given. */
export class DependencyNameRequiredError extends Error {}

/**
 * Register ONE dependency's instance. The caller names a dependency, never a
 * file, so the write is confined to the store's own path by construction. Only
 * variables the committed registration DECLARES are accepted (the engine's
 * `GuardDependencyWriteError` / `GuardExternalsWriteError` otherwise), and the
 * answer is the fresh view, which masks every secret.
 *
 * Registering an instance changes what the next generate can author, so it
 * emits the same completion event the externals write does and every open
 * guard view refetches.
 */
export async function registerRepoDependency(
  org: string,
  repoId: string,
  repoPath: string,
  name: unknown,
  patch: GuardDependencyPatch,
): Promise<GuardDependenciesView> {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new DependencyNameRequiredError('dependency write requires { name, … }.');
  }
  const view = await withGuardReadTree(repoPath, undefined, async (tree) => {
    const written = writeGuardDependency(tree, name, patch, { env: {}, hostless: true });
    await writeGuardOverlays(repoPath, readGuardOverlaysFromTree(tree));
    return hostedDependenciesView(tree, written);
  });
  emitSpecComplete(org, repoId, 'guard-externals');
  return view;
}
