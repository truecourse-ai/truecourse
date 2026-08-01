/**
 * `truecourse config llm setup` — how TrueCourse reaches the model: the
 * `claude` binary you are already logged into, or a provider API with your own
 * key. The selection (and, in API mode, the credentials) live in the per-user
 * `~/.truecourse/config.json`, never in the committable per-repo config.
 *
 * The same body runs in two situations:
 *   - the first-run wizard (`runLlmFirstRun`), fired before the very first
 *     command a user ever runs, and
 *   - the reconfigure command, run any time.
 *
 * Non-interactive callers (CI, dotfiles) drive it entirely with flags; a
 * configuration is never saved before its live probe succeeds, unless
 * `--no-test` explicitly skips the probe.
 */

import * as p from "@clack/prompts";
import { LLM_PROVIDER_KINDS, type LlmProviderKind } from "@truecourse/shared";
import {
  readGlobalConfig,
  writeGlobalConfig,
  type GlobalApiLlmConfig,
  type LlmTransportMode,
} from "@truecourse/core/config/global-config";
import { providerKeyEnvVar } from "@truecourse/core/services/llm/install-transport";
import { probeApiConfig } from "@truecourse/core/services/llm/probe";
import { exitMissingNonInteractiveFlag, isInteractive } from "./helpers.js";

/** Runs one candidate config against the provider. Injectable so tests never call out. */
export type ApiProbe = (api: GlobalApiLlmConfig) => Promise<void>;

export const PROVIDER_LABELS: Record<LlmProviderKind, string> = {
  anthropic: "Anthropic API",
  openai: "OpenAI",
  bedrock: "AWS Bedrock",
  copilot: "GitHub Copilot",
};

const MODEL_PLACEHOLDER: Record<LlmProviderKind, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-5.6",
  bedrock: "anthropic.claude-opus-5",
  copilot: "gpt-5.6",
};

export interface RunConfigLlmSetupOptions {
  /** `--transport` — set means flag-driven (no prompts), whatever the TTY says. */
  transport?: string;
  provider?: string;
  model?: string;
  fallbackModel?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  apiKeyStdin?: boolean;
  baseUrl?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** `--header k=v`, repeatable. */
  header?: string[];
  /** `--no-test` sets this false: save without the live probe. */
  test?: boolean;
  /** The probe seam — defaults to the live provider call. */
  probe?: ApiProbe;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Save the transport selection, leaving any stored API block untouched. */
export function saveTransportSelection(mode: LlmTransportMode): void {
  const cfg = readGlobalConfig();
  writeGlobalConfig({ ...cfg, llm: { ...cfg.llm, transport: mode } });
}

function saveApiSelection(api: GlobalApiLlmConfig): void {
  const cfg = readGlobalConfig();
  writeGlobalConfig({ ...cfg, llm: { ...cfg.llm, transport: "api", api } });
}

function cancelSetup(): never {
  p.cancel("Cancelled — nothing was saved.");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Flag-driven setup
// ---------------------------------------------------------------------------

function parseHeaders(pairs: string[] | undefined): Record<string, string> | undefined {
  if (!pairs || pairs.length === 0) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      p.log.error(`--header expects k=v, got \`${pair}\`.`);
      process.exit(1);
    }
    headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return headers;
}

/** Read the API key from stdin (`--api-key-stdin`), so it never enters the shell history. */
async function readKeyFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8").trim();
}

function normalizeTransportFlag(value: string): LlmTransportMode {
  const v = value.trim();
  if (v === "api" || v === "claude-code") return v;
  p.log.error(`--transport must be \`claude-code\` or \`api\` (got \`${value}\`).`);
  process.exit(1);
}

function normalizeProviderFlag(value: string): LlmProviderKind {
  const v = value.trim() as LlmProviderKind;
  if (LLM_PROVIDER_KINDS.includes(v)) return v;
  p.log.error(`--provider must be one of ${LLM_PROVIDER_KINDS.join(", ")} (got \`${value}\`).`);
  process.exit(1);
}

