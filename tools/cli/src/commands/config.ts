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
}

const STAGE_LABEL: Record<StageId, string> = {
  "spec.relevance": "Spec   · doc relevance",
  "spec.areaTag": "Spec   · area tag",
  "spec.vocab": "Spec   · vocab reconcile",
  "spec.chainDetect": "Spec   · chain detect",
  "spec.overlap": "Spec   · overlap flag",
  "spec.relation": "Spec   · relation detect",
  "contract.enumerate": "Contract · enumerate",
  "contract.reconcile": "Contract · reconcile",
  "contract.extract": "Contract · extract",
  "contract.repair": "Contract · repair",
  "contract.repairParse": "Contract · repair (syntax)",
  "contract.gapJudge": "Contract · gap judge",
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
