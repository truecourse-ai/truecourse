/**
 * `truecourse spec <subcommand>` — Spec Consolidation Module surface.
 *
 *   scan      docs → claims → conflicts; reports what's pending
 *   resolve   batch-apply default picks (CLI fast-path; the dashboard
 *             is the primary review surface per Q8)
 *   apply     write `.truecourse/spec/` from current decisions
 *   status    summary: docs walked, claims, modules, pending vs decided
 *   diff      docs vs current canonical — what would change on apply
 *
 * Every command delegates the heavy lifting to
 * `@truecourse/core/commands/spec-in-process` so the CLI and the
 * dashboard server execute the same code path. The only thing the
 * CLI adds is a stdout step renderer; the dashboard server adds a
 * socket emitter. Scan-state persistence, decision writes, and IL
 * chaining live in core.
 */

import * as p from "@clack/prompts";
import path from "node:path";
import {
  specRootPath,
  type Conflict,
} from "@truecourse/spec-consolidator";
import { StepTracker } from "@truecourse/core/progress";
import {
  applyInProcess,
  APPLY_STEPS,
  RESOLVE_STEPS,
  resolveAllDefaultsInProcess,
  scanInProcess,
  SCAN_STEPS,
  verifyInProcess,
  VERIFY_STEPS,
} from "@truecourse/core/commands/spec-in-process";
import { createStdoutStepRenderer } from "../lib/stdout-step-renderer.js";

export interface RunSpecOptions {
  cwd?: string;
}

const repoRoot = (opts: RunSpecOptions = {}): string => opts.cwd ?? process.cwd();

function withTracker(stepDefs: readonly { key: string; label: string }[]) {
  const renderer = createStdoutStepRenderer();
  const tracker = new StepTracker(renderer.onProgress, stepDefs.map((s) => ({ ...s })));
  return { renderer, tracker };
}

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

