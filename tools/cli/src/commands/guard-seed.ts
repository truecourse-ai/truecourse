/**
 * `truecourse guard seed` — the database seed: show it, or draft one.
 *
 *   guard seed          print `api.seed` as the runner loads it, the script file it
 *                       names, the flows still blocked on missing data, and how the
 *                       last drafting attempt went
 *   guard seed --init   draft a seed for those flows: the model writes the script,
 *                       the ENGINE runs it and validates its manifest, and only a
 *                       seed that actually worked is written
 *
 * NON-INTERACTIVE by design (same contract as `guard recipe`): it never prompts,
 * and an existing `api.seed` is never overwritten — a seed is a committed,
 * human-reviewed file.
 */

import path from "node:path";
import * as p from "@clack/prompts";
import type { SeedRunner } from "@truecourse/guard-generator";
import {
  readGuardSeedView,
  guardSeedDraftInProcess,
  type GuardSeedView,
} from "@truecourse/core/commands/guard-seed";

export interface RunGuardSeedOptions {
  cwd?: string;
  /** Draft + verify + write a seed for the last generate's missing-data gaps. */
  init?: boolean;
  /** LLM transport for the drafting call: `cli` (default) or `agent`. */
  llmTransport?: "cli" | "agent";
  io?: string;
  /** Test seam: the drafting model (production spawns the transport). */
  seedRunner?: SeedRunner;
}

export async function runGuardSeed(opts: RunGuardSeedOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Guard seed");

  const view = readGuardSeedView(repoRoot);
  const rel = path.relative(repoRoot, view.recipePath) || view.recipePath;

  if (opts.init) {
    await draft(repoRoot, rel, opts);
    return;
  }

  if (view.invalidReason) {
    p.log.error(`${rel} does not parse: ${view.invalidReason}`);
    p.outro("Fix it before drafting a seed.");
    process.exit(1);
    return;
  }

  printSeed(view, repoRoot);
  printBlocked(view);
  printLastDraft(view);

  if (view.seed) {
    p.outro("The seed is yours to edit — `guard seed --init` never overwrites one.");
    return;
  }
  p.outro(
    view.blocked.length > 0
      ? "Draft one with `truecourse guard seed --init`."
      : "No seed is needed until a flow is blocked on missing data.",
  );
}

/** `--init`: the drafting stage, standalone. */
async function draft(repoRoot: string, rel: string, opts: RunGuardSeedOptions): Promise<void> {
  p.log.step("Drafting a seed script from this repository's own schema, then RUNNING it…");

  const result = await guardSeedDraftInProcess(repoRoot, {
    ...(opts.llmTransport ? { llm: opts.llmTransport } : {}),
    ...(opts.io ? { io: opts.io } : {}),
    ...(opts.seedRunner ? { seedRunner: opts.seedRunner } : {}),
  });

  if (result.status === "no-gaps") {
    p.log.info(result.reason);
    p.outro("Nothing to draft.");
    return;
  }
  if (result.status === "skipped") {
    p.log.warn(`No seed was drafted: ${result.reason}`);
    p.outro("Nothing written.");
    return;
  }
  if (result.status === "failed") {
    p.log.error(`Seed drafting failed: ${result.reason}`);
    if (result.proposal) {
      p.log.message("  the last draft the engine ran:");
      console.log(`    ${result.proposal.seed.command}`);
      for (const line of result.proposal.scriptContent.split("\n").slice(0, 20)) {
        console.log(`    ${line}`);
      }
    }
    p.outro("Nothing written — the working tree is exactly as it was.");
    process.exit(1);
    return;
  }

  p.log.success(`wrote ${result.scriptPath} and patched ${result.recipePath}`);
  p.log.message(`  command     ${result.seed.command}`);
  for (const [name, fields] of Object.entries(result.seed.provides.fixtures ?? {})) {
    p.log.message(`  fixture     ${name} (${fields.join(", ")})`);
  }
  for (const [name, cred] of Object.entries(result.seed.provides.credentials ?? {})) {
    p.log.message(`  credential  ${name} → ${cred.header} (minted at run time)`);
  }
  p.log.message("");
  p.log.message("  Both artifacts are the model's work, verified by the engine: the script RAN,");
  p.log.message("  its manifest matched `provides`, and the server booted against what it left.");
  p.outro(
    `Review and commit BOTH (${result.scriptPath} and ${result.recipePath}), then re-run \`truecourse guard generate\` to author the blocked flows.`,
  );
}

/** The declared seed, as the terminal shows it. */
function printSeed(view: GuardSeedView, repoRoot: string): void {
  if (!view.seed) {
    p.log.warn(
      view.hasApiBlock
        ? "No seed yet — the recipe declares no `api.seed`."
        : "No seed yet — the recipe has no `api` block, so there is no api driver to seed for.",
    );
    return;
  }
  p.log.step(path.relative(repoRoot, view.recipePath) || view.recipePath);
  p.log.message(`  command     ${view.seed.command}`);
  if (view.scriptPath) {
    p.log.message(`  script      ${view.scriptPath}${view.scriptExists ? "" : "  ← MISSING on disk"}`);
  }
  for (const [name, fields] of Object.entries(view.seed.provides.fixtures ?? {})) {
    p.log.message(`  fixture     ${name} (${fields.join(", ")})`);
  }
  for (const [name, cred] of Object.entries(view.seed.provides.credentials ?? {})) {
    p.log.message(
      `  credential  ${name} → ${cred.header} (minted at run time)${cred.description ? ` — ${cred.description}` : ""}`,
    );
  }
  if (view.scriptPath && !view.scriptExists) {
    p.log.error(
      `${view.scriptPath} does not exist — every guard run will fail its seed stage until it is restored.`,
    );
  }
}

/** The flows the last generate could not author for want of rows. */
function printBlocked(view: GuardSeedView): void {
  if (view.blocked.length === 0) return;
  p.log.step(
    `${view.blocked.length} flow${view.blocked.length === 1 ? " is" : "s are"} blocked on missing data:`,
  );
  for (const b of view.blocked.slice(0, 10)) {
    console.log(`  • ${b.flow}`);
    console.log(`      needs: ${b.needs.join("; ")}`);
  }
  if (view.blocked.length > 10) console.log(`  … and ${view.blocked.length - 10} more`);
}

/** The last drafting attempt's verdict, straight off the generate report. */
function printLastDraft(view: GuardSeedView): void {
  const last = view.lastDraft;
  if (!last) return;
  if (last.status === "drafted") {
    p.log.info(`Last drafted by \`guard generate\`: ${last.scriptPath} (${last.command}).`);
    return;
  }
  p.log.info(
    `The last \`guard generate\` ${last.status === "failed" ? "could not draft a seed" : "drafted no seed"}: ${
      last.reason ?? "(no reason recorded)"
    }`,
  );
}
