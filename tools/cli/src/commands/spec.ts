/**
 * `truecourse spec <subcommand>` — Spec Consolidation Module surface.
 *
 *   scan      docs → claims → conflicts → claims.json
 *   resolve   batch-apply default picks (CLI fast-path; the dashboard
 *             is the primary review surface per Q8)
 *   status    summary: docs walked, claims, modules, pending vs decided
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
import { type Conflict } from "@truecourse/spec-consolidator";
import { StepTracker } from "@truecourse/core/progress";
import {
  RESOLVE_STEPS,
  resolveAllDefaultsInProcess,
  scanInProcess,
  SCAN_STEPS,
  verifyInProcess,
  verifyDiffInProcess,
  VERIFY_STEPS,
  inferInProcess,
  INFER_STEPS,
} from "@truecourse/core/commands/spec-in-process";
import { createStdoutStepRenderer } from "../lib/stdout-step-renderer.js";
import { resolveStashDecision } from "./analyze.js";
import { requireGitRepo } from "./git-guard.js";

export interface RunSpecOptions {
  cwd?: string;
  /** LLM transport: `cli` (default, spawn `claude -p`) or `agent` (filesystem mailbox under `io`). */
  llm?: "cli" | "agent";
  /** I/O dir for the `agent` transport's request/response mailbox. */
  io?: string;
}

const repoRoot = (opts: RunSpecOptions = {}): string => opts.cwd ?? process.cwd();

function withTracker(stepDefs: readonly { key: string; label: string }[]) {
  const renderer = createStdoutStepRenderer();
  const tracker = new StepTracker(renderer.onProgress, stepDefs.map((s) => ({ ...s })));
  return { renderer, tracker };
}

type ScanExtractSummary = {
  blocksAttempted: number;
  failures: Array<{ block: { filePath: string; headingPath: string[] }; error: string }>;
  claims: unknown[];
};

export function totalExtractionFailure(extract: ScanExtractSummary): boolean {
  return extract.blocksAttempted > 0
    && extract.claims.length === 0
    && extract.failures.length === extract.blocksAttempted;
}

export function scanSuccessOutro(claimCount: number, openConflictCount: number): string {
  if (openConflictCount > 0) return `${openConflictCount} open.`;
  if (claimCount === 0) return "No claims extracted.";
  return "No open conflicts — run `truecourse contracts generate`.";
}

export function representativeExtractionFailures(
  failures: ScanExtractSummary['failures'],
  limit = 3,
): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const failure of failures) {
    const location = `${failure.block.filePath} :: ${failure.block.headingPath.join(" → ")}`;
    const line = `${location}\n    → ${failure.error}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= limit) break;
  }

  return lines;
}

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

export async function runSpecScan(opts: RunSpecOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  p.intro("Spec scan");
  await requireGitRepo(root);
  const { renderer, tracker } = withTracker(SCAN_STEPS);
  try {
    const { consolidate } = await scanInProcess(root, { tracker, source: "cli", llm: opts.llm, io: opts.io });
    renderer.dispose();
    const { extract, merge } = consolidate;
    p.log.step(`docs        ${extract.docsScanned}`);
    p.log.step(`blocks      ${extract.blocksAttempted}  (${extract.failures.length} failures)`);
    p.log.step(`claims      ${extract.claims.length}`);
    p.log.step(`resolved    ${merge.resolvedClaims.length}`);
    p.log.step(`decided     ${merge.decidedConflicts.length}`);
    p.log.step(`open        ${merge.openConflicts.length}`);

    if (totalExtractionFailure(extract)) {
      p.log.error(
        `All ${extract.blocksAttempted} block extraction${extract.blocksAttempted === 1 ? "" : "s"} failed; no claims were produced.`,
      );
      for (const line of representativeExtractionFailures(extract.failures)) {
        console.log(`  ${line}`);
      }
      if (extract.failures.length > 3) {
        console.log(`  … and ${extract.failures.length - 3} more failure${extract.failures.length - 3 === 1 ? "" : "s"}`);
      }
      p.outro("Aborted. Fix extraction before generating contracts.");
      process.exit(1);
    }

    if (merge.openConflicts.length > 0) {
      p.log.message("");
      p.log.message("Open conflicts:");
      for (const c of merge.openConflicts.slice(0, 10)) {
        p.log.message(`  • ${c.subject}  (${c.candidates.length} candidates, default: ${c.candidates[c.defaultPick].claim.provenance.file})`);
        p.log.message(`    id: ${c.id}`);
      }
      if (merge.openConflicts.length > 10) {
        p.log.message(`  … (+${merge.openConflicts.length - 10} more — run \`truecourse spec conflicts list\`)`);
      }
      p.log.message("");
      p.log.message("Resolve them:");
      p.log.message("  • dashboard:        truecourse dashboard            (Spec tab)");
      p.log.message("  • per conflict:     truecourse spec conflicts show <id>");
      p.log.message("                      truecourse spec conflicts pick <id> <candidateIndex>");
      p.log.message('                      truecourse spec conflicts custom <id> --text "…"');
      p.log.message("  • accept defaults:  truecourse spec resolve --all-defaults");
    }
    p.outro(scanSuccessOutro(extract.claims.length, merge.openConflicts.length));
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
  await requireGitRepo(root);
  const { renderer, tracker } = withTracker(RESOLVE_STEPS);
  try {
    const { additions } = await resolveAllDefaultsInProcess(root, { tracker, llm: opts.llm, io: opts.io });
    renderer.dispose();
    p.log.step(`accepted    ${additions} default${additions === 1 ? "" : "s"}`);
    p.log.step(`written     ${path.relative(root, decisionsRelPath(root))}`);
    p.outro(
      additions === 0
        ? "Nothing to resolve."
        : "Done. Run `truecourse contracts generate` to produce TC contracts.",
    );
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
    const { consolidate } = await scanInProcess(root, { tracker, llm: opts.llm, io: opts.io });
    renderer.dispose();
    const { extract, merge, skippedDocs } = consolidate;
    const rows: Array<[string, string]> = [
      ["Docs scanned", String(extract.docsScanned)],
      ["Claims extracted", String(extract.claims.length)],
      ["Resolved (singletons + auto-merged)", String(merge.resolvedClaims.length)],
      ["Decided (user-resolved)", String(merge.decidedConflicts.length)],
      ["Open (pending decision)", String(merge.openConflicts.length)],
      ["Skipped docs", String(skippedDocs?.length ?? 0)],
    ];
    for (const [k, v] of rows) p.log.step(`${k.padEnd(38)} ${v}`);

    if (merge.openConflicts.length > 0) {
      p.log.message("");
      summarizeConflicts("Open", merge.openConflicts);
    }
    p.outro(
      merge.openConflicts.length === 0
        ? "Up to date — run `truecourse contracts generate`."
        : "Pending decisions — see `truecourse spec conflicts list`.",
    );
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
  /** Diff the working tree's drifts against the committed LATEST baseline. */
  diff?: boolean;
  /** Stash decision: true → stash, false → no-stash, undefined → prompt. */
  stash?: boolean;
}

