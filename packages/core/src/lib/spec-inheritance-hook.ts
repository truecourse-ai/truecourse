/**
 * Injectable seam: fold the workspace Knowledge layer into a hosted repo's spec
 * before curate/generate.
 *
 * A connected repo inherits its workspace's Knowledge corpus. Because Knowledge is
 * a STORED-document model (bodies content-addressed in Postgres, decisions under
 * workspace scope), inheritance is a materialization problem: write every workspace
 * doc body into the repo's checkout at its exact `knowledge/<kind>/<id>.md` path and
 * hand back the workspace decisions so the caller can fold them UNDER the repo's own
 * (repo wins). The repo's curate then sees both layers as one doc universe and the
 * per-doc caches the workspace already paid for make the inherited docs ~free.
 *
 * Installed by the enterprise edition (which resolves the repo's workspace org from
 * its stored gate records and reads the provenance ledger); unset in OSS / EE
 * without a workspace → the caller materializes nothing and curates the repo's own
 * docs alone. Best-effort at the call site: the hook only reads (Pg), it never
 * mutates repo state.
 */

import type { DecisionsFile } from '@truecourse/spec-consolidator';

/** One workspace doc to materialize into a checkout — its stable path + body. */
export interface WorkspaceInheritanceDoc {
  /** The ledger's namespaced relative path, e.g. `knowledge/confluence/KAN-5.md`. */
  docPath: string;
  /** The stored (content-addressed) markdown body. */
  markdown: string;
  /** ISO timestamp the source tool reports; stamped onto the materialized file. */
  lastTouched?: string;
}

/** The workspace layer a repo inherits: doc bodies to materialize + the workspace
 *  decisions to fold under the repo's own. */
export interface WorkspaceInheritance {
  docs: WorkspaceInheritanceDoc[];
  decisions: DecisionsFile;
}

/**
 * Resolve the workspace layer for `repoKey`, or null when the repo inherits nothing
 * (OSS, or an EE repo whose workspace has no Knowledge). Reads only.
 */
export type SpecInheritanceHook = (repoKey: string) => Promise<WorkspaceInheritance | null>;

let hook: SpecInheritanceHook | null = null;

/** Install the EE resolver (or clear it with null). Called once at boot. */
export function setSpecInheritanceHook(fn: SpecInheritanceHook | null): void {
  hook = fn;
}

/** The active resolver, or null when none is registered (OSS/tests). */
export function getSpecInheritanceHook(): SpecInheritanceHook | null {
  return hook;
}
