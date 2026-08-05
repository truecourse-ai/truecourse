/**
 * `truecourse guard setup` — the cheap preparation stage.
 *
 *   spec scan  →  guard setup  →  guard generate
 *
 * Setup derives and PROVES the recipe (including a live call against a real route),
 * detects the repo's third parties and its database, declares every detected
 * external API so a key handed over later re-authors nothing, and drafts the one
 * seed that creates both the rows and the authenticated principals the tests need.
 * All of it costs at most two LLM calls; `guard generate` refuses to run until it
 * has been done, precisely so that FIXING any of these facts is free.
 *
 *   guard setup            derive what is missing; report what is already there
 *   guard setup --refresh  re-derive the recipe and re-draft the seed
 *
 * TWO interactive moments, both deliberate:
 *  - a `--refresh` that would REPLACE an existing `api.seed` asks first, because that
 *    script is a committed, human-reviewed file. In a non-TTY the answer is no unless
 *    `-y` was passed — a flag alone never clobbers a hand-edited seed;
 *  - a terminal run offers to PROVISION the external APIs setup declared but nobody
 *    has an account for yet (`./guard-setup-externals.ts`). Skipped non-interactively,
 *    at no cost: the declarations are already written, and supplying a value later is
 *    fingerprint-neutral by construction.
 */

import path from "node:path";
import * as p from "@clack/prompts";
import { StepTracker } from "@truecourse/core/progress";
import type { JourneyProvider, RecipeRunner, SeedRunner } from "@truecourse/guard-generator";
import type { GuardSetupReport } from "@truecourse/shared";
import {
  guardSetupInProcess,
  estimateGuardSetupCost,
  NoLlmProviderError,
  GUARD_SETUP_STEPS,
  EstimateDeclined,
} from "@truecourse/core/commands/guard-setup";
import { registerProject } from "@truecourse/core/config/registry";
import { createStdoutStepRenderer } from "../lib/stdout-step-renderer.js";
import { requireGitRepo } from "./git-guard.js";
import { preflightLlmOrExit } from "../lib/claude-preflight.js";
import { isInteractive } from "./helpers.js";
import { provisionExternals } from "./guard-setup-externals.js";

export interface RunGuardSetupOptions {
  cwd?: string;
  /** Re-derive the recipe and re-draft the seed even when both already exist. */
  refresh?: boolean;
  /** Skip the pre-flight cost confirm — and, with `--refresh`, consent to replacing the seed. */
  yes?: boolean;
  /** LLM transport for this run: `cli` (spawn `claude -p`), `agent` (mailbox under `io`), or `api`. */
  llmTransport?: "cli" | "agent" | "api";
  io?: string;
  /** Test seams (production spawns the transport / analyzes the tree). */
  recipeRunner?: RecipeRunner;
  seedRunner?: SeedRunner;
  journeys?: JourneyProvider;
  /** Test seam / explicit override for whether the terminal can prompt. */
  interactive?: boolean;
}

export async function runGuardSetup(opts: RunGuardSetupOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Guard setup");
  await requireGitRepo(repoRoot);
  await registerProject(repoRoot);

  if (opts.llmTransport === "agent" && !opts.io) {
    p.log.error("--llm-transport agent requires --io <dir> (the request/response mailbox directory).");
    p.outro("Aborted.");
    process.exit(1);
  }
  // The same up-front gate `guard generate` does, branching on the transport this
  // run will use: the `claude` login probe in Claude Code mode, the provider-config
  // check (and the install that makes it the default) in API mode, nothing for the
  // mailbox. Setup's LLM stages come AFTER a build, a boot, and an analysis pass, so
  // finding out then would waste all of it.
  if (!opts.recipeRunner && !opts.seedRunner) {
    await preflightLlmOrExit(opts.llmTransport);
  }

  const autoApprove = !!opts.yes || opts.llmTransport === "agent";
  const interactive = opts.interactive ?? isInteractive();

  const renderer = createStdoutStepRenderer();
  const tracker = new StepTracker(renderer.onProgress, GUARD_SETUP_STEPS.map((s) => ({ ...s })));

  let report: GuardSetupReport;
  let reportPath: string;
  try {
    ({ report, reportPath } = await guardSetupInProcess(repoRoot, {
      tracker,
      llm: opts.llmTransport,
      io: opts.io,
      ...(opts.refresh ? { refresh: true } : {}),
      ...(opts.recipeRunner ? { recipeRunner: opts.recipeRunner } : {}),
      ...(opts.seedRunner ? { seedRunner: opts.seedRunner } : {}),
      ...(opts.journeys ? { journeys: opts.journeys } : {}),
      onLlmEstimate: async (estimate) => {
        // ONE LINE, deliberately: setup is bounded at two calls, so the staged modal
        // the big pipelines render would be more ceremony than the spend it describes.
        renderer.dispose();
        const calls = (estimate.stages ?? []).reduce(
          (n, s) => n + (s.callsRange?.high ?? s.calls),
          0,
        );
        const cost = estimate.estimatedCostUsd != null ? ` (~$${estimate.estimatedCostUsd.toFixed(2)})` : "";
        const line = `Setup makes up to ${calls} LLM call${calls === 1 ? "" : "s"}${cost} — the repo's own manifests are tried first, for free.`;
        if (autoApprove) {
          p.log.step(line);
          return true;
        }
        if (!interactive) {
          p.log.error(`${line} Re-run with \`-y\` to proceed non-interactively.`);
          return false;
        }
        p.log.step(line);
        const go = await p.confirm({ message: "Proceed with setup?", initialValue: true });
        return !p.isCancel(go) && go === true;
      },
      confirmSeedReplace: async () => {
        // A committed, human-reviewed script. `--refresh` is not consent; `-y` is.
        if (autoApprove) return true;
        if (!interactive) return false;
        renderer.dispose();
        const go = await p.confirm({
          message:
            "This repository already has an `api.seed` script. Replace it? (the current one is in git — that is the undo)",
          initialValue: false,
        });
        return !p.isCancel(go) && go === true;
      },
    }));
  } catch (e) {
    renderer.dispose();
    if (e instanceof EstimateDeclined) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }
    if (e instanceof NoLlmProviderError) {
      p.log.error(e.message);
      p.outro("Aborted — setup needs a model to fall back on when the repo's own manifests do not decide.");
      process.exit(1);
    }
    p.log.error(`Guard setup failed: ${(e as Error).message}`);
    p.outro("Aborted.");
    process.exit(1);
    return;
  }
  renderer.dispose();

  printSetupReport(report, path.relative(repoRoot, reportPath) || reportPath);

  // The one INTERACTIVE moment of step 3: hand guard an account for a service it
  // declared but nobody has provided yet. Offered here rather than in `guard
  // externals` because declaring a service is what enters the recipe fingerprint —
  // doing it in the preparation stage is free, doing it after a generate is a
  // regenerate. Non-interactive runs skip it: the declarations are already written,
  // and the values can be supplied later for nothing.
  if (report.status === "ok" && interactive && (report.externals?.unprovided.length ?? 0) > 0) {
    await provisionExternals(repoRoot);
  }

  if (report.status === "failed") {
    p.outro("Aborted — fix the above and re-run `truecourse guard setup`.");
    process.exit(1);
    return;
  }
  p.outro(
    "Review and commit what changed (recipe.json, the seed script), then run `truecourse guard generate`.",
  );
}

