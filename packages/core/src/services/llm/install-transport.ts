/**
 * Installs the LLM transport the user selected in `~/.truecourse/config.json`.
 *
 * One injection point for the whole product: in `api` mode a direct-API
 * transport (`@truecourse/llm-api`) becomes the process-wide default, so all ~20
 * leaf runners reach the provider instead of spawning `claude`. In `claude-code`
 * mode nothing is installed and behavior is exactly what it has always been —
 * each runner falls back to its own `cliTransport()`.
 *
 * Safe to call per pipeline entry: the config file's mtime is cached, so repeat
 * calls are one `stat`. A transport installed by someone else (the enterprise
 * edition installs its own from encrypted Postgres at boot) is never cleared —
 * only the one this module installed is.
 */

import { createApiTransport, type ProviderConfig } from '@truecourse/llm-api';
import {
  getDefaultTransport,
  setDefaultTransport,
  type LlmTransport,
} from '@truecourse/shared/llm';
import { LLM_PROVIDER_KINDS, type LlmProviderKind } from '@truecourse/shared';
import {
  getConfiguredLlmMode,
  globalConfigMtimeMs,
  readApiLlmConfig,
  type GlobalApiLlmConfig,
} from '../../config/global-config.js';
import { getGlobalConfigPath } from '../../config/paths.js';
import { getModelPrices, priceForModel, type PriceTable } from './model-prices.js';

export { getConfiguredLlmMode } from '../../config/global-config.js';

const SETUP_HINT = 'Run `truecourse config llm setup` to configure it.';

/** The API transport is selected but its configuration can't be used. */
export class LlmApiConfigError extends Error {
  constructor(problem: string) {
    super(`${problem} ${SETUP_HINT}`);
    this.name = 'LlmApiConfigError';
  }
}

/** Standard env var holding each provider's key (bedrock uses the AWS chain). */
const PROVIDER_KEY_ENV: Record<LlmProviderKind, string | null> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  copilot: 'COPILOT_API_KEY',
  bedrock: null,
};

/**
 * The env var TrueCourse reads this provider's key from when none is stored and
 * none is named. Null for bedrock — it uses the ambient AWS credential chain.
 */
export function providerKeyEnvVar(provider: LlmProviderKind): string | null {
  return PROVIDER_KEY_ENV[provider] ?? null;
}

/**
 * The API key for a saved config: the stored key, else the env var the user
 * named, else the provider's standard env var. Bedrock has none — it uses the
 * ambient AWS credential chain.
 */
export function resolveApiKey(api: GlobalApiLlmConfig): string | undefined {
  const stored = api.apiKey?.trim();
  if (stored) return stored;
  const named = api.apiKeyEnv?.trim();
  if (named) {
    const fromNamed = process.env[named]?.trim();
    if (fromNamed) return fromNamed;
    return undefined;
  }
  const standard = PROVIDER_KEY_ENV[api.provider];
  return standard ? process.env[standard]?.trim() || undefined : undefined;
}

function describeKeySources(api: GlobalApiLlmConfig): string {
  const named = api.apiKeyEnv?.trim();
  if (named) return `\`${named}\` is unset`;
  const standard = PROVIDER_KEY_ENV[api.provider];
  return standard ? `no key is stored and \`${standard}\` is unset` : 'no key is stored';
}