export async function runVerify(opts: RunVerifyOptions = {}): Promise<void> {
  if (opts.diff) return runVerifyDiff(opts);
  const root = repoRoot(opts);
  // Like `analyze`, a full verify stashes the dirty tree (after confirmation)
  // so the baseline reflects the committed state.
  const { skipStash } = await resolveStashDecision({ stash: opts.stash }, root);
  p.intro("Verify");
  await requireGitRepo(root);
  const { renderer, tracker } = withTracker(VERIFY_STEPS);
  try {
    const { verify } = await verifyInProcess(root, { tracker, codeDir: opts.codeDir, skipStash, source: "cli" });
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
        p.log.message(
          `  … (+${verify.drifts.length - 20} more) — run \`truecourse drifts list --all\` to see them all.`,
        );
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

async function runVerifyDiff(opts: RunVerifyOptions): Promise<void> {
  const root = repoRoot(opts);
  p.intro("Verify diff");
  await requireGitRepo(root);
  const { renderer, tracker } = withTracker(VERIFY_STEPS);
  try {
    const { diff } = await verifyDiffInProcess(root, { tracker, codeDir: opts.codeDir, source: "cli" });
    renderer.dispose();

    p.log.step(`added       ${diff.summary.added}`);
    p.log.step(`resolved    ${diff.summary.resolved}`);
    p.log.step(`unchanged   ${diff.summary.unchanged}`);

    const list = (label: string, drifts: typeof diff.added) => {
      if (drifts.length === 0) return;
      p.log.message("");
      p.log.message(`${label}:`);
      for (const d of drifts.slice(0, 20)) {
        const loc = d.filePath ? ` ${path.relative(root, d.filePath)}:${d.lineStart ?? "?"}` : "";
        p.log.message(`  [${d.severity}] ${d.obligationKey}${loc}`);
      }
      if (drifts.length > 20) p.log.message(`  … (+${drifts.length - 20} more)`);
    };
    list("Added", diff.added);
    list("Resolved", diff.resolved);

    p.outro(
      diff.summary.added === 0
        ? `No new drift vs baseline (${diff.summary.resolved} resolved).`
        : `${diff.summary.added} new drift${diff.summary.added === 1 ? "" : "s"} vs baseline.`,
    );
  } catch (e) {
    renderer.dispose();
    p.cancel(`Failed: ${(e as Error).message}`);
  }
}


// ---------------------------------------------------------------------------
// infer
// ---------------------------------------------------------------------------

export interface RunInferOptions extends RunSpecOptions {
  /** Override the code dir (default: auto-detect repo/code or repoRoot). */
  codeDir?: string;
  /** Report what would be written without touching disk. */
  dryRun?: boolean;
}

export async function runInfer(opts: RunInferOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  p.intro("Infer");
  await requireGitRepo(root);
  const { renderer, tracker } = withTracker(INFER_STEPS);
  try {
    const { infer, written, proposed } = await inferInProcess(root, {
      tracker,
      codeDir: opts.codeDir,
      dryRun: opts.dryRun,
      source: "cli",
    });
    renderer.dispose();

    const byKind = new Map<string, number>();
    for (const d of infer.decisions) byKind.set(d.kind, (byKind.get(d.kind) ?? 0) + 1);

    p.log.step(`decisions   ${infer.decisions.length} undocumented`);
    for (const [kind, n] of [...byKind].sort()) p.log.message(`  ${kind}  ${n}`);

    if (infer.decisions.length > 0) {
      p.log.message("");
      p.log.message("Inferred:");
      for (const d of infer.decisions.slice(0, 20)) {
        const loc = `${d.codeLoc.path}:${d.codeLoc.lines[0]}`;
        p.log.message(`  [${d.confidence}] ${d.kind}:${d.identity}  ${loc}`);
      }
      if (infer.decisions.length > 20) {
        p.log.message(`  … (+${infer.decisions.length - 20} more)`);
      }
    }

    const wrote = opts.dryRun ? proposed.length : written.length;
    p.outro(
      infer.decisions.length === 0
        ? "No undocumented decisions found."
        : opts.dryRun
          ? `${wrote} inferred contract${wrote === 1 ? "" : "s"} would be written to _inferred/ (dry run).`
          : `${wrote} inferred contract${wrote === 1 ? "" : "s"} written to _inferred/ — review with \`truecourse contracts list --inferred\`.`,
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
  return path.join(root, ".truecourse", "specs", "decisions.json");
}
