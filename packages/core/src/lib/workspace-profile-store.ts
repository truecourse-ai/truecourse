/**
 * The WORKSPACE PROFILE store — what a workspace says its product is.
 *
 * A workspace's name and its people are the identity provider's; this is the
 * one thing about a workspace that is ours, and it exists because the Document
 * scan has to attribute every document to a product or to somebody else's. The
 * sentence stored here is the whole of that subject: the scan's identity block
 * is built from it and nothing else.
 *
 * One seam, ONE implementation: the Postgres store (`@truecourse/data-store`),
 * installed at boot. Nothing is installed by default, and a read that arrives
 * before boot says so rather than inventing a workspace that described itself.
 */

import { WORKSPACE_DESCRIPTION_REQUIRED } from '@truecourse/shared';

/** One workspace's profile, exactly as the store holds it. */
export interface WorkspaceProfile {
  workspaceOrgId: string;
  /** What the product is, in one sentence. Never empty: a row exists only once it is set. */
  description: string;
  updatedAt: string;
}

export interface WorkspaceProfileStore {
  /** The workspace's profile, or null while it has never said what its product is. */
  get(workspaceOrgId: string): Promise<WorkspaceProfile | null>;
  /** Set it, or replace what is there. The store stamps `updatedAt`. */
  save(workspaceOrgId: string, description: string): Promise<WorkspaceProfile>;
}

/**
 * The workspace has not said what its product is, so nothing may be connected
 * into it and nothing may be scanned. Carries the code the client acts on and
 * the status the routes answer with, so every entry point refuses identically.
 */
export class WorkspaceDescriptionRequiredError extends Error {
  readonly code = WORKSPACE_DESCRIPTION_REQUIRED;
  readonly statusCode = 409;
  constructor() {
    // Short enough to read as one line wherever it is shown, and it still
    // names the place, because a caller with no UI has only this sentence.
    super('This workspace has not said what its product is. Set it in Settings.');
    this.name = 'WorkspaceDescriptionRequiredError';
  }
}

/** Reaching the store before boot installed it is a bug — say so, don't invent. */
const NOT_INSTALLED = 'No workspace profile store installed (boot did not run installDbStores).';

class UninstalledWorkspaceProfileStore implements WorkspaceProfileStore {
  private fail(): never {
    throw new Error(NOT_INSTALLED);
  }
  get(): Promise<WorkspaceProfile | null> {
    this.fail();
  }
  save(): Promise<WorkspaceProfile> {
    this.fail();
  }
}

const unavailable = new UninstalledWorkspaceProfileStore();
let active: WorkspaceProfileStore = unavailable;

export function setWorkspaceProfileStore(store: WorkspaceProfileStore): void {
  active = store;
}

export function resetWorkspaceProfileStore(): void {
  active = unavailable;
}

export const readWorkspaceProfile = (workspaceOrgId: string): Promise<WorkspaceProfile | null> =>
  active.get(workspaceOrgId);

export const saveWorkspaceProfile = (
  workspaceOrgId: string,
  description: string,
): Promise<WorkspaceProfile> => active.save(workspaceOrgId, description);

/**
 * The workspace's one sentence, or {@link WorkspaceDescriptionRequiredError}.
 *
 * THE gate. Every entry point that brings material into a workspace calls it —
 * a documentation source, a connected repository, a connected folder — and so
 * does the scan, where the attribution actually happens. There is deliberately
 * no fallback: a scan with no subject is the failure this exists to prevent.
 */
export async function requireWorkspaceDescription(workspaceOrgId: string): Promise<string> {
  const profile = await active.get(workspaceOrgId);
  if (!profile?.description) throw new WorkspaceDescriptionRequiredError();
  return profile.description;
}
