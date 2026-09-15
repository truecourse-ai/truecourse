/**
 * Workspace-scoped integration connections. One row per (workspace_org_id,
 * provider) — a connected documentation source for a workspace.
 *
 * The connectors themselves are not rebuilt yet; the rows are kept so a rebuilt
 * connector finds the connection its workspace already made. Connector-generic:
 * `config` holds the non-secret field values as jsonb (so a new connector needs
 * no new columns), and the single secret field is encrypted at rest
 * (`token_enc`, AES-256-GCM under `TRUECOURSE_SECRET_KEY` — see
 * `@truecourse/data-store`'s `crypto.ts`).
 */

import { pgTable, text, jsonb, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/**
 * The processing cost estimate a sweep captured — structurally core's
 * `LlmEstimate`, so a confirm dialog could open from the stored record without
 * re-sweeping. Declared here because @truecourse/db is a dependency-free leaf.
 */
export interface IntegrationPendingEstimate {
  totalEstimatedTokens: number;
  tiers: Array<{ tier: string; ruleCount: number; fileCount: number; functionCount?: number; estimatedTokens: number }>;
  /** Per-stage breakdown; absent/empty ⇒ no LLM work to confirm. */
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
 * Synced-but-unprocessed work a sweep found for a connection: delta metadata
 * and the estimate only, never the source bodies. Nothing sweeps today, and a
 * migration cleared every stored value, so this is a cache shape waiting on the
 * rebuilt connectors.
 */
export interface IntegrationPending {
  /** Doc delta vs what was last consolidated, counted by content hash —
   *  new/changed/removed unprocessed work. */
  delta: { new: number; changed: number; removed: number; total: number };
  /** The full estimate captured at sweep time. */
  estimate: IntegrationPendingEstimate;
  /** When the sweep ran (ISO). Advisory — processing works on current source truth. */
  sweptAt: string;
}

export const integrationConnections = pgTable(
  'integration_connections',
  {
    workspaceOrgId: text('workspace_org_id').notNull(),
    /** Connector kind, as the connector that wrote the row named itself. */
    provider: text('provider').notNull(),
    /** Non-secret field values (e.g. baseUrl/spaceKey/accountEmail) — connector-defined. */
    config: jsonb('config').$type<Record<string, string>>().notNull(),
    /** AES-256-GCM blob of the connector's secret field; null until set. */
    tokenEnc: text('token_enc'),
    /** The last sweep's unprocessed delta + estimate; null today, since nothing
     *  sweeps and a migration cleared what was stored. */
    pending: jsonb('pending').$type<IntegrationPending>(),
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceOrgId, t.provider] }),
    index('integration_connections_org_idx').on(t.workspaceOrgId),
  ],
);
