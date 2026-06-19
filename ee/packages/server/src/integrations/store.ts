/**
 * Workspace-scoped integration connection store (Postgres). One row per
 * (workspaceOrgId, provider); connector-generic — the non-secret field values
 * live in `config` (jsonb), the single secret field is encrypted at rest.
 * Mirrors the encrypted-config pattern of `llm/store.ts` but ORG-SCOPED and with
 * NO process-singleton (the token is decrypted per-request, never global).
 */

import { and, eq, sql } from 'drizzle-orm';
import { integrationConnections, type EeDb } from '@truecourse/ee-db';
import { encryptSecret, decryptSecret, maskKey } from '../llm/crypto.js';

/** Masked, secret-free view for the UI. */
export interface IntegrationView {
  config: Record<string, string>;
  hasToken: boolean;
  tokenMask: string | null;
  updatedAt: string;
}

/** Full connection incl. the DECRYPTED token — for the connector at call time. */
export interface IntegrationConnection {
  config: Record<string, string>;
  token: string | undefined;
}

export interface SaveIntegrationInput {
  config: Record<string, string>;
  /** Omitted ⇒ keep the stored token. */
  token?: string;
}

export class IntegrationStore {
  constructor(
    private readonly db: EeDb,
    private readonly masterSecret: string,
  ) {}

  private async getRow(orgId: string, provider: string) {
    const rows = await this.db
      .select()
      .from(integrationConnections)
      .where(
        and(
          eq(integrationConnections.workspaceOrgId, orgId),
          eq(integrationConnections.provider, provider),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async getView(orgId: string, provider: string): Promise<IntegrationView | null> {
    const row = await this.getRow(orgId, provider);
    if (!row) return null;
    let tokenMask: string | null = null;
    if (row.tokenEnc) {
      // A rotated/mismatched master secret must never crash or leak — mask to '••••'.
      try {
        tokenMask = maskKey(decryptSecret(row.tokenEnc, this.masterSecret));
      } catch {
        tokenMask = '••••';
      }
    }
    return {
      config: (row.config as Record<string, string>) ?? {},
      hasToken: row.tokenEnc != null,
      tokenMask,
      updatedAt: row.updatedAt,
    };
  }

  /** The connection with its token DECRYPTED — call only when about to test/sync. */
  async getConnection(orgId: string, provider: string): Promise<IntegrationConnection | null> {
    const row = await this.getRow(orgId, provider);
    if (!row) return null;
    return {
      config: (row.config as Record<string, string>) ?? {},
      token: row.tokenEnc ? decryptSecret(row.tokenEnc, this.masterSecret) : undefined,
    };
  }

  async save(orgId: string, provider: string, input: SaveIntegrationInput): Promise<void> {
    const tokenEnc = input.token ? encryptSecret(input.token, this.masterSecret) : null;
    const now = new Date().toISOString();
    await this.db
      .insert(integrationConnections)
      .values({
        workspaceOrgId: orgId,
        provider,
        config: input.config,
        tokenEnc,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [integrationConnections.workspaceOrgId, integrationConnections.provider],
        set: {
          config: sql`excluded.config`,
          // Omitted token (null) keeps the stored one; a new token overwrites it.
          tokenEnc: sql`coalesce(excluded.token_enc, ${integrationConnections.tokenEnc})`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async delete(orgId: string, provider: string): Promise<void> {
    await this.db
      .delete(integrationConnections)
      .where(
        and(
          eq(integrationConnections.workspaceOrgId, orgId),
          eq(integrationConnections.provider, provider),
        ),
      );
  }
}
