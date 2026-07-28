/**
 * Global (per-user) config — `~/.truecourse/config.json`, relocatable with
 * `TRUECOURSE_HOME`. It holds the LLM transport selection (Claude Code vs the
 * direct API) and, in API mode, the provider credentials.
 *
 * It lives here rather than in the per-repo `.truecourse/config.json` because
 * that file is committable by convention — API keys must never sit next to it —
 * and because the transport choice is per-user (like the Claude Code login it
 * replaces), not per-project. The per-repo file keeps what it already has:
 * `llm.stages` / `llm.fallbackModel`.
 *
 * The file is written `0600` inside a `0700` directory, and a malformed file is
 * treated as empty (with one warning) so a hand-edit typo degrades to defaults
 * instead of breaking every command.
 */

import fs from 'node:fs';
import type { LlmProviderKind } from '@truecourse/shared';
import { getGlobalConfigPath, getGlobalDir } from './paths.js';

/** How TrueCourse reaches the model: the `claude` binary, or a provider API. */
export type LlmTransportMode = 'claude-code' | 'api';

/** Provider credentials + model for `transport: "api"`. */
export interface GlobalApiLlmConfig {
  provider: LlmProviderKind;
  /** Provider-specific model id — required in API mode, used by every stage. */
  model: string;
  /** Optional secondary model, tried once if the primary call errors. */
  fallbackModel?: string;
  /** API key stored in this file. Omit to resolve it from the environment. */
  apiKey?: string;
  /** NAME of an env var holding the key (resolved per run, nothing stored). */
  apiKeyEnv?: string;
  /** Gateway / self-hosted endpoint speaking the provider's protocol. */
  baseURL?: string;
  headers?: Record<string, string>;
  // --- AWS Bedrock (omit to use the ambient AWS credential chain) ---
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

export interface GlobalLlmConfig {
  /** Saved selection. Absent = never chosen. */
  transport?: LlmTransportMode;
  /** Persisted independently of `transport`, so flipping back never re-asks. */
  api?: GlobalApiLlmConfig;
}

export interface GlobalConfig {
  llm?: GlobalLlmConfig;
}

const EMPTY: GlobalConfig = {};

/** Env override of the saved selection, for a single run or CI. */
const TRANSPORT_ENV = 'TRUECOURSE_LLM_TRANSPORT';

// One warning per malformed path — resolution runs per stage, so warning on
// every read would bury the message it's trying to deliver.
const warnedMalformed = new Set<string>();

function warnMalformed(file: string, err: unknown): void {
  if (warnedMalformed.has(file)) return;
  warnedMalformed.add(file);
  process.stderr.write(
    `[truecourse] ignoring malformed global config ${file}: ${(err as Error).message}\n`,
  );
}

/** Read `~/.truecourse/config.json`; missing or malformed → `{}`. */
export function readGlobalConfig(): GlobalConfig {
  const file = getGlobalConfigPath();
  if (!fs.existsSync(file)) return { ...EMPTY };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected a JSON object');
    }
    return parsed as GlobalConfig;
  } catch (err) {
    warnMalformed(file, err);
    return { ...EMPTY };
  }
}

/** Write the whole global config, `0600` in a `0700` dir. */
export function writeGlobalConfig(config: GlobalConfig): void {
  const dir = getGlobalDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = getGlobalConfigPath();
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  // `mode` only applies when writeFileSync creates the file, so re-assert it on
  // rewrite: a config that was once world-readable must not stay that way.
  fs.chmodSync(file, 0o600);
}

/** Read-modify-write a patch over the current config. Returns the merged result. */
export function updateGlobalConfig(patch: Partial<GlobalConfig>): GlobalConfig {
  const next = { ...readGlobalConfig(), ...patch };
  writeGlobalConfig(next);
  return next;
}

/** Modification time of the config file in ms, or null when absent. */
export function globalConfigMtimeMs(): number | null {
  try {
    return fs.statSync(getGlobalConfigPath()).mtimeMs;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mode + model lookup
// ---------------------------------------------------------------------------

function normalizeMode(value: string | undefined): LlmTransportMode | null {
  const v = value?.trim();
  return v === 'api' || v === 'claude-code' ? v : null;
}

/**
 * The effective transport mode: `TRUECOURSE_LLM_TRANSPORT` overrides the saved
 * selection, and an unsaved selection means Claude Code (today's behavior).
 */
export function getConfiguredLlmMode(): LlmTransportMode {
  const env = normalizeMode(process.env[TRANSPORT_ENV]);
  if (env) return env;
  return normalizeMode(readGlobalConfig().llm?.transport) ?? 'claude-code';
}

/** The saved API block, whatever the active mode. */
export function readApiLlmConfig(): GlobalApiLlmConfig | undefined {
  return readGlobalConfig().llm?.api;
}

/**
 * The model every stage runs on in API mode, or null when API mode is off /
 * unconfigured. Tier aliases (`opus`/`sonnet`/`haiku`) are Claude CLI concepts
 * and meaningless to a raw API, so in API mode this replaces them — explicit
 * per-stage overrides still win (see `resolveModel`).
 */
export function apiModeModel(): string | null {
  if (getConfiguredLlmMode() !== 'api') return null;
  return readApiLlmConfig()?.model?.trim() || null;
}

/** The fallback model for API mode, or null when API mode is off / unset. */
export function apiModeFallbackModel(): string | null {
  if (getConfiguredLlmMode() !== 'api') return null;
  return readApiLlmConfig()?.fallbackModel?.trim() || null;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Last 4 chars of a secret, for display. Never returns more. */
export function maskSecret(secret: string): string {
  const tail = secret.slice(-4);
  return tail.length === 4 ? `••••${tail}` : '••••';
}

/**
 * A copy of the config with every secret masked. Any surface that prints or
 * serializes the config goes through this, so a new secret field is masked by
 * construction rather than by each caller remembering to.
 */
export function redactGlobalConfig(config: GlobalConfig): GlobalConfig {
  const api = config.llm?.api;
  if (!api) return config.llm ? { ...config, llm: { ...config.llm } } : { ...config };
  const redactedApi: GlobalApiLlmConfig = { ...api };
  for (const field of ['apiKey', 'secretAccessKey', 'sessionToken'] as const) {
    const value = redactedApi[field];
    if (value) redactedApi[field] = maskSecret(value);
  }
  return { ...config, llm: { ...config.llm, api: redactedApi } };
}
