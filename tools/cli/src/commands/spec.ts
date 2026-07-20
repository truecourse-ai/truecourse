/**
 * `truecourse spec <subcommand>` — Spec Consolidation Module surface.
 *
 *   scan      docs → curated corpus.json (areas + overlap flags)
 *   status    summary: docs, areas, open vs resolved overlaps
 *
 * Conflict resolution lives in `spec conflicts`.
 * Every command delegates the heavy lifting to
 * `@truecourse/core/commands/spec-in-process` so the CLI and the
 * dashboard server execute the same code path. The only thing the
 * CLI adds is a stdout step renderer; the dashboard server adds a
 * socket emitter.
 */

import * as p from "@clack/prompts";
import { readCorpus, readCorpusDecisions } from "@truecourse/spec-consolidator";
import { buildCorpusConflicts, openConflicts, orphanedConflictResolutions } from "@truecourse/shared";
import { LlmStageFailureError, type StageTransportTally } from "@truecourse/shared/llm";
import { StepTracker } from "@truecourse/core/progress";
import {
  curateInProcess,
  CURATE_STEPS,
  EstimateDeclined,
} from "@truecourse/core/commands/spec-in-process";
import { registerProject } from "@truecourse/core/config/registry";
import { createStdoutStepRenderer } from "../lib/stdout-step-renderer.js";
import { preflightLlmOrExit } from "../lib/claude-preflight.js";
import { promptLlmEstimate } from "./llm-prompt.js";
import { requireGitRepo } from "./git-guard.js";

export interface RunSpecOptions {
  cwd?: string;
  /** LLM transport for this run: `cli` (spawn `claude -p`), `agent` (mailbox under `io`), or `api`. */
  llm?: "cli" | "agent" | "api";
  /** I/O dir for the `agent` transport's request/response mailbox. */
  io?: string;
  /** Skip the pre-flight cost-estimate confirm (`--yes`). */
  yes?: boolean;
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
  await requireGitRepo(root);
  // Scan is the first command in the spec/contract pipeline — register the repo
  // so the corpus it produces is visible in the dashboard's project list.
  await registerProject(root);
  // The relevance + area-tag stages shell out to `claude`; an expired login would
  // fail every doc. Probe once up front — or, in API mode, validate the provider
  // config instead (the `agent` transport answers via the mailbox: neither applies).
  await preflightLlmOrExit(opts.llm);
  // Agent transport is headless (no TTY to confirm) → auto-approve the estimate.
  const autoApprove = !!opts.yes || opts.llm === "agent";
  const { renderer, tracker } = withTracker(CURATE_STEPS);
  const { curate, noChanges } = await curateInProcess(root, {
    tracker,
    source: "cli",
    llm: opts.llm,
    io: opts.io,
    onLlmEstimate: (est) => promptLlmEstimate(est, { autoApprove, nouns: { verb: "Scan" } }),
  }).catch((e: unknown) => {
    renderer.dispose();
    if (e instanceof EstimateDeclined) {
      p.cancel("Scan cancelled.");
      process.exit(0);
    }
    // A stage lost EVERY LLM call: the corpus its fail-open defaults would have
    // produced (all docs kept, no areas) is not a result, so the scan wrote nothing.
    if (e instanceof LlmStageFailureError) {
      p.log.error(`Scan aborted — ${e.message}`);
      p.log.step(
        `${stageLabel(e.tally.stage)} defaults would have been written as a healthy corpus, so nothing was written — the previous corpus.json is unchanged. Fix the LLM error above and re-run \`truecourse spec scan\`.`,
      );
      p.outro("Aborted.");
      process.exit(1);
    }
    p.cancel(`Failed: ${(e as Error).message}`);
    process.exit(1);
  });
  renderer.dispose();
  if (noChanges) {
    p.log.success("Nothing changed — no new or updated docs since the last scan; corpus is up to date.");
    p.outro("Done.");
    return;
  }
  const s = curate.stats;
  if (s.scopeGlobs.length > 0) {
    p.log.step(`scope       ${s.scopeGlobs.join(", ")} (config)`);
  }
  // Third-party is broken out of the drop count: an undifferentiated "N dropped"
  // is what hid a repo's entire API reference vanishing as "vendor" material.
  // `restored` is the regression detector — it should read 0.
  const thirdParty =
    s.thirdPartyDropped > 0
      ? ` (${s.thirdPartyDropped} third-party, ${s.thirdPartyRestored} restored)`
      : "";
  p.log.step(
    `docs        ${s.docsScanned} scanned · ${s.docsKept} kept · ${s.skippedDocs.length} dropped${thirdParty}`,
  );
  p.log.step(`areas       ${s.areaCount}`);
  p.log.step(`overlaps    ${s.overlapFlags}`);
  printLlmFailures(s.llmFailures);
  if (s.outOfScopeManualIncludes.length > 0) {
    p.log.warn("Manual includes outside spec.include (never discovered — widen the scope to pick them up):");
    for (const inc of s.outOfScopeManualIncludes) p.log.message(`  • ${inc}`);
  }
  // Open conflicts via the SAME resolved-derivation the gate uses (a flagged
  // overlap already verdicted/dismissed/excluded is not open). Point at guard
  // generate — the contracts pipeline is deprecated.
  const open = openConflicts(curate.corpus, curate.decisions);
  if (open.length > 0) {
    p.log.message("");
    p.log.message("Open overlaps (two docs may disagree — pick a side or dismiss with `spec conflicts resolve`):");
    for (const o of open.slice(0, 10)) {
      p.log.message(`  • ${o.area}:  ${o.a}  ↔  ${o.b}`);
    }
    if (open.length > 10) {
      p.log.message(`  … (+${open.length - 10} more)`);
    }
  }
  const openCount = open.length;
  const conflictTail =
    openCount === 0
      ? ""
      : ` ${openCount} conflict${openCount === 1 ? "" : "s"} to resolve (\`truecourse spec conflicts list\`), then \`truecourse guard generate\`.`;
  // A scan that lost calls wrote a corpus, but not a complete one — never close on
  // an unqualified success line (a re-run retries only the failed docs).
  const lost = s.llmFailures.reduce((n, f) => n + f.failures, 0);
  if (lost > 0) {
    p.outro(
      `Corpus written to .truecourse/specs/corpus.json — INCOMPLETE: ${lost} LLM call${lost === 1 ? "" : "s"} failed; re-run to fill the gaps.${conflictTail}`,
    );
    return;
  }
  p.outro(
    openCount === 0
      ? "Corpus written to .truecourse/specs/corpus.json. Run `truecourse guard generate`."
      : `Corpus written to .truecourse/specs/corpus.json.${conflictTail}`,
  );
}

