/**
 * The LLM provider config, one row per workspace (`org_id` is the WorkOS
 * organization). The API key is stored encrypted — see the data-store's
 * `crypto.ts`.
 */

import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

export const llmProviderConfig = pgTable('llm_provider_config', {
  orgId: text('org_id').primaryKey(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  fallbackModel: text('fallback_model'),
  /** Encrypted secret: API key (anthropic/openai/copilot) or Bedrock secret access key. */
  apiKeyEnc: text('api_key_enc'),
  /** Bedrock access key id — an identifier, not the secret. */
  accessKeyId: text('access_key_id'),
  baseUrl: text('base_url'),
  region: text('region'),
  headers: jsonb('headers').$type<Record<string, string>>(),
  updatedAt: ts('updated_at').notNull(),
});