export async function runSpecScan(opts: RunSpecOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  p.intro("Spec scan");
  const { renderer, tracker } = withTracker(SCAN_STEPS);
  try {
    const { consolidate } = await scanInProcess(root, { tracker });
    renderer.dispose();
    const { extract, merge } = consolidate;
    p.log.step(`docs        ${extract.docsScanned}`);
    p.log.step(`blocks      ${extract.blocksAttempted}  (${extract.failures.length} failures)`);
    p.log.step(`claims      ${extract.claims.length}`);
    p.log.step(`resolved    ${merge.resolvedClaims.length}`);
    p.log.step(`decided     ${merge.decidedConflicts.length}`);
    p.log.step(`open        ${merge.openConflicts.length}`);

    if (merge.openConflicts.length > 0) {
      p.log.message("");
      p.log.message("Open conflicts:");
      for (const c of merge.openConflicts.slice(0, 10)) {
        p.log.message(`  • ${c.subject}  (${c.candidates.length} candidates, default: ${c.candidates[c.defaultPick].claim.provenance.file})`);
      }
      if (merge.openConflicts.length > 10) {
        p.log.message(`  … (+${merge.openConflicts.length - 10} more)`);
      }
      p.log.message("");
      p.log.message("Resolve in the dashboard, or run `truecourse spec resolve --all-defaults`.");
    }
    p.outro(merge.openConflicts.length === 0 ? "No open conflicts." : `${merge.openConflicts.length} open.`);
  } catch (e) {
    renderer.dispose();
    p.cancel(`Failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// resolve --all-defaults  (CLI batch op; dashboard is primary review per Q8)
// ---------------------------------------------------------------------------

export interface RunSpecResolveOptions extends RunSpecOptions {
  /** Accept the engine's pre-pick on every open conflict. */
  allDefaults?: boolean;
}

export async function runSpecResolve(opts: RunSpecResolveOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  if (!opts.allDefaults) {
    p.intro("Spec resolve");
    p.log.warn("Interactive resolve runs in the dashboard.");
    p.log.message("CLI fast-path: pass --all-defaults to accept every engine pre-pick.");
    p.outro("");
    return;
  }

  p.intro("Spec resolve — accepting all defaults");
  const { renderer, tracker } = withTracker(RESOLVE_STEPS);
  try {
    const { additions } = await resolveAllDefaultsInProcess(root, { tracker });
    renderer.dispose();
    p.log.step(`accepted    ${additions} default${additions === 1 ? "" : "s"}`);
    p.log.step(`written     ${path.relative(root, decisionsRelPath(root))}`);
    p.outro(
      additions === 0
        ? "Nothing to resolve."
        : "Done. Run `truecourse spec apply` to write the canonical spec.",
    );
  } catch (e) {
    renderer.dispose();
    p.cancel(`Failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

export async function runSpecApply(opts: RunSpecOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  p.intro("Spec apply");
  const { renderer, tracker } = withTracker(APPLY_STEPS);
  try {
    const { consolidate } = await applyInProcess(root, { tracker });
    renderer.dispose();

    if (consolidate.merge.openConflicts.length > 0) {
      p.log.warn(
        `${consolidate.merge.openConflicts.length} open conflicts remain — partial canonical written.`,
      );
      p.log.message("Resolve them in the dashboard or via `spec resolve --all-defaults`, then re-apply.");
    }

    if (consolidate.materialize) {
      p.log.step(
        `written     ${consolidate.materialize.written.length} files under ${path.relative(root, specRootPath(root))}`,
      );
      if (consolidate.materialize.failures.length > 0) {
        p.log.warn(`failures    ${consolidate.materialize.failures.length}`);
        for (const f of consolidate.materialize.failures.slice(0, 5)) {
          p.log.message(`  • ${f.section.module}/${f.section.fileName}: ${f.error}`);
        }
      }
    }

    if (
      consolidate.merge.openConflicts.length === 0 &&
      (consolidate.materialize?.failures.length ?? 0) === 0
    ) {
      p.outro("Canonical spec up to date. Run `truecourse contracts generate` to extract TC contracts.");
    } else {
      p.outro("Partial — resolve remaining conflicts.");
    }
  } catch (e) {
    renderer.dispose();
    p.cancel(`Failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function runSpecStatus(opts: RunSpecOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  p.intro("Spec status");
  const { renderer, tracker } = withTracker(SCAN_STEPS);
  try {
    const { consolidate } = await scanInProcess(root, { tracker });
    renderer.dispose();
    const { extract, merge } = consolidate;
    const rows: Array<[string, string]> = [
      ["Docs scanned", String(extract.docsScanned)],
      ["Claims extracted", String(extract.claims.length)],
      ["Resolved (singletons + auto-merged)", String(merge.resolvedClaims.length)],
      ["Decided (user-resolved)", String(merge.decidedConflicts.length)],
      ["Open (pending decision)", String(merge.openConflicts.length)],
    ];
    for (const [k, v] of rows) p.log.step(`${k.padEnd(38)} ${v}`);

    if (merge.openConflicts.length > 0) {
      p.log.message("");
      summarizeConflicts("Open", merge.openConflicts);
    }
    p.outro(merge.openConflicts.length === 0 ? "Up to date." : "Pending decisions.");
  } catch (e) {
    renderer.dispose();
    p.cancel(`Failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// diff (docs vs current canonical)
// ---------------------------------------------------------------------------

export async function runSpecDiff(opts: RunSpecOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  p.intro("Spec diff");

  // Run apply in dry-run mode — we materialize against a tmp dir to
  // see what content would be written, then compare to the on-disk
  // canonical. Since the materializer overwrites, the cleanest dry
  // run is to scan + show the conflict delta vs decisions.json.
  const { renderer, tracker } = withTracker(SCAN_STEPS);
  try {
    const { consolidate } = await scanInProcess(root, { tracker });
    renderer.dispose();
    const { merge } = consolidate;
    if (merge.openConflicts.length === 0) {
      p.log.success("No drift — every claim is decided or resolved.");
      p.outro("Up to date.");
      return;
    }
    p.log.warn(`${merge.openConflicts.length} open conflicts.`);
    summarizeConflicts("Pending", merge.openConflicts);
    p.outro("Resolve and re-apply to update the canonical spec.");
  } catch (e) {
    renderer.dispose();
    p.cancel(`Failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------

export interface RunVerifyOptions extends RunSpecOptions {
  /** Override the code dir (default: auto-detect repo/code or repoRoot). */
  codeDir?: string;
}

export async function runVerify(opts: RunVerifyOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  p.intro("Verify");
  const { renderer, tracker } = withTracker(VERIFY_STEPS);
  try {
    const { verify } = await verifyInProcess(root, { tracker, codeDir: opts.codeDir });
    renderer.dispose();

    p.log.step(`artifacts   ${verify.artifactCount}`);
    p.log.step(`operations  ${verify.extractedOperationCount}  (extracted from code)`);
    p.log.step(`drifts      ${verify.drifts.length}`);

    if (verify.unresolvedRefs.length > 0) {
      p.log.warn(`unresolved  ${verify.unresolvedRefs.length} reference${verify.unresolvedRefs.length === 1 ? "" : "s"}`);
      for (const ref of verify.unresolvedRefs.slice(0, 5)) {
        p.log.message(`  • ${ref}`);
      }
    }

    if (verify.drifts.length > 0) {
      p.log.message("");
      p.log.message("Drifts:");
      for (const d of verify.drifts.slice(0, 20)) {
        const loc = d.filePath
          ? ` ${path.relative(root, d.filePath)}:${d.lineStart ?? "?"}`
          : "";
        p.log.message(`  [${d.severity}] ${d.obligationKey}${loc}`);
        p.log.message(`    → ${d.message}`);
      }
      if (verify.drifts.length > 20) {
        p.log.message(`  … (+${verify.drifts.length - 20} more)`);
      }
    }

    p.outro(
      verify.drifts.length === 0
        ? "No drift detected."
        : `${verify.drifts.length} drift item${verify.drifts.length === 1 ? "" : "s"} — review the list above.`,
    );
  } catch (e) {
    renderer.dispose();
    p.cancel(`Failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function summarizeConflicts(label: string, conflicts: Conflict[]): void {
  p.log.message(`${label}:`);
  for (const c of conflicts.slice(0, 10)) {
    p.log.message(`  • ${c.topic}/${c.subject}  (${c.candidates.length} candidates)`);
  }
  if (conflicts.length > 10) {
    p.log.message(`  … (+${conflicts.length - 10} more)`);
  }
}

function decisionsRelPath(root: string): string {
  return path.join(root, ".truecourse", "spec", "decisions.json");
}