/**
 * Per-stage LLM failure lines for a run that completed anyway: what fraction of the
 * stage's calls were lost, what the stage's fail-open default did to the affected
 * items, and the first underlying error (the WHY — e.g. a rejected request schema).
 * A recovered failure is still a defect, so it is never summarized away.
 */
function printLlmFailures(failures: readonly StageTransportTally[]): void {
  if (failures.length === 0) return;
  p.log.warn("LLM calls failed — the results above are incomplete:");
  for (const f of failures) {
    p.log.message(`  • ${stageLabel(f.stage)}: ${f.failures} of ${f.attempts} calls failed — ${SCAN_STAGE_EFFECT[f.stage] ?? "affected items skipped"}`);
    if (f.firstError) p.log.message(`    first failure: ${f.firstError}`);
  }
}

/** The scan stage's short name, for a line that reads as prose. */
function stageLabel(stage: string): string {
  return SCAN_STAGE_LABEL[stage] ?? stage;
}

const SCAN_STAGE_LABEL: Record<string, string> = {
  "spec.relevance": "relevance",
  "spec.areaTag": "area tags",
  "spec.vocab": "vocabulary",
  "spec.overlap": "overlap",
  "spec.verifyOverlap": "overlap verify",
};

/** What each stage's per-item fail-open default did to the calls it lost. */
const SCAN_STAGE_EFFECT: Record<string, string> = {
  "spec.relevance": "affected docs kept by default",
  "spec.areaTag": "affected docs left untagged (they join no area)",
  "spec.vocab": "area names left un-normalized",
  "spec.overlap": "affected doc pairs left unflagged",
  "spec.verifyOverlap": "affected flags kept as conflicts",
};


// ---------------------------------------------------------------------------
// status — a pure read of corpus.json + decisions.json (no LLM, no re-scan)
// ---------------------------------------------------------------------------

export async function runSpecStatus(opts: RunSpecOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  p.intro("Spec status");
  const corpus = readCorpus(root);
  if (!corpus) {
    p.log.warn("No corpus — run `truecourse spec scan`.");
    p.outro("");
    return;
  }
  const decisions = readCorpusDecisions(root);
  const conflicts = buildCorpusConflicts(corpus, decisions);
  const open = conflicts.filter((c) => !c.resolved).length;
  const resolved = conflicts.length - open;

  const rows: Array<[string, string]> = [
    ["Docs (kept)", String(corpus.docs.length)],
    ["Areas", String(corpus.areas.length)],
    ["Overlaps", `${open} open · ${resolved} resolved`],
    ["Manual includes", String((decisions.manualIncludes ?? []).length)],
  ];
  for (const [k, v] of rows) p.log.step(`${k.padEnd(28)} ${v}`);

  p.log.message("");
  for (const area of corpus.areas) {
    const ov = area.overlaps.length ? ` · ${area.overlaps.length} overlap${area.overlaps.length === 1 ? "" : "s"}` : "";
    p.log.message(`  ${area.id.padEnd(30)} ${area.docRefs.length} doc${area.docRefs.length === 1 ? "" : "s"}${ov}`);
  }

  // Orphan honesty: a recorded section-scoped verdict that no longer matches a
  // flagged conflict (the docs changed) is surfaced, never silently honored.
  const orphaned = orphanedConflictResolutions(corpus, decisions);
  if (orphaned.length > 0) {
    p.log.message("");
    p.log.warn(
      `${orphaned.length} orphaned conflict resolution${orphaned.length === 1 ? "" : "s"} (no longer match a flagged dispute — review with \`spec conflicts list\`):`,
    );
    for (const o of orphaned.slice(0, 10)) p.log.message(`  • ${o.docA}  ↔  ${o.docB}  (${o.verdict})`);
  }

  p.outro(
    open === 0
      ? "No open overlaps — run `truecourse guard generate`."
      : "Open overlaps — see `truecourse spec conflicts list`.",
  );
}

