/**
 * The instance-wide LLM provider config store (Postgres/Drizzle). Holds a
 * single row; the API key is encrypted at rest. Produces a decrypted
 * `ProviderConfig` for the transport and a masked, secret-free view for the API.
 */

import { eq, sql } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { ProviderConfig, LlmProviderKind } from '@truecourse/ee-llm';
import { llmProviderConfig } from '@truecourse/ee-db';
import { encryptSecret, decryptSecret, maskKey } from './crypto.js';

/** The single row's fixed id — config is instance-wide. */
const ROW_ID = 'default';

export type LlmDb = PgDatabase<any, any, any>;

/** Payload accepted from the settings API. `apiKey` omitted = keep existing. */
export interface LlmConfigInput {
  provider: LlmProviderKind;
  model: string;
  fallbackModel?: string;
  /** API key (anthropic/openai/copilot) or the Bedrock secret access key. */
  apiKey?: string;
  /** Bedrock access key id. */
  accessKeyId?: string;
  baseURL?: string;
  region?: string;
  headers?: Record<string, string>;
}

/** Masked, secret-free view returned to the browser. */
export interface LlmConfigView {
  provider: LlmProviderKind;
  model: string;
  fallbackModel: string | null;
  baseURL: string | null;
  region: string | null;
  accessKeyId: string | null;
  hasKey: boolean;
  keyMask: string | null;
  updatedAt: string;
}

export class LlmConfigStore {
  constructor(
    private readonly db: LlmDb,
    private readonly masterSecret: string,
    private readonly onClose?: () => Promise<void>,
  ) {}

  private async getRow() {
    const rows = await this.db
      .select()
      .from(llmProviderConfig)
      .where(eq(llmProviderConfig.id, ROW_ID))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Masked view for the settings page — never exposes a key. */
  async getView(): Promise<LlmConfigView | null> {
    const row = await this.getRow();
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

  /** Decrypted config for building the transport, or null when unconfigured. */
  async getProviderConfig(): Promise<ProviderConfig | null> {
    const row = await this.getRow();
    if (!row) return null;
    const secret = row.apiKeyEnc
      ? decryptSecret(row.apiKeyEnc, this.masterSecret)
      : undefined;
    const provider = row.provider as LlmProviderKind;
    const cfg: ProviderConfig = {
      provider,
      model: row.model,
      fallbackModel: row.fallbackModel ?? undefined,
      baseURL: row.baseUrl ?? undefined,
      headers: row.headers ?? undefined,
    };
    if (provider === 'bedrock') {
      cfg.region = row.region ?? undefined;
      cfg.accessKeyId = row.accessKeyId ?? undefined;
      cfg.secretAccessKey = secret;
    } else {
      cfg.apiKey = secret;
    }
    return cfg;
  }

  /** Upsert the config. Omitting `apiKey` preserves the stored (encrypted) key. */
  async save(input: LlmConfigInput): Promise<void> {
    const apiKeyEnc = input.apiKey
      ? encryptSecret(input.apiKey, this.masterSecret)
      : null;
    const now = new Date().toISOString();
    await this.db
      .insert(llmProviderConfig)
      .values({
        id: ROW_ID,
        provider: input.provider,
        model: input.model,
        fallbackModel: input.fallbackModel ?? null,
        apiKeyEnc,
        accessKeyId: input.accessKeyId ?? null,
        baseUrl: input.baseURL ?? null,
        region: input.region ?? null,
        headers: input.headers ?? null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: llmProviderConfig.id,
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

  async close(): Promise<void> {
    await this.onClose?.();
  }
}
