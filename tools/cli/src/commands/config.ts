/**
 * `truecourse config llm` — the read/flip surface over the LLM configuration:
 * which transport is active (`show`), whether the saved API config actually
 * works (`test`), and switching between the two (`use`). Credentials are
 * entered through `config llm setup`, never here, and never printed unmasked.
 *
 * The per-stage model resolution stays read-only: edits go through env vars or
 * `.truecourse/config.json` under `llm.stages` / `llm.fallbackModel`.
 */

import * as p from "@clack/prompts";
import path from "node:path";
import {
  describeStageResolutions,
  STAGE_DEFAULTS,
  type StageId,
} from "@truecourse/core/config/llm-models";
import {
  maskSecret,
  readGlobalConfig,
  type GlobalApiLlmConfig,
} from "@truecourse/core/config/global-config";
import {
  getConfiguredLlmMode,
  providerKeyEnvVar,
} from "@truecourse/core/services/llm/install-transport";
import { probeApiConfig } from "@truecourse/core/services/llm/probe";
import {
  PROVIDER_LABELS,
  saveTransportSelection,
  type ApiProbe,
} from "./config-llm-setup.js";

export interface RunConfigLlmShowOptions {
  /** Override the repo root; defaults to cwd. */
  cwd?: string;
}

const STAGE_LABEL: Record<StageId, string> = {
  "spec.relevance": "Spec   · doc relevance",
  "spec.areaTag": "Spec   · area tag",
  "spec.vocab": "Spec   · vocab reconcile",
  "spec.overlap": "Spec   · overlap flag",
  "spec.verifyOverlap": "Spec   · overlap verify",
  "contract.enumerate": "Contract · enumerate",
  "contract.reconcile": "Contract · reconcile",
  "contract.extract": "Contract · extract",
  "contract.repair": "Contract · repair",
  "contract.repairParse": "Contract · repair (syntax)",
  "contract.gapJudge": "Contract · gap judge",
  "guard.extract": "Guard  · claim extract",
  "guard.flows": "Guard  · flow synthesis",
  "guard.match": "Guard  · flow matching",
  "guard.generate": "Guard  · scenario gen",
  "guard.retry": "Guard  · scenario retry",
  "guard.fidelity": "Guard  · fidelity review",
  "guard.triage": "Guard  · failure triage",
  "guard.visualJudge": "Guard  · visual judge",
  "guard.recipe": "Guard  · recipe discover",
  "guard.seed": "Guard  · seed draft",
  "guard.stateReconcile": "Guard  · state reconcile",
  "rules.violationGen": "Rules  · violation gen",
};

const SOURCE_LABEL: Record<string, string> = {
  "env-stage": "env (per-stage)",
  "env-global": "env (global)",
  "env-legacy": "env (legacy CLAUDE_CODE_MODEL)",
  config: "config.json",
  "api-config": "api model",
  default: "default",
};

/** Where the key comes from at run time, with the value itself masked. */
function describeApiKey(api: GlobalApiLlmConfig): string {
  if (api.apiKey) return `${maskSecret(api.apiKey)} (config file)`;
  if (api.apiKeyEnv) {
    const value = process.env[api.apiKeyEnv]?.trim();
    return value ? `${maskSecret(value)} (env ${api.apiKeyEnv})` : `(unset — env ${api.apiKeyEnv})`;
  }
  const standard = providerKeyEnvVar(api.provider);
  if (!standard) return "(ambient AWS credential chain)";
  const value = process.env[standard]?.trim();
  return value ? `${maskSecret(value)} (env ${standard})` : `(none — set ${standard} or run \`config llm setup\`)`;
}

/** The transport block: the active mode, where it came from, and the API details. */
function printTransportBlock(): void {
  const cfg = readGlobalConfig();
  const mode = getConfiguredLlmMode();
  const source = process.env.TRUECOURSE_LLM_TRANSPORT?.trim()
    ? "env TRUECOURSE_LLM_TRANSPORT"
    : cfg.llm?.transport
      ? "config file"
      : "default — never chosen";
  p.log.step(`transport  ${mode} (${source})`);

  const api = cfg.llm?.api;
  if (!api) {
    if (mode === "api") p.log.warn("No API configuration saved — run `truecourse config llm setup`.");
    return;
  }
  const inactive = mode === "api" ? "" : "  (saved, not active)";
  console.log(`  provider   ${PROVIDER_LABELS[api.provider] ?? api.provider}${inactive}`);
  console.log(`  model      ${api.model}`);
  console.log(`  fallback   ${api.fallbackModel ?? "(none)"}`);
  console.log(`  key        ${describeApiKey(api)}`);
  if (api.baseURL) console.log(`  baseURL    ${api.baseURL}`);
  if (api.provider === "bedrock") {
    console.log(`  region     ${api.region ?? "(ambient AWS configuration)"}`);
    if (api.accessKeyId) console.log(`  accessKey  ${api.accessKeyId}`);
    if (api.secretAccessKey) console.log(`  secretKey  ${maskSecret(api.secretAccessKey)}`);
  }
}

