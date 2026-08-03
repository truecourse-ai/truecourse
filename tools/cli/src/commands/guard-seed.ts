/**
 * `truecourse guard seed` — the database seed, READ-ONLY.
 *
 *   guard seed   print `api.seed` as the runner loads it, the script file it names,
 *                and the flows still blocked on missing data
 *
 * Drafting used to live here (`--init`). It moved into `truecourse guard setup`,
 * which drafts ONE artifact covering both the rows and the authenticated principals
 * — and does it BEFORE the first generate, because patching `api.seed` moves the
 * recipe fingerprint and re-authors every section generated against it.
 */

import path from "node:path";
import * as p from "@clack/prompts";
import {
  readGuardSeedView,
  type GuardSeedView,
} from "@truecourse/core/commands/guard-seed";

export interface RunGuardSeedOptions {
  cwd?: string;
  /**
   * Accepted so the removed write flag fails LOUDLY rather than as an unknown
   * option — a script still passing `--init` is told where drafting went.
   */
  init?: boolean;
}

export async function runGuardSeed(opts: RunGuardSeedOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Guard seed");

  const view = readGuardSeedView(repoRoot);
  const rel = path.relative(repoRoot, view.recipePath) || view.recipePath;

  if (opts.init) {
    p.log.error(
      "`guard seed --init` is gone — `truecourse guard setup` drafts the seed, before the first (expensive) generate.",
    );
    p.log.message(
      "  Setup writes ONE script covering both the rows and the authenticated principals, then RUNS it to prove it works.",
    );
    p.outro("Run `truecourse guard setup`.");
    process.exit(1);
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

  if (view.seed) {
    p.outro(
      "The seed is yours to edit — `truecourse guard setup --refresh` replaces it, and asks first.",
    );
    return;
  }
  p.outro("Draft one with `truecourse guard setup`.");
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