/** Build the API block from flags, exiting with the missing flag names when incomplete. */
async function apiConfigFromFlags(opts: RunConfigLlmSetupOptions): Promise<GlobalApiLlmConfig> {
  const missing: string[] = [];
  if (!opts.provider?.trim()) missing.push("--provider <anthropic|openai|bedrock|copilot>");
  if (!opts.model?.trim()) missing.push("--model <id>");
  if (missing.length > 0) {
    exitMissingNonInteractiveFlag(
      "`config llm setup --transport api` needs the provider and model.",
      `Pass ${missing.join(" and ")}.`,
    );
  }
  const provider = normalizeProviderFlag(opts.provider as string);

  if (opts.apiKey) {
    p.log.warn(
      "--api-key was passed on the command line — it stays in your shell history. Prefer --api-key-stdin or --api-key-env <VAR>.",
    );
  }
  const apiKey = opts.apiKeyStdin ? await readKeyFromStdin() : opts.apiKey?.trim();
  const api: GlobalApiLlmConfig = {
    provider,
    model: (opts.model as string).trim(),
    fallbackModel: opts.fallbackModel?.trim() || undefined,
    apiKey: apiKey || undefined,
    apiKeyEnv: opts.apiKeyEnv?.trim() || undefined,
    baseURL: opts.baseUrl?.trim() || undefined,
    headers: parseHeaders(opts.header),
  };
  if (provider === "bedrock") {
    api.region = opts.region?.trim() || undefined;
    api.accessKeyId = opts.accessKeyId?.trim() || undefined;
    api.secretAccessKey = opts.secretAccessKey?.trim() || undefined;
    api.sessionToken = opts.sessionToken?.trim() || undefined;
    return api;
  }
  // Every other provider needs a key from somewhere. A named env var counts even
  // when it is unset right now — the name is what gets stored, and it resolves
  // per run (the probe below still fails if it is empty).
  const standardEnv = providerKeyEnvVar(provider);
  if (!api.apiKey && !api.apiKeyEnv && !(standardEnv && process.env[standardEnv]?.trim())) {
    exitMissingNonInteractiveFlag(
      `\`config llm setup\` found no API key for ${PROVIDER_LABELS[provider]}.`,
      `Pass --api-key-stdin (recommended), --api-key-env <VAR>, or --api-key <key>${standardEnv ? `, or set ${standardEnv}` : ""}.`,
    );
  }
  return api;
}

async function setupFromFlags(opts: RunConfigLlmSetupOptions): Promise<void> {
  const mode = normalizeTransportFlag(opts.transport as string);
  if (mode === "claude-code") {
    saveTransportSelection("claude-code");
    p.log.success("Saved — TrueCourse calls the LLM through Claude Code.");
    p.outro("Done.");
    return;
  }

  const api = await apiConfigFromFlags(opts);
  if (opts.test !== false) {
    const failure = await probeOnce(api, opts.probe);
    if (failure) {
      p.log.error(`The provider rejected the configuration: ${failure}`);
      p.outro("Nothing was saved — fix the settings and retry (or pass --no-test).");
      process.exit(1);
    }
    p.log.success("The provider answered — the configuration works.");
  }
  saveApiSelection(api);
  p.log.success(`Saved — TrueCourse calls ${PROVIDER_LABELS[api.provider]} (${api.model}).`);
  p.outro("Done.");
}

// ---------------------------------------------------------------------------
// Interactive wizard
// ---------------------------------------------------------------------------

/** Run the probe, returning the failure message, or null when the provider answered. */
async function probeOnce(api: GlobalApiLlmConfig, probe: ApiProbe | undefined): Promise<string | null> {
  const run = probe ?? ((cfg: GlobalApiLlmConfig) => probeApiConfig(cfg));
  const s = p.spinner();
  s.start(`Calling ${PROVIDER_LABELS[api.provider]} (${api.model})`);
  try {
    await run(api);
    s.stop("Provider answered.");
    return null;
  } catch (err) {
    s.stop("Provider call failed.");
    return (err as Error).message || String(err);
  }
}

/**
 * Await a text/password prompt: cancel exits, and an empty submission (which
 * clack resolves as `undefined`) reads back as an empty string.
 */
async function ask(prompt: Promise<string | symbol>): Promise<string> {
  const value = (await prompt) as string | symbol | undefined;
  if (p.isCancel(value)) cancelSetup();
  return (value as string | undefined)?.trim() ?? "";
}