export async function runConfigLlmShow(
  options: RunConfigLlmShowOptions = {},
): Promise<void> {
  const repoRoot = options.cwd ?? process.cwd();
  const { stages, fallbackModel } = describeStageResolutions(repoRoot);

  p.intro("LLM configuration");
  printTransportBlock();
  p.log.message("");
  p.log.info(`repoRoot   ${path.relative(process.cwd(), repoRoot) || "."}`);
  p.log.info(`fallback   ${fallbackModel ?? "(not configured)"}`);

  for (const stage of stages) {
    const label = STAGE_LABEL[stage.stageId];
    const def = STAGE_DEFAULTS[stage.stageId];
    const drift = stage.effectiveModel !== def ? ` (default: ${def})` : "";
    const where = stage.envVar
      ? `${SOURCE_LABEL[stage.source]} → ${stage.envVar}`
      : SOURCE_LABEL[stage.source];
    console.log(`  ${label.padEnd(28)} ${stage.effectiveModel.padEnd(10)} ${where}${drift}`);
  }

  p.outro(
    "Override per-stage with TRUECOURSE_MODEL_<STAGE_ID> or .truecourse/config.json#llm.stages.<stageId>.",
  );
}

// ---------------------------------------------------------------------------
// test — one live call against the saved API configuration
// ---------------------------------------------------------------------------

export interface RunConfigLlmTestOptions {
  /** The probe seam — defaults to the live provider call. */
  probe?: ApiProbe;
}

export async function runConfigLlmTest(options: RunConfigLlmTestOptions = {}): Promise<void> {
  p.intro("LLM configuration test");
  const api = readGlobalConfig().llm?.api;
  if (!api) {
    p.log.error("No API configuration saved. Run `truecourse config llm setup` to add one.");
    p.outro("Nothing to test.");
    process.exit(1);
  }
  if (getConfiguredLlmMode() !== "api") {
    p.log.warn(
      "Claude Code is the active transport — testing the saved API configuration anyway (`truecourse config llm use api` activates it).",
    );
  }

  const s = p.spinner();
  s.start(`Calling ${PROVIDER_LABELS[api.provider] ?? api.provider} (${api.model})`);
  try {
    await (options.probe ?? probeApiConfig)(api);
  } catch (err) {
    s.stop("Provider call failed.");
    p.log.error((err as Error).message || String(err));
    p.outro("The saved API configuration is not usable — fix it with `truecourse config llm setup`.");
    process.exit(1);
  }
  s.stop("Provider answered.");
  p.outro(`The saved API configuration works — ${api.provider} (${api.model}).`);
}

// ---------------------------------------------------------------------------
// use — flip the saved transport
// ---------------------------------------------------------------------------

export async function runConfigLlmUse(mode: string): Promise<void> {
  p.intro("LLM transport");
  const next = mode?.trim();
  if (next !== "api" && next !== "claude-code") {
    p.log.error(`Unknown transport \`${mode}\` — expected \`claude-code\` or \`api\`.`);
    p.outro("Nothing changed.");
    process.exit(1);
  }
  const cfg = readGlobalConfig();
  if (next === "api" && !cfg.llm?.api) {
    p.log.error("The API transport has never been configured. Run `truecourse config llm setup` first.");
    p.outro("Nothing changed.");
    process.exit(1);
  }

  saveTransportSelection(next);
  p.log.success(
    next === "api"
      ? `Saved — TrueCourse calls ${PROVIDER_LABELS[cfg.llm!.api!.provider] ?? cfg.llm!.api!.provider} (${cfg.llm!.api!.model}).`
      : "Saved — TrueCourse calls the LLM through Claude Code.",
  );
  const envOverride = process.env.TRUECOURSE_LLM_TRANSPORT?.trim();
  if (envOverride && envOverride !== next) {
    p.log.warn(`TRUECOURSE_LLM_TRANSPORT=${envOverride} is set and overrides the saved selection for every run.`);
  }
  p.outro("Done.");
}
