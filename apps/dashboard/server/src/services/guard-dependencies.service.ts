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

import path from 'node:path';
import { readGuardDependenciesView, writeGuardDependency } from '@truecourse/core/commands/guard-dependencies';
import type {
  GuardDependenciesView,
  GuardDependencyPatch,
} from '@truecourse/core/commands/guard-dependencies';
import { readGuardOverlaysFromTree, writeGuardOverlays } from '@truecourse/core/lib/guard-overlays';
import { withGuardReadTree } from '@truecourse/core/lib/guard-read-tree';
import { emitSpecComplete } from '../socket/handlers.js';

/**
 * The view as the wire carries it. It is composed over a scratch tree, so the
 * file paths it names are that tree's — a server temp dir no reader can open.
 * They travel repo-relative instead, the way the setup bundle names the same
 * files.
 */
function hostedDependenciesView(tree: string, view: GuardDependenciesView): GuardDependenciesView {
  const rel = (abs: string): string => path.relative(tree, abs).split(path.sep).join('/');
  return {
    ...view,
    catalogPath: rel(view.catalogPath),
    localPath: rel(view.localPath),
    recipePath: rel(view.recipePath),
  };
}

/** The dependencies view of one repository, at `ref` when one is named. */
export function readRepoDependencies(repoPath: string, ref?: string): Promise<GuardDependenciesView> {
  return withGuardReadTree(repoPath, ref, (tree) =>
    hostedDependenciesView(tree, readGuardDependenciesView(tree, { env: {}, hostless: true })),
  );
}

/**
 * The dependencies view with EVERY value withheld — not only the secrets the
 * engine masks, but the readable ones too (a base URL, a host path): which
 * fields are filled in, never what with. What a surface outside the dashboard
 * is given, so a stored value cannot leave through it.
 */
export function dependencyFillState(view: GuardDependenciesView) {
  return {
    ...(view.invalidReason ? { invalidReason: view.invalidReason } : {}),
    dependencies: view.dependencies.map((d) => ({
      name: d.name,
      class: d.class,
      summary: d.summary,
      requirement: d.requirement,
      ...(d.when ? { when: d.when } : {}),
      state: d.state,
      fields: d.fields.map((f) => ({
        field: f.field,
        filled: f.resolved,
        secret: f.secret,
        ...(f.description ? { description: f.description } : {}),
        ...(f.reason ? { reason: f.reason } : {}),
      })),
      ...(d.service
        ? {
            service: {
              services: d.service.services,
              baseUrlEnv: d.service.baseUrlEnv,
              baseUrlSet: d.service.baseUrl !== null,
              ...(d.service.mode ? { mode: d.service.mode } : {}),
              tokenSet: d.service.tokenSet,
              headers: d.service.headers.map((h) => h.name),
            },
          }
        : {}),
      usedBy: d.usedBy,
      blocks: d.blocks.map((b) => ({ ...(b.flowId ? { flowId: b.flowId } : {}), title: b.title, kind: b.kind })),
    })),
  };
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
