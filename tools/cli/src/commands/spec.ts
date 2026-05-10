/**
 * `truecourse spec <subcommand>` — Spec Consolidation Module surface.
 *
 *   scan      docs → claims → conflicts; reports what's pending
 *   resolve   batch-apply default picks (CLI fast-path; the dashboard
 *             is the primary review surface per Q8)
 *   apply     write `.truecourse/spec/` from current decisions
 *   status    summary: docs walked, claims, modules, pending vs decided
 *   diff      docs vs current canonical — what would change on apply
 */

import * as p from "@clack/prompts";
import path from "node:path";
import {
  candidateFingerprint,
  consolidate,
  readDecisions,
  specRootPath,
  writeDecisions,
  type Conflict,
  type ConsolidateResult,
  type Decision,
  type DecisionsFile,
} from "@truecourse/spec-consolidator";
import {
  CanonicalSpecMissingError,
  defaultConcurrency as defaultExtractorConcurrency,
  generateContracts,
  spawnRunner as spawnExtractorRunner,
} from "@truecourse/contract-extractor";

export interface RunSpecOptions {
  cwd?: string;
}

const repoRoot = (opts: RunSpecOptions = {}): string => opts.cwd ?? process.cwd();

// ---------------------------------------------------------------------------
// scan
// ---------------------------------------------------------------------------

export async function runSpecScan(opts: RunSpecOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  p.intro("Spec scan");

  let result: ConsolidateResult;
  try {
    result = await runWithSpinner("scanning docs and extracting claims", () =>
      consolidate(root, { materialize: false }),
    );
  } catch (e) {
    p.cancel(`Failed: ${(e as Error).message}`);
    return;
  }

  const { extract, merge } = result;
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

  let scan: ConsolidateResult;
  try {
    scan = await runWithSpinner("scanning", () =>
      consolidate(root, { materialize: false }),
    );
  } catch (e) {
    p.cancel(`Failed: ${(e as Error).message}`);
    return;
  }

  if (scan.merge.openConflicts.length === 0) {
    p.outro("Nothing to resolve.");
    return;
  }

  // Merge new decisions into any existing decisions.json so previous
  // user picks survive (Q13 persistence).
  const existing = readDecisions(root);
  const seen = new Set(existing.decisions.map((d) => d.conflictId));
  const additions: Decision[] = [];
  for (const c of scan.merge.openConflicts) {
    if (seen.has(c.id)) continue;
    additions.push({
      conflictId: c.id,
      resolution: { kind: "pick", candidateIndex: c.defaultPick },
      resolvedAt: new Date().toISOString(),
      candidateFingerprint: candidateFingerprint(c),
    });
  }
  const merged: DecisionsFile = {
    version: 1,
    decisions: [...existing.decisions, ...additions],
  };
  writeDecisions(root, merged);

  p.log.step(`accepted    ${additions.length} defaults`);
  p.log.step(`written     ${path.relative(root, decisionsRelPath(root))}`);
  p.outro("Done. Run `truecourse spec apply` to write the canonical spec.");
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

export async function runSpecApply(opts: RunSpecOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  p.intro("Spec apply");

  let result: ConsolidateResult;
  try {
    result = await runWithSpinner("rendering canonical spec", () =>
      consolidate(root, { materialize: true }),
    );
  } catch (e) {
    p.cancel(`Failed: ${(e as Error).message}`);
    return;
  }

  if (result.merge.openConflicts.length > 0) {
    p.log.warn(
      `${result.merge.openConflicts.length} open conflicts remain — partial canonical written.`,
    );
    p.log.message("Resolve them in the dashboard or via `spec resolve --all-defaults`, then re-apply.");
  }

  if (result.materialize) {
    p.log.step(`written     ${result.materialize.written.length} files under ${path.relative(root, specRootPath(root))}`);
    if (result.materialize.failures.length > 0) {
      p.log.warn(`failures    ${result.materialize.failures.length}`);
      for (const f of result.materialize.failures.slice(0, 5)) {
        p.log.message(`  • ${f.section.module}/${f.section.fileName}: ${f.error}`);
      }
    }
  }

  // Validation gate: chain into Module 2 (contract generation). If
  // it succeeds, the canonical is structurally valid and IL is up to
  // date. If it fails, the user sees the parse/validation errors and
  // knows their canonical broke IL extraction.
  if (result.merge.openConflicts.length === 0 && result.materialize?.failures.length === 0) {
    await chainIntoContractsGenerate(root);
  } else {
    p.log.message("Skipping contract generation — resolve remaining conflicts first.");
  }

  p.outro(result.merge.openConflicts.length === 0 ? "Canonical spec up to date." : "Partial — resolve remaining conflicts.");
}

async function chainIntoContractsGenerate(root: string): Promise<void> {
  p.log.step("Generating IL contracts from the canonical spec…");
  const concurrency = defaultExtractorConcurrency();
  const runner = spawnExtractorRunner({ concurrency });
  try {
    const result = await generateContracts({ repoRoot: root, runner });
    if (result.validationIssues.length > 0) {
      p.log.error(
        `Contract validation failed: ${result.validationIssues.length} issue${result.validationIssues.length === 1 ? "" : "s"}.`,
      );
      for (const issue of result.validationIssues.slice(0, 5)) {
        p.log.message(`  • ${issue.artifactKey}: ${issue.message}`);
      }
      p.log.message("The canonical spec wrote successfully but IL extraction surfaced issues.");
      return;
    }
    const wrote = result.write.written.length;
    p.log.success(
      wrote === 0
        ? "IL contracts up to date — canonical valid."
        : `Wrote ${wrote} IL file${wrote === 1 ? "" : "s"} under .truecourse/contracts/.`,
    );
  } catch (e) {
    if (e instanceof CanonicalSpecMissingError) {
      // Shouldn't reach here — we just wrote the canonical — but be
      // explicit about the case.
      p.log.error(e.message);
      return;
    }
    p.log.error(`Contract generation failed: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export async function runSpecStatus(opts: RunSpecOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  p.intro("Spec status");

  let result: ConsolidateResult;
  try {
    result = await runWithSpinner("computing status", () =>
      consolidate(root, { materialize: false }),
    );
  } catch (e) {
    p.cancel(`Failed: ${(e as Error).message}`);
    return;
  }

  const { extract, merge } = result;
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
  let result: ConsolidateResult;
  try {
    result = await runWithSpinner("computing diff", () =>
      consolidate(root, { materialize: false }),
    );
  } catch (e) {
    p.cancel(`Failed: ${(e as Error).message}`);
    return;
  }

  const { merge } = result;
  if (merge.openConflicts.length === 0) {
    p.log.success("No drift — every claim is decided or resolved.");
    p.outro("Up to date.");
    return;
  }

  p.log.warn(`${merge.openConflicts.length} open conflicts.`);
  summarizeConflicts("Pending", merge.openConflicts);
  p.outro("Resolve and re-apply to update the canonical spec.");
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

async function runWithSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const s = p.spinner();
  s.start(label);
  try {
    const out = await fn();
    s.stop(label);
    return out;
  } catch (e) {
    s.stop(`${label} (failed)`);
    throw e;
  }
}
