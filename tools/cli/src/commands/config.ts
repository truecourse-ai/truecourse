/**
 * `truecourse config llm` — surface the effective per-stage model
 * resolution so users (and agents) can see what TrueCourse will use
 * for each LLM stage and where each value came from.
 *
 * Read-only today. Edits go through env vars or by hand-editing
 * `.truecourse/config.json` under `llm.stages` / `llm.fallbackModel`.
 */

import * as p from "@clack/prompts";
import path from "node:path";
import {
  describeStageResolutions,
  STAGE_DEFAULTS,
  type StageId,
} from "@truecourse/core/config/llm-models";

export interface RunConfigLlmShowOptions {
  /** Override the repo root; defaults to cwd. */
  cwd?: string;
  /** When true, emit a single JSON document instead of clack output. */
  json?: boolean;
}

const STAGE_LABEL: Record<StageId, string> = {
  "spec.chainDetect": "Spec   · chain detect",
  "spec.claimExtract": "Spec   · claim extract",
  "spec.chainRecheck": "Spec   · chain recheck",
  "spec.conflictExplain": "Spec   · conflict explain",
  "spec.conflictResolve": "Spec   · conflict resolve",
  "spec.relevance": "Spec   · doc relevance",
  "contract.extract": "Contract · extract",
  "contract.repair": "Contract · repair",
  "rules.violationGen": "Rules  · violation gen",
};

const SOURCE_LABEL: Record<string, string> = {
  "env-stage": "env (per-stage)",
  "env-global": "env (global)",
  "env-legacy": "env (legacy CLAUDE_CODE_MODEL)",
  config: "config.json",
  default: "default",
};

export async function runConfigLlmShow(
  options: RunConfigLlmShowOptions = {},
): Promise<void> {
  const repoRoot = options.cwd ?? process.cwd();
  const { stages, fallbackModel } = describeStageResolutions(repoRoot);

  if (options.json) {
    process.stdout.write(
      JSON.stringify(
        {
          repoRoot: path.relative(process.cwd(), repoRoot) || ".",
          stages: stages.map((s) => ({
            stageId: s.stageId,
            effectiveModel: s.effectiveModel,
            defaultModel: STAGE_DEFAULTS[s.stageId],
            source: s.source,
            envVar: s.envVar ?? null,
          })),
          fallbackModel,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  p.intro("LLM model resolution");
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
