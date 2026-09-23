/**
 * The workspace PROFILE store, in memory: what a workspace says its product is.
 *
 * Nothing else in the product can be reached without it — every connect route
 * and the Document scan refuse a workspace that has not said — so a suite that
 * exercises any of those installs this and describes the workspaces it uses.
 *
 * The seam is set through BOTH specifiers a test can reach core by — the
 * package (`@truecourse/core/lib/workspace-profile-store`, which resolves to
 * the built `dist`) and the source path — because under vitest those are
 * separate module instances with separate seam state.
 */

import type {
  WorkspaceProfile,
  WorkspaceProfileStore,
} from '@truecourse/core/lib/workspace-profile-store';
import {
  setWorkspaceProfileStore as setByPackage,
  resetWorkspaceProfileStore as resetByPackage,
} from '@truecourse/core/lib/workspace-profile-store';
import {
  setWorkspaceProfileStore as setBySource,
  resetWorkspaceProfileStore as resetBySource,
} from '../../packages/core/src/lib/workspace-profile-store';

/** The sentence the helpers describe a workspace with when none is given. */
export const TEST_WORKSPACE_DESCRIPTION =
  'Acme Widgets, a warehouse inventory service with a REST API and an operator console.';

export interface MemoryWorkspaceProfiles extends WorkspaceProfileStore {
  /** Every profile held, for a test that asserts on what a route stored. */
  all(): WorkspaceProfile[];
}

export function memoryWorkspaceProfiles(): MemoryWorkspaceProfiles {
  const rows = new Map<string, WorkspaceProfile>();
  return {
    async get(workspaceOrgId) {
      return rows.get(workspaceOrgId) ?? null;
    },
    async save(workspaceOrgId, description) {
      const profile: WorkspaceProfile = {
        workspaceOrgId,
        description,
        updatedAt: new Date().toISOString(),
      };
      rows.set(workspaceOrgId, profile);
      return profile;
    },
    all: () => [...rows.values()],
  };
}

/**
 * Install the seam and describe the given workspaces. A suite that wants an
 * UNdescribed workspace installs with none and the gate refuses, which is the
 * thing most of these tests are pinning.
 */
export function installWorkspaceProfiles(
  described: readonly string[] = [],
  description: string = TEST_WORKSPACE_DESCRIPTION,
): MemoryWorkspaceProfiles {
  const store = memoryWorkspaceProfiles();
  for (const org of described) void store.save(org, description);
  setByPackage(store);
  setBySource(store);
  return store;
}

/**
 * Give EVERY workspace a description, so a route test that is not ABOUT the
 * description reaches the work it came for. Tests that ARE about it install
 * their own — `installWorkspaceProfiles([])` is an undescribed workspace, which
 * is what every connect route and the scan refuse.
 */
export function installDescribedWorkspaces(
  description: string = TEST_WORKSPACE_DESCRIPTION,
): void {
  const store: WorkspaceProfileStore = {
    async get(workspaceOrgId) {
      return { workspaceOrgId, description, updatedAt: '2026-01-01T00:00:00.000Z' };
    },
    async save(workspaceOrgId, next) {
      return { workspaceOrgId, description: next, updatedAt: new Date().toISOString() };
    },
  };
  setByPackage(store);
  setBySource(store);
}

export function resetWorkspaceProfiles(): void {
  resetByPackage();
  resetBySource();
}