/** Ask for every API field, seeded from a previous answer set when re-editing. */
async function askApiConfig(prev: GlobalApiLlmConfig | undefined): Promise<GlobalApiLlmConfig> {
  const provider = await p.select<LlmProviderKind>({
    message: "Which provider?",
    initialValue: prev?.provider ?? "anthropic",
    options: LLM_PROVIDER_KINDS.map((kind) => ({ value: kind, label: PROVIDER_LABELS[kind] })),
  });
  if (p.isCancel(provider)) cancelSetup();

  const model = await ask(
    p.text({
      message: "Which model? Every stage runs on it.",
      placeholder: MODEL_PLACEHOLDER[provider],
      initialValue: prev?.provider === provider ? prev?.model : undefined,
      validate: (v) => (v?.trim() ? undefined : "A model id is required in API mode."),
    }),
  );

  const api: GlobalApiLlmConfig = { provider, model };

  if (provider === "bedrock") {
    // All optional — anything omitted falls through to the ambient AWS chain.
    const region = await ask(
      p.text({
        message: "AWS region (leave empty for the ambient AWS configuration)",
        placeholder: "us-east-1",
        initialValue: prev?.region,
        defaultValue: "",
      }),
    );
    const accessKeyId = await ask(
      p.text({
        message: "AWS access key id (leave empty to use the instance role)",
        initialValue: prev?.accessKeyId,
        defaultValue: "",
      }),
    );
    const secretAccessKey = await ask(
      p.password({ message: "AWS secret access key (leave empty to use the instance role)" }),
    );
    api.region = region || undefined;
    api.accessKeyId = accessKeyId || undefined;
    api.secretAccessKey = secretAccessKey || prev?.secretAccessKey;
    api.sessionToken = prev?.sessionToken;
  } else {
    const standardEnv = providerKeyEnvVar(provider);
    const envHasKey = !!(standardEnv && process.env[standardEnv]?.trim());
    const keptKey = prev?.provider === provider ? prev.apiKey : undefined;
    const keptEnv = prev?.provider === provider ? prev.apiKeyEnv : undefined;
    if (envHasKey) {
      p.log.info(`found ${standardEnv} — press enter to use it without storing the key`);
    } else if (keptKey) {
      p.log.info("press enter to keep the key you already stored");
    }
    const key = await ask(
      p.password({
        message: "API key",
        validate: (v) =>
          v?.trim() || envHasKey || keptKey || keptEnv
            ? undefined
            : `An API key is required. Paste it, or set ${standardEnv} and re-run.`,
      }),
    );
    if (key) {
      api.apiKey = key;
    } else if (envHasKey) {
      // Store the VARIABLE NAME, not the key: it is read fresh on every run.
      api.apiKeyEnv = standardEnv as string;
    } else {
      api.apiKey = keptKey;
      api.apiKeyEnv = keptEnv;
    }
  }

  const fallbackModel = await ask(
    p.text({
      message: "Fallback model (optional — tried once if the primary errors)",
      initialValue: prev?.fallbackModel,
      defaultValue: "",
    }),
  );
  api.fallbackModel = fallbackModel || undefined;

  const advanced = await p.confirm({
    message: "Set an advanced option (a custom base URL for a gateway or self-hosted endpoint)?",
    initialValue: !!prev?.baseURL,
  });
  if (p.isCancel(advanced)) cancelSetup();
  if (advanced) {
    const baseURL = await ask(
      p.text({
        message: "Base URL",
        placeholder: "https://gateway.internal/v1",
        initialValue: prev?.baseURL,
        defaultValue: "",
      }),
    );
    api.baseURL = baseURL || undefined;
  }
  api.headers = prev?.headers;
  return api;
}

