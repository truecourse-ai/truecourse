/**
 * The hosted half of core's `WorkspaceProfileStore`: what a workspace says its
 * product is, one row per workspace in `workspace_profiles`.
 *
 * A row exists only once the workspace has said it, so "no row" and "not yet
 * described" are the same fact and the gate reads one thing.
 */

import { eq } from 'drizzle-orm';
import { workspaceProfiles, type Db } from '@truecourse/db';
import type {
  WorkspaceProfile,
  WorkspaceProfileStore,
} from '@truecourse/core/lib/workspace-profile-store';
import { iso } from './iso.js';

type Row = typeof workspaceProfiles.$inferSelect;

function toProfile(row: Row): WorkspaceProfile {
  return {
    workspaceOrgId: row.workspaceOrgId,
    description: row.description,
    updatedAt: iso(row.updatedAt),
  };
}

export class PgWorkspaceProfileStore implements WorkspaceProfileStore {
  constructor(private readonly db: Db) {}

  async get(workspaceOrgId: string): Promise<WorkspaceProfile | null> {
    const rows = await this.db
      .select()
      .from(workspaceProfiles)
      .where(eq(workspaceProfiles.workspaceOrgId, workspaceOrgId))
      .limit(1);
    return rows[0] ? toProfile(rows[0]) : null;
  }

  async save(workspaceOrgId: string, description: string): Promise<WorkspaceProfile> {
    const updatedAt = new Date().toISOString();
    const [row] = await this.db
      .insert(workspaceProfiles)
      .values({ workspaceOrgId, description, updatedAt })
      .onConflictDoUpdate({
        target: [workspaceProfiles.workspaceOrgId],
        set: { description, updatedAt },
      })
      .returning();
    return toProfile(row!);
  }
}
