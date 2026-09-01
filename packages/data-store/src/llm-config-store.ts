/**
 * The workspace's LLM provider config (Postgres/Drizzle) — one row per WorkOS
 * organization, the API key encrypted at rest. Two reads, deliberately
 * separate: a decrypted block the pipeline builds its transport/driver from,
 * and a masked, secret-free view for the settings page.
 *
 * There is no process-wide provider here. A run reaches the model with the
 * credentials of the workspace that asked for it, which is why every read is
 * keyed by `orgId`.
 */

import { eq, sql } from 'drizzle-orm';
import { llmProviderConfig, type Db } from '@truecourse/db';
import type { LlmConfigUpdate, LlmProviderConfigView, LlmProviderKind } from '@truecourse/shared';
import type { GlobalApiLlmConfig } from '@truecourse/core/config/global-config';
import { decryptSecret, encryptSecret, maskKey } from './crypto.js';

export class PgLlmConfigStore {
  constructor(
    private readonly db: Db,
    private readonly masterSecret: string,
  ) {}

  private async getRow(orgId: string) {
    const rows = await this.db
      .select()
      .from(llmProviderConfig)
      .where(eq(llmProviderConfig.orgId, orgId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Masked view for the settings page — never exposes a key. */
  async getView(orgId: string): Promise<LlmProviderConfigView | null> {
    const row = await this.getRow(orgId);
    if (!row) return null;
    let keyMask: string | null = null;
    if (row.apiKeyEnc) {
      try {
        keyMask = maskKey(decryptSecret(row.apiKeyEnc, this.masterSecret));
      } catch {
        keyMask = '••••'; // master secret rotated / mismatch — don't leak, don't crash
      }
    }
    return {
      provider: row.provider as LlmProviderKind,
      model: row.model,
      fallbackModel: row.fallbackModel,
      baseURL: row.baseUrl,
      region: row.region,
      accessKeyId: row.accessKeyId,
      hasKey: row.apiKeyEnc != null,
      keyMask,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * The decrypted API block a run builds its transport/session driver from, or
   * null when this workspace has configured no provider. Never handed to a
   * browser — it carries the key in clear.
   */
  async getConfig(orgId: string): Promise<GlobalApiLlmConfig | null> {
    const row = await this.getRow(orgId);
    if (!row) return null;
    const secret = row.apiKeyEnc ? decryptSecret(row.apiKeyEnc, this.masterSecret) : undefined;
    const provider = row.provider as LlmProviderKind;
    const config: GlobalApiLlmConfig = {
      provider,
      model: row.model,
      ...(row.fallbackModel ? { fallbackModel: row.fallbackModel } : {}),
      ...(row.baseUrl ? { baseURL: row.baseUrl } : {}),
      ...(row.headers ? { headers: row.headers } : {}),
    };
    if (provider === 'bedrock') {
      if (row.region) config.region = row.region;
      if (row.accessKeyId) config.accessKeyId = row.accessKeyId;
      if (secret) config.secretAccessKey = secret;
    } else if (secret) {
      config.apiKey = secret;
    }
    return config;
  }

  /** Upsert the workspace's config. Omitting `apiKey` preserves the stored key. */
  async save(orgId: string, input: LlmConfigUpdate): Promise<void> {
    const apiKeyEnc = input.apiKey ? encryptSecret(input.apiKey, this.masterSecret) : null;
    await this.db
      .insert(llmProviderConfig)
      .values({
        orgId,
        provider: input.provider,
        model: input.model,
        fallbackModel: input.fallbackModel ?? null,
        apiKeyEnc,
        accessKeyId: input.accessKeyId ?? null,
        baseUrl: input.baseURL ?? null,
        region: input.region ?? null,
        headers: input.headers ?? null,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: llmProviderConfig.orgId,
        set: {
          provider: sql`excluded.provider`,
          model: sql`excluded.model`,
          fallbackModel: sql`excluded.fallback_model`,
          // Keep the existing key when the update omits it — but ONLY for the
          // same provider. A provider switch must never inherit the previous
          // provider's secret; an omitted key there clears it.
          apiKeyEnc: sql`case when ${llmProviderConfig.provider} = excluded.provider then coalesce(excluded.api_key_enc, ${llmProviderConfig.apiKeyEnc}) else excluded.api_key_enc end`,
          accessKeyId: sql`excluded.access_key_id`,
          baseUrl: sql`excluded.base_url`,
          region: sql`excluded.region`,
          headers: sql`excluded.headers`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}
