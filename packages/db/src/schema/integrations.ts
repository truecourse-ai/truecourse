/**
 * Workspace-scoped tool connections. One row per (workspace_org_id, provider):
 * the account a workspace reads a tool (Jira, Confluence) with, made once in
 * Settings › Connections. What that account READS is a context source, not a
 * column here.
 *
 * Connector-generic: `config` holds the non-secret field values as jsonb (so a
 * new connector needs no new columns), and the single secret field is
 * encrypted at rest (`token_enc`, AES-256-GCM under `TRUECOURSE_SECRET_KEY`,
 * see `@truecourse/data-store`'s `crypto.ts`).
 *
 * The table is created by the init migration and created again, if missing,
 * by `0031_integration_connections`: a database that ran the migration-era
 * draft of `0021` dropped it, and a migration is recorded by its timestamp,
 * not its text, so nothing else would bring it back.
 */

import { pgTable, text, jsonb, timestamp, primaryKey, index } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

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
    createdAt: ts('created_at').notNull(),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceOrgId, t.provider] }),
    index('integration_connections_org_idx').on(t.workspaceOrgId),
  ],
);