/** The wizard body — shared verbatim by first run and the reconfigure command. */
async function runWizard(opts: RunConfigLlmSetupOptions): Promise<void> {
  const saved = readGlobalConfig().llm;
  const mode = await p.select<LlmTransportMode>({
    message: "How should TrueCourse run its LLM calls?",
    initialValue: saved?.transport ?? "claude-code",
    options: [
      {
        value: "claude-code",
        label: "Claude Code (recommended)",
        hint: "uses your existing Claude Code login, per-stage model tiers, no API key needed",
      },
      {
        value: "api",
        label: "Provider API — bring your own key",
        hint: "Anthropic, OpenAI, AWS Bedrock, GitHub Copilot",
      },
    ],
  });
  if (p.isCancel(mode)) cancelSetup();

  if (mode === "claude-code") {
    saveTransportSelection("claude-code");
    p.log.success("Saved — TrueCourse calls the LLM through Claude Code.");
    return;
  }

  let api = await askApiConfig(saved?.api);
  while (opts.test !== false) {
    const failure = await probeOnce(api, opts.probe);
    if (!failure) {
      p.log.success("The provider answered — the configuration works.");
      break;
    }
    p.log.error(`The provider rejected the configuration: ${failure}`);
    const next = await p.select<"retry" | "edit" | "cancel">({
      message: "What now?",
      options: [
        { value: "edit", label: "Edit the settings" },
        { value: "retry", label: "Try again with the same settings" },
        { value: "cancel", label: "Cancel — save nothing" },
      ],
    });
    if (p.isCancel(next) || next === "cancel") cancelSetup();
    if (next === "edit") api = await askApiConfig(api);
  }
  saveApiSelection(api);
  p.log.success(`Saved — TrueCourse calls ${PROVIDER_LABELS[api.provider]} (${api.model}).`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function runConfigLlmSetup(opts: RunConfigLlmSetupOptions = {}): Promise<void> {
  p.intro("LLM setup");
  if (opts.transport?.trim()) {
    await setupFromFlags(opts);
    return;
  }
  if (!isInteractive()) {
    exitMissingNonInteractiveFlag(
      "`config llm setup` needs to know how TrueCourse should call the LLM.",
      "Pass --transport claude-code, or --transport api with --provider, --model, and a key (--api-key-stdin / --api-key-env <VAR>).",
    );
  }
  await runWizard(opts);
  p.outro("Change this any time with `truecourse config llm setup`.");
}

// ---------------------------------------------------------------------------
// First run
// ---------------------------------------------------------------------------

export interface FirstRunContext {
  /** The invoked command path, e.g. `spec scan` (empty for the bare `truecourse`). */
  commandPath: string;
  /** The command's `--llm-transport` value, when it has that flag and it was passed. */
  transportFlag?: string;
  /** The probe seam — defaults to the live provider call. */
  probe?: ApiProbe;
}

// `config llm *` IS the wizard, and `hooks run` is invoked by a git hook inside
// another tool, where a prompt would hang the wrapper.
const EXCLUDED_COMMANDS = [/^config llm(\s|$)/, /^hooks run$/];

/**
 * Should the first-run choice be asked before this command? Only when nothing
 * is saved, nothing overrode the transport for this run, and there is a terminal
 * to ask on — a non-TTY run silently keeps Claude Code and saves nothing.
 */
export function firstRunApplies(ctx: FirstRunContext): boolean {
  if (!ctx.commandPath.trim()) return false;
  if (EXCLUDED_COMMANDS.some((re) => re.test(ctx.commandPath))) return false;
  if (ctx.transportFlag?.trim()) return false;
  if (process.env.TRUECOURSE_LLM_TRANSPORT?.trim()) return false;
  if (readGlobalConfig().llm?.transport) return false;
  return isInteractive();
}

/** Guards against a second ask in the same process (nested command invocations). */
let firstRunAsked = false;

/** Reset the once-per-process latch (tests). */
export function resetLlmFirstRun(): void {
  firstRunAsked = false;
}

/**
 * The first-run choice, asked before the very first command a user runs. Saves
 * the selection and returns so the command continues into its own work.
 */
export async function runLlmFirstRun(ctx: FirstRunContext): Promise<void> {
  if (firstRunAsked) return;
  if (!firstRunApplies(ctx)) return;
  firstRunAsked = true;

  p.intro("Welcome to TrueCourse");
  p.log.message("TrueCourse needs an LLM. Pick one now — `truecourse config llm setup` changes it later.");
  await runWizard({ probe: ctx.probe });
  p.outro("Continuing…");
}
