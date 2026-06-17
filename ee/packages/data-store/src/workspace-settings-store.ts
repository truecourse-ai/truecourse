/**
 * Per-workspace feature settings (the `workspace_settings` row). EE-internal —
 * read by the analyze entry points (baseline + PR gate) and the workspace
 * settings route. Absence of a row means defaults, so reads never need a row to
 * exist first.
 */

import { eq } from 'drizzle-orm';
import { workspaceSettings, type EeDb } from '@truecourse/ee-db';

export interface WorkspaceSettings {
  /** Run the LLM (semantic) code-analysis rules. Off by default. */
  codeAnalysisLlm: boolean;
}

const DEFAULTS: WorkspaceSettings = { codeAnalysisLlm: false };

export class WorkspaceSettingsStore {
  constructor(private readonly db: EeDb) {}

  /** Full settings for a workspace, falling back to defaults when no row exists. */
  async get(orgId: string): Promise<WorkspaceSettings> {
    const [row] = await this.db
      .select({ codeAnalysisLlm: workspaceSettings.codeAnalysisLlm })
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceOrgId, orgId))
      .limit(1);
    return { codeAnalysisLlm: row?.codeAnalysisLlm ?? DEFAULTS.codeAnalysisLlm };
  }

  /** Whether LLM code-analysis rules are enabled for a workspace (default false). */
  async codeAnalysisLlm(orgId: string): Promise<boolean> {
    return (await this.get(orgId)).codeAnalysisLlm;
  }

  async setCodeAnalysisLlm(orgId: string, enabled: boolean): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(workspaceSettings)
      .values({ workspaceOrgId: orgId, codeAnalysisLlm: enabled, updatedAt: now })
      .onConflictDoUpdate({
        target: workspaceSettings.workspaceOrgId,
        set: { codeAnalysisLlm: enabled, updatedAt: now },
      });
  }
}
