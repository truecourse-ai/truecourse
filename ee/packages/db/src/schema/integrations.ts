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
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceOrgId, t.provider] }),
    index('integration_connections_org_idx').on(t.workspaceOrgId),
  ],
);
