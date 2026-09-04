/**
 * Installs the LLM transport the user selected in `~/.truecourse/config.json`.
 *
 * One injection point for the whole product: in `api` mode a direct-API
 * transport (`@truecourse/llm-api`) becomes the process-wide default, so all ~20
 * leaf runners reach the provider over its API. In `claude-code` mode the Agent
 * SDK one-shot transport (`@truecourse/llm-claude-agent`) is the default — the
 * same protocol the session driver runs, on the user's own `claude` login — so
 * no leaf runner spawns `claude -p` unless a run asks for that explicitly.
 *
 * Safe to call per pipeline entry: the config file's mtime is cached, so repeat
 * calls are one `stat`. A transport installed by someone else (the enterprise
 * edition installs its own from encrypted Postgres at boot) is never cleared —
 * only the one this module installed is.
 */

import { createApiTransport, type ProviderConfig } from '@truecourse/llm-api';
import { createClaudeAgentTransport } from '@truecourse/llm-claude-agent';
import { resolveClaudeBinary } from '@truecourse/shared';
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

export { getConfiguredLlmMode, effectiveLlmMode } from '../../config/global-config.js';

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
export function priceCall(
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
 * Build the API transport from an EXPLICIT provider block — the entry for a
 * caller that holds the credentials itself (the dashboard server threads its
 * workspace's stored config per run) rather than reading the user's file.
 * Throws `LlmApiConfigError` when the block is unusable.
 */
export function createApiTransportFor(
  api: GlobalApiLlmConfig | undefined,
  opts: { honorRequestModel?: boolean } = {},
): LlmTransport {
  const cfg = buildProviderConfig(api);
  primePriceTable();
  // Per-stage model overrides (`TRUECOURSE_MODEL_<STAGE>` / `llm.stages`) arrive
  // as `req.model`; honoring them is what keeps those overrides alive in API mode.
  // A caller whose config IS the whole selection (the dashboard's per-workspace
  // block) turns that off: the stage tiers it would otherwise inherit are Claude
  // CLI aliases, meaningless to a raw provider API.
  return createApiTransport(cfg, {
    pricing: priceCall,
    honorRequestModel: opts.honorRequestModel ?? true,
  });
}

/**
 * Build the API transport from the saved global config. Throws
 * `LlmApiConfigError` when the API block is missing or unusable — the CLI turns
 * that into a one-liner pointing at the setup command.
 */
export function createConfiguredApiTransport(): LlmTransport {
  return createApiTransportFor(readApiLlmConfig());
}

/** The one claude-code transport of this process — identity is how a caller
 *  tells "this spawns `claude`" from a transport that never does. */
let claudeCode: LlmTransport | undefined;

/**
 * The claude-code one-shot transport: the Agent SDK on the `claude` login of
 * whoever runs this process, resolving the binary per call. The CLI reaches it
 * through {@link installConfiguredLlmTransport}; the dashboard server reaches it
 * directly when the operator runs the instance on their own Claude Code.
 */
export function createClaudeCodeTransport(): LlmTransport {
  claudeCode ??= createClaudeAgentTransport({ pathToClaudeCodeExecutable: resolveClaudeBinary() });
  return claudeCode;
}

/** Whether `transport` is the claude-code one — the run will spawn `claude`. */
export function isClaudeCodeTransport(transport: LlmTransport | undefined): boolean {
  return transport !== undefined && transport === claudeCode;
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
 * `api` → the direct-API transport becomes the process default; `claude-code` →
 * the Agent SDK one-shot transport does. A transport someone else installed
 * (the enterprise edition, at boot) is never replaced.
 */
export function installConfiguredLlmTransport(): void {
  const key = configKey();
  if (key === installedFrom) return;
  const current = getDefaultTransport();
  if (current !== undefined && current !== installed) return;

  // Only a successful build marks the config as handled, so a caller that
  // retries after fixing an invalid config sees the error again, not a no-op.
  const transport =
    getConfiguredLlmMode() === 'api' ? createConfiguredApiTransport() : createClaudeCodeTransport();
  installed = transport;
  setDefaultTransport(transport);
  installedFrom = key;
}

/** Forget the cached config identity + installed transport (tests). */
export function resetConfiguredLlmTransport(): void {
  if (installed && getDefaultTransport() === installed) setDefaultTransport(undefined);
  installed = undefined;
  installedFrom = null;
  priceTable = null;
  claudeCode = undefined;
}
