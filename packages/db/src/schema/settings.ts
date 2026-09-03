/**
 * Per-workspace (WorkOS org) feature settings. One row per workspace; absence
 * means "all defaults". Kept separate from the github-gate's `repo_config` since
 * these are workspace-wide, not per-repo.
 */

import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const workspaceSettings = pgTable('workspace_settings', {
  workspaceOrgId: text('workspace_org_id').primaryKey(),
  /**
   * Run the LLM (semantic) code-analysis rules in Code Quality, on top of the
   * always-on deterministic rules. OFF by default — LLM rules add latency + cost,
   * so a workspace opts in.
   */
  codeAnalysisLlm: boolean('code_analysis_llm').notNull().default(false),
  updatedAt: ts('updated_at').notNull(),
});
