/**
 * Workspace-scoped integration connections (hosted edition). One row per
 * (workspace_org_id, provider) — a connected knowledge source (Confluence/Jira/…)
 * for a WorkOS organization.
 *
 * Connector-generic: `config` holds the non-secret field values as jsonb (so a
 * new connector needs no new columns), and the single secret field is encrypted
 * at rest (`token_enc`, see ee-server's llm/crypto.ts).
 */

import { pgTable, text, jsonb, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/**
 * The processing cost estimate the sweep captured — structurally the OSS
 * `LlmEstimate` (the shape the Process confirm dialog renders), so the dialog
 * opens instantly from the stored record without re-sweeping. Mirrors
 * `IntegrationPendingEstimate` in @truecourse/shared (ee-db has no shared dep).
 */
export interface IntegrationPendingEstimate {
  totalEstimatedTokens: number;
  tiers: Array<{ tier: string; ruleCount: number; fileCount: number; functionCount?: number; estimatedTokens: number }>;
  /** Per-stage breakdown; absent/empty ⇒ no LLM work (Process skips the modal). */
  stages?: Array<{
    stage: string;
    label?: string;
    model: string;
    calls: number;
    estimatedTokens: number;
    callsRange?: { low: number; high: number };
    estimatedCostUsd?: number;
  }>;
  /** Short confirm copy, e.g. "3 new · 2 changed of 40 docs". */
  subjectLabel?: string;
  /** Ceiling USD for the whole run; absent when no price table was available. */
  estimatedCostUsd?: number;
  costSource?: 'live' | 'cache' | 'bundled';
  /** True when some processing stages are unpriced (cost is "at least"). */
  costPartial?: boolean;
}

/**
 * Synced-but-unprocessed work the last sweep found for a connection, awaiting
 * Process. Delta metadata + the full estimate only — never the source bodies
 * (Process re-fetches internally). Mirrors `IntegrationPendingView` in
 * @truecourse/shared.
 */
export interface IntegrationPending {
  /** Doc delta vs the provenance ledger, counted by content hash. */
  delta: { new: number; changed: number; removed: number; total: number };
  /** The full estimate captured at sweep time — the Process confirm dialog. */
  estimate: IntegrationPendingEstimate;
  /** When the sweep ran (ISO). Advisory — Process works on current source truth. */
  sweptAt: string;
}

export const integrationConnections = pgTable(
  'integration_connections',
  {
    workspaceOrgId: text('workspace_org_id').notNull(),
    /** Connector kind: 'confluence' | 'jira' | … (matches knowledge_documents.source_kind). */
    provider: text('provider').notNull(),
    /** Non-secret field values (e.g. baseUrl/spaceKey/accountEmail) — connector-defined. */
    config: jsonb('config').$type<Record<string, string>>().notNull(),
    /** AES-256-GCM blob of the connector's secret field; null until set. */
    tokenEnc: text('token_enc'),
    /** Unprocessed sweep result awaiting Process; null when up to date. Delta +
     *  estimate only (never bodies). */
    pending: jsonb('pending').$type<IntegrationPending>(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceOrgId, t.provider] }),
    index('integration_connections_org_idx').on(t.workspaceOrgId),
  ],
);
