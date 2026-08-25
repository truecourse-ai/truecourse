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
import type { GuardSetupInterfaceProvider, RecipeRunner } from "@truecourse/guard-generator";
import type { GuardSetupReport } from "@truecourse/shared";
import {
  guardSetupInProcess,
  estimateGuardSetupCost,
  NoLlmProviderError,
  GUARD_SETUP_STEPS,
  GUARD_SETUP_ONLY_STEPS,
  SetupStepNotReadyError,
  EstimateDeclined,
  type GuardSetupOnlyStep,
} from "@truecourse/core/commands/guard-setup";
import { registerProject } from "@truecourse/core/config/registry";
import { createStdoutStepRenderer } from "../lib/stdout-step-renderer.js";
import { requireGitRepo } from "./git-guard.js";
import { preflightLlmOrExit } from "../lib/claude-preflight.js";
import { isInteractive, printWatchLive, resolveDashboardUrl } from "./helpers.js";
import { provisionExternals } from "./guard-setup-externals.js";

export interface RunGuardSetupOptions {
  cwd?: string;
  /** Re-derive the recipe and re-draft the seed even when both already exist. */
  refresh?: boolean;
  /** Interfaces step: re-author places that already carry authored tasks. */
  replace?: boolean;
  /**
   * Single-step mode (`--only-<step>`): run one step in isolation — prior steps
   * replay from what they left on disk (a step nobody ran aborts loudly), later
   * steps never start. `detect` always runs; it costs nothing.
   */
  only?: GuardSetupOnlyStep;
  /** Skip the pre-flight cost confirm — and, with `--refresh`, consent to replacing the seed. */
  yes?: boolean;
  /** LLM transport for this run: `cli` (spawn `claude -p`), `agent` (mailbox under `io`), or `api`. */
  llmTransport?: "cli" | "agent" | "api";
  io?: string;
  /** Test seams (production spawns the transport / analyzes the tree). */
  recipeRunner?: RecipeRunner;
  interfaces?: GuardSetupInterfaceProvider;
  /** Test seam / explicit override for whether the terminal can prompt. */
  interactive?: boolean;
}