/** Validate the saved API block and turn it into a provider config. */
export function buildProviderConfig(api: GlobalApiLlmConfig | undefined): ProviderConfig {
  if (!api) throw new LlmApiConfigError('The API transport is selected but not configured.');
  if (!LLM_PROVIDER_KINDS.includes(api.provider)) {
    throw new LlmApiConfigError(
      `Unknown LLM provider \`${String(api.provider)}\` (expected one of ${LLM_PROVIDER_KINDS.join(', ')}).`,
    );
  }
  const model = api.model?.trim();
  if (!model) throw new LlmApiConfigError('The API transport needs a model.');

  const cfg: ProviderConfig = {
    provider: api.provider,
    model,
    fallbackModel: api.fallbackModel?.trim() || undefined,
    baseURL: api.baseURL?.trim() || undefined,
    headers: api.headers,
  };
  if (api.provider === 'bedrock') {
    // Any omitted credential falls through to the ambient AWS chain.
    cfg.region = api.region?.trim() || undefined;
    cfg.accessKeyId = api.accessKeyId?.trim() || undefined;
    cfg.secretAccessKey = api.secretAccessKey?.trim() || undefined;
    cfg.sessionToken = api.sessionToken?.trim() || undefined;
    return cfg;
  }
  const apiKey = resolveApiKey(api);
  if (!apiKey) {
    throw new LlmApiConfigError(
      `No API key for provider \`${api.provider}\` — ${describeKeySources(api)}.`,
    );
  }
  cfg.apiKey = apiKey;
  return cfg;
}

// ---------------------------------------------------------------------------
// Cost accounting
// ---------------------------------------------------------------------------

// The price table is fetched once, off the hot path: the pricing hook is
// synchronous (it runs inside the transport's per-call accounting), so it prices
// with whatever table has resolved and charges 0 until then. Cost is
// observational — it must never delay or fail a call.
let priceTable: PriceTable | null = null;
let priceTablePending = false;

function primePriceTable(): void {
  if (priceTable || priceTablePending) return;
  priceTablePending = true;
  void getModelPrices()
    .then((t) => {
      priceTable = t;
    })
    .catch(() => {
      /* unpriceable run — tokens are still recorded */
    })
    .finally(() => {
      priceTablePending = false;
    });
}

/**
 * Ceiling cost for one call: every input-side token (fresh, cache-read,
 * cache-written) is charged at the list input rate — providers only ever
 * discount those, so the real bill lands at or below this.
 */
function priceCall(
  modelId: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreateTokens: number },
): number {
  try {
    primePriceTable();
    if (!priceTable) return 0;
    const price = priceForModel(modelId, priceTable);
    if (!price) return 0;
    const input = usage.inputTokens + usage.cacheReadTokens + usage.cacheCreateTokens;
    return input * price.input + usage.outputTokens * price.output;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

/**
 * Build the API transport from the saved global config. Throws
 * `LlmApiConfigError` when the API block is missing or unusable — the CLI turns
 * that into a one-liner pointing at the setup command.
 */
export function createConfiguredApiTransport(): LlmTransport {
  const cfg = buildProviderConfig(readApiLlmConfig());
  primePriceTable();
  // Per-stage model overrides (`TRUECOURSE_MODEL_<STAGE>` / `llm.stages`) arrive
  // as `req.model`; honoring them is what keeps those overrides alive in API mode.
  return createApiTransport(cfg, { pricing: priceCall, honorRequestModel: true });
}

/** The transport this module installed, so it never clears anyone else's. */
let installed: LlmTransport | undefined;
/** Config identity (path + mtime + env override) the current install came from. */
let installedFrom: string | null = null;

function configKey(): string {
  return `${getGlobalConfigPath()}|${globalConfigMtimeMs() ?? 0}|${process.env.TRUECOURSE_LLM_TRANSPORT ?? ''}`;
}

/**
 * Install the configured transport if the config changed since the last call.
 * `api` → the direct-API transport becomes the process default; anything else →
 * no default transport (today's Claude Code behavior).
 */
export function installConfiguredLlmTransport(): void {
  const key = configKey();
  if (key === installedFrom) return;

  if (getConfiguredLlmMode() !== 'api') {
    // Drop only OUR transport — an enterprise-installed one stays.
    if (installed && getDefaultTransport() === installed) setDefaultTransport(undefined);
    installed = undefined;
    installedFrom = key;
    return;
  }
  // Only a successful build marks the config as handled, so a caller that
  // retries after fixing an invalid config sees the error again, not a no-op.
  const transport = createConfiguredApiTransport();
  installed = transport;
  setDefaultTransport(transport);
  installedFrom = key;
}

/** Forget the cached config identity + installed transport (tests). */
export function resetConfiguredLlmTransport(): void {
  installed = undefined;
  installedFrom = null;
  priceTable = null;
}