/** The closing report: one block per step, then the honest to-do list. */
export function printSetupReport(report: GuardSetupReport, reportPath: string): void {
  const r = report.recipe;
  if (r.status === "failed") {
    for (const line of (r.reason ?? report.reason ?? "the recipe could not be prepared").split("\n")) {
      if (line) p.log.error(line);
    }
  } else if (r.status === "skipped") {
    p.log.error(report.reason ?? "setup did not run");
  } else {
    p.log.step(
      r.outcome === "discovered"
        ? `recipe      wrote ${r.wrotePath}${r.source === "deterministic" ? " (derived from the repo's own manifests — no LLM call)" : " (proposed by the model, verified by the engine)"}`
        : "recipe      already present — reused, not re-derived",
    );
    if (r.composePath) {
      p.log.message(`  datastore   wrote ${r.composePath} — derived from this app's own connection URL`);
    }
    for (const probe of r.probes ?? []) {
      // ANY status is a pass here (see the engine): the probe answers "is this the
      // server my scenarios will drive", not "does this endpoint work".
      p.log.message(`  reached     ${probe.server}: GET ${probe.path} → ${probe.status ?? "—"}`);
    }
    for (const todo of r.todos ?? []) p.log.warn(`  TODO        ${todo}`);
  }

  const d = report.detection;
  if (d) {
    const db = d.database ? `${d.database.driver}/${d.database.type} (${d.database.tables} tables)` : "none";
    p.log.step(
      `detected    ${d.externalServices.length} external service${d.externalServices.length === 1 ? "" : "s"} · database ${db}`,
    );
  }

  const e = report.externals;
  if (e && e.status !== "skipped") {
    if (e.status === "failed") {
      p.log.warn(`externals   not declared: ${e.reason}`);
    } else {
      const parts: string[] = [];
      if (e.declared.length > 0) parts.push(`${e.declared.length} newly declared (${e.declared.join(", ")})`);
      if (e.alreadyDeclared.length > 0) parts.push(`${e.alreadyDeclared.length} already declared`);
      p.log.step(`externals   ${parts.length > 0 ? parts.join(" · ") : "nothing to declare"}`);
      if (e.undeclarable.length > 0) {
        p.log.message(
          `  undeclared  ${e.undeclarable.join(", ")} — no base-URL env var was detected, so guard has nothing honest to point at them; add one by hand if the app has it`,
        );
      }
      if (e.unprovided.length > 0) {
        p.log.message(
          `  no account  ${e.unprovided.join(", ")} — declared, so supplying a key later touches only the gitignored externals.local.json and re-authors nothing`,
        );
      }
    }
  }

  const s = report.seed;
  if (s) {
    if (s.status === "ok" && s.outcome === "drafted") {
      p.log.step(`seed        wrote ${s.scriptPath} and patched the recipe's \`api.seed\``);
      p.log.message(`  command     ${s.command}`);
      if (s.fixtures?.length) p.log.message(`  fixtures    ${s.fixtures.join(", ")}`);
      if (s.credentials?.length) p.log.message(`  principals  ${s.credentials.join(", ")}`);
      p.log.message("  The script RAN, its manifest matched `provides`, and the server booted against it.");
    } else if (s.status === "ok") {
      p.log.step(`seed        already present (${s.command})`);
    } else if (s.status === "failed") {
      p.log.warn(`seed        not drafted: ${s.reason}`);
    } else {
      p.log.info(`seed        skipped: ${s.reason}`);
    }
  }

  for (const error of report.credentialSchemes?.errors ?? []) {
    p.log.error(`${error} \`truecourse guard generate\` will refuse to run until this is fixed.`);
  }
  for (const warning of report.credentialSchemes?.warnings ?? []) p.log.warn(warning);

  if (report.usage) {
    p.log.step(
      `usage       ${report.usage.calls} call${report.usage.calls === 1 ? "" : "s"} · $${report.usage.costUsd.toFixed(2)}`,
    );
  }
  p.log.info(`report: ${reportPath}`);
}