export async function runGuardSetup(opts: RunGuardSetupOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro(opts.only ? `Guard setup — ${SETUP_STEP_LABEL[opts.only]} only` : "Guard setup");
  await requireGitRepo(repoRoot);
  const project = await registerProject(repoRoot);
  const dashboardUrl = await resolveDashboardUrl();

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
  if (!opts.recipeRunner) {
    await preflightLlmOrExit(opts.llmTransport);
  }

  const autoApprove = !!opts.yes || opts.llmTransport === "agent";
  const interactive = opts.interactive ?? isInteractive();

  const renderer = createStdoutStepRenderer();
  // A single-step run gets a checklist of only the steps that will report:
  // everything up to the chosen one (they replay), plus the free `detect` pass.
  const stepDefs = opts.only
    ? GUARD_SETUP_STEPS.filter(
        (s, i) => s.key === "detect" || i <= GUARD_SETUP_STEPS.findIndex((x) => x.key === opts.only),
      )
    : GUARD_SETUP_STEPS;
  const tracker = new StepTracker(renderer.onProgress, stepDefs.map((s) => ({ ...s })));

  let report: GuardSetupReport;
  let reportPath: string;
  let sessionsRunDirs: string[];
  try {
    ({ report, reportPath, sessionsRunDirs } = await guardSetupInProcess(repoRoot, {
      tracker,
      llm: opts.llmTransport,
      io: opts.io,
      ...(opts.refresh ? { refresh: true } : {}),
      ...(opts.replace ? { replace: true } : {}),
      ...(opts.only ? { only: opts.only } : {}),
      ...(opts.recipeRunner ? { recipeRunner: opts.recipeRunner } : {}),
      ...(opts.interfaces ? { interfaces: opts.interfaces } : {}),
      // Fires per run record this invocation opens (setup's own and the nested
      // interfaces step's) — each gets its exact-run deep link.
      onRunStarted: (info) => printWatchLive(dashboardUrl, project.slug, info.runId),
      onLlmEstimate: async (estimate) => {
        // ONE LINE, deliberately: setup is bounded at two calls, so the staged modal
        // the big pipelines render would be more ceremony than the spend it describes.
        renderer.dispose();
        const calls = (estimate.stages ?? []).reduce(
          (n, s) => n + (s.callsRange?.high ?? s.calls),
          0,
        );
        const cost = estimate.estimatedCostUsd != null ? ` (~$${estimate.estimatedCostUsd.toFixed(2)})` : "";
        const line = `Setup's agent sessions may spend up to ${calls} model turn${calls === 1 ? "" : "s"}${cost} — deterministic derivations and warm caches run first, for free.`;
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
    // A single-step run found a PRIOR step never ran: doing it here would blur
    // the step isolation the flags exist for, so it stops and names the flag.
    if (e instanceof SetupStepNotReadyError) {
      p.log.error(`Step not ready — the ${SETUP_STEP_LABEL[e.step]} step has not run (${e.missing}).`);
      p.log.step(`Run \`truecourse guard setup --only-${e.step}\` first, then re-run this step.`);
      p.outro("Aborted.");
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
  // and the values can be supplied later for nothing. A single-step run offers it
  // only when the CATALOG step is the one that ran — otherwise the `unprovided`
  // list is the previous report's, carried forward, and nothing just changed.
  const catalogRan = !opts.only || opts.only === "catalog";
  if (
    report.status === "ok" &&
    interactive &&
    catalogRan &&
    (report.externals?.unprovided.length ?? 0) > 0
  ) {
    await provisionExternals(repoRoot);
  }

  if (report.status === "failed") {
    p.outro("Aborted — fix the above and re-run `truecourse guard setup`.");
    process.exit(1);
    return;
  }
  // Single-step mode: name where the transcripts landed (the inspection loop's
  // whole point) and which step comes next.
  if (opts.only) {
    for (const dir of sessionsRunDirs) {
      p.log.step(`sessions    ${path.relative(repoRoot, dir) || dir}`);
    }
    const next = SETUP_STEP_NEXT[opts.only];
    p.outro(
      next
        ? `Ran the ${SETUP_STEP_LABEL[opts.only]} step only — every other row of guard/setup.json is carried forward. Next: \`truecourse guard setup --only-${next}\`.`
        : `Ran the ${SETUP_STEP_LABEL[opts.only]} step only — the last one. Review what changed, then run \`truecourse guard generate\`.`,
    );
    return;
  }
  p.outro(
    "Review and commit what changed (recipe.json, the seed script), then run `truecourse guard generate`.",
  );
}

/** Human name of each `--only-<step>` setup step, for prose lines. */
const SETUP_STEP_LABEL: Record<GuardSetupOnlyStep, string> = {
  recipe: "recipe",
  catalog: "dependency catalog",
  interfaces: "interface authoring",
  seed: "seed",
  auth: "auth proof",
};

/** The step to suggest after a single-step run; the last one has no successor. */
const SETUP_STEP_NEXT: Record<GuardSetupOnlyStep, GuardSetupOnlyStep | undefined> =
  Object.fromEntries(
    GUARD_SETUP_ONLY_STEPS.map((step, i) => [step, GUARD_SETUP_ONLY_STEPS[i + 1]]),
  ) as Record<GuardSetupOnlyStep, GuardSetupOnlyStep | undefined>;

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
      if (s.salvaged) {
        p.log.message("  salvaged    the session ended without an outcome; the engine folded its last verified draft");
      }
      p.log.message(
        s.credentials?.length
          ? "  The script RAN in a fresh world, its manifest matched `provides`, and every principal answered a live authenticated probe."
          : "  The script RAN in a fresh world and its manifest matched `provides`.",
      );
    } else if (s.status === "ok") {
      p.log.step(`seed        already present (${s.command})`);
    } else if (s.status === "failed") {
      p.log.warn(`seed        not drafted: ${s.reason}`);
    } else {
      p.log.info(`seed        skipped: ${s.reason}`);
    }
  }

  // The auth verdict lives only on the steps spine (no legacy top-level field),
  // and `blocked` is BY DESIGN loud and actionable — a registration the user
  // must perform. Swallowing it defeated the step (2026-08-24 bench, twice).
  const auth = report.steps?.find((step) => step.key === "auth");
  if (auth) {
    if (auth.status === "blocked") {
      p.log.warn(`auth        blocked: ${auth.reason}`);
    } else if (auth.status === "failed") {
      p.log.warn(`auth        failed: ${auth.reason}`);
    } else if (auth.status === "skipped") {
      p.log.info(`auth        skipped: ${auth.reason}`);
    } else {
      p.log.step(`auth        every provided dependency proved`);
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
