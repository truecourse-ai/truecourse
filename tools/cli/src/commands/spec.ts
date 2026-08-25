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
import { buildCorpusConflicts, dormantResolutionForPair, openConflicts, orphanedConflictResolutions } from "@truecourse/shared";
import { LlmStageFailureError, type StageTransportTally } from "@truecourse/shared/llm";
import { StepTracker } from "@truecourse/core/progress";
import {
  curateInProcess,
  CURATE_STEPS,
  EstimateDeclined,
  ScanStepNotReadyError,
  type ScanStep,
} from "@truecourse/core/commands/spec-in-process";
import { registerProject } from "@truecourse/core/config/registry";
import { createStdoutStepRenderer } from "../lib/stdout-step-renderer.js";
import { preflightLlmOrExit } from "../lib/claude-preflight.js";
import { estimateSpinnerPhase, promptLlmEstimate } from "./llm-prompt.js";
import { requireGitRepo } from "./git-guard.js";
import { activityUrl, printWatchLive, resolveDashboardUrl } from "./helpers.js";

export interface RunSpecOptions {
  cwd?: string;
  /** LLM transport for this run: `cli` (spawn `claude -p`), `agent` (mailbox under `io`), or `api`. */
  llm?: "cli" | "agent" | "api";
  /** I/O dir for the `agent` transport's request/response mailbox. */
  io?: string;
  /** Skip the pre-flight cost-estimate confirm (`--yes`). */
  yes?: boolean;
  /** Emit raw JSON to stdout with zero clack/TUI decoration (`status` only). */
  json?: boolean;
  /**
   * Single-step mode (`--only-<step>`): run one scan step's sessions in
   * isolation — prior steps replay from their stored artifacts (a missing one
   * aborts loudly), later steps never start. Only `overlap` writes corpus.json.
   */
  only?: ScanStep;
}

const repoRoot = (opts: RunSpecOptions = {}): string => opts.cwd ?? process.cwd();

function emitJson(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

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
  p.intro(opts.only ? `Spec scan — ${SCAN_STEP_LABEL[opts.only]} only` : "Spec scan");
  await requireGitRepo(root);
  // Scan is the first command in the spec/contract pipeline — register the repo
  // so the corpus it produces is visible in the dashboard's project list. The
  // entry's slug is also the dashboard deep link the question line points at.
  const project = await registerProject(root);
  const dashboardUrl = await resolveDashboardUrl();
  // Filled by onRunStarted below; question lines deep-link to the exact run
  // once it exists, and to the Activity tab before that.
  let scanRunId: string | undefined;
  const activityLink = (): string => activityUrl(dashboardUrl, project.slug, scanRunId);
  // The relevance + area-tag stages shell out to `claude`; an expired login would
  // fail every doc. Probe once up front — or, in API mode, validate the provider
  // config instead (the `agent` transport answers via the mailbox: neither applies).
  await preflightLlmOrExit(opts.llm);
  // Agent transport is headless (no TTY to confirm) → auto-approve the estimate.
  const autoApprove = !!opts.yes || opts.llm === "agent";
  // The estimate resolves its own spinner line before the panel prints; the
  // checklist below only starts once the run does, so it paints exactly once.
  // Single-step runs get a checklist of only the steps that will open.
  const stepDefs =
    opts.only === "orchestrate"
      ? CURATE_STEPS.filter((s) => s.key === "discover")
      : opts.only === "curate" || opts.only === "settle"
        ? CURATE_STEPS.filter((s) => s.key === "discover" || s.key === "tag")
        : CURATE_STEPS;
  const { renderer, tracker } = withTracker(stepDefs);
  const { curate, noChanges, pendingQuestions, scanFindings, stoppedAfter, sessionsRunDir } = await curateInProcess(root, {
    tracker,
    source: "cli",
    llm: opts.llm,
    io: opts.io,
    ...(opts.only ? { only: opts.only } : {}),
    onEstimatePhase: estimateSpinnerPhase(),
    onLlmEstimate: (est) => promptLlmEstimate(est, { autoApprove, nouns: { verb: "Scan" } }),
    // The run record exists (post-confirm, pre-sessions): print the §3.6
    // "watch live" deep link to the exact run, unconditionally.
    onRunStarted: (info) => {
      scanRunId = info.runId;
      printWatchLive(dashboardUrl, project.slug, info.runId);
    },
    // A scan session asked a question (§3.7 — the interactive scope
    // orchestrator). The CLI never blocks on it: print the dashboard deep link
    // where it can be answered; unanswered it lands in pendingQuestions below.
    onQuestion: (_workItem, question) => {
      p.log.warn(`Scan question: ${question.header} — ${question.question}`);
      p.log.message(`  Answer it in the dashboard: ${activityLink()}`);
    },
  }).catch((e: unknown) => {
    renderer.dispose();
    if (e instanceof EstimateDeclined) {
      p.cancel("Scan cancelled.");
      process.exit(0);
    }
    // A single-step run found a PRIOR step's cache missing entries: running them
    // here would blur the step isolation (and mask cache-key drift), so it stops.
    if (e instanceof ScanStepNotReadyError) {
      const n = e.missing.length;
      p.log.error(
        `Step not ready — ${n} item${n === 1 ? "" : "s"} missing from the ${SCAN_STEP_LABEL[e.step]} step's cache:`,
      );
      for (const m of e.missing.slice(0, 10)) p.log.message(`  • ${m}`);
      if (n > 10) p.log.message(`  … (+${n - 10} more)`);
      p.log.step(`Run \`truecourse spec scan --only-${e.step}\` first, then re-run this step.`);
      p.outro("Aborted.");
      process.exit(1);
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
    if (opts.only) {
      p.log.success(`Nothing to run — the ${SCAN_STEP_LABEL[opts.only]} step is already settled (its inputs are unchanged).`);
      // The cache replay still computed the step's result — show it, or a warm
      // re-run reveals nothing (inspecting the result is a step run's point).
      const s = curate.stats;
      if (opts.only === "orchestrate") {
        const verdicts = curate.decisions.scopeVerdicts ?? [];
        p.log.step(`verdicts    ${verdicts.length} scope verdict${verdicts.length === 1 ? "" : "s"} (.truecourse/specs/decisions.json)`);
      } else {
        p.log.step(`docs        ${s.docsScanned} scanned · ${s.docsKept} kept`);
        if (opts.only !== "curate") p.log.step(`areas       ${s.areaCount}`);
        if (opts.only === "overlap") p.log.step(`overlaps    ${s.overlapFlags}`);
      }
    } else {
      p.log.success("Nothing changed — no new or updated docs since the last scan; corpus is up to date.");
    }
    p.outro("Done.");
    return;
  }
  const s = curate.stats;
  if (s.scopeGlobs.length > 0) {
    p.log.step(`scope       ${s.scopeGlobs.join(", ")} (config)`);
  }
  if (stoppedAfter === "orchestrate") {
    // The step's artifact is decisions.json — show what it now holds.
    const verdicts = curate.decisions.scopeVerdicts ?? [];
    const instructions = curate.decisions.instructions ?? [];
    p.log.step(
      `verdicts    ${verdicts.length} scope verdict${verdicts.length === 1 ? "" : "s"} · ${instructions.length} instruction${instructions.length === 1 ? "" : "s"} (.truecourse/specs/decisions.json)`,
    );
    for (const v of verdicts.slice(0, 20)) {
      p.log.message(`  • ${v.verdict === "exclude" ? "exclude" : "keep   "} ${v.path}${v.resolvedBy === "user" ? " (user)" : ""}`);
    }
    if (verdicts.length > 20) p.log.message(`  … (+${verdicts.length - 20} more)`);
  } else {
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
    // A failed classification is kept by fail-open — never silently: a broken
    // transport once failed 100% of calls and the corpus looked merely permissive.
    if (s.classifyFailed > 0) {
      p.log.warn(
        `${s.classifyFailed} doc${s.classifyFailed === 1 ? "" : "s"} failed classification — kept by default. ` +
          `All ${s.classifyFailed} failing means the LLM transport is broken, not that the docs are relevant.`,
      );
    }
    if (stoppedAfter !== "curate") p.log.step(`areas       ${s.areaCount}`);
    if (!stoppedAfter) p.log.step(`overlaps    ${s.overlapFlags}`);
  }
  // The stats cross a package boundary; an older engine may not carry the field.
  const autoResolved = s.autoResolvedConflicts ?? [];
  if (autoResolved.length > 0) {
    const n = autoResolved.length;
    p.log.step(`auto-resolved ${n} conflict${n === 1 ? "" : "s"} (high-confidence recommendation — undo via \`spec conflicts\`):`);
    for (const r of autoResolved) {
      const label =
        r.verdict === "dismissed" ? "dismissed" : `${(r.verdict === "a" ? r.a : r.b).split("/").pop()} is right`;
      p.log.message(`  • ${r.area}:  ${r.a}  ↔  ${r.b}  — ${label}`);
    }
  }
  printLlmFailures(s.llmFailures);
  // Questions the interactive orchestrator left unanswered — the run never
  // blocks on them, so LOUD surfacing here is the contract (§3.7).
  if (pendingQuestions.length > 0) {
    p.log.warn(
      `${pendingQuestions.length} scan question${pendingQuestions.length === 1 ? "" : "s"} went unanswered — the scan proceeded on defaults:`,
    );
    for (const q of pendingQuestions) p.log.message(`  • ${q.header}: ${q.question}`);
    p.log.message(`  Answer them in the dashboard (${activityLink()}), then re-run \`truecourse spec scan\`.`);
  }
  if (scanFindings.length > 0) {
    p.log.step(`Scan findings (from the scope orchestrator):`);
    for (const f of scanFindings) p.log.message(`  • ${f}`);
  }
  if (s.outOfScopeManualIncludes.length > 0) {
    p.log.warn("Manual includes outside spec.include (never discovered — widen the scope to pick them up):");
    for (const inc of s.outOfScopeManualIncludes) p.log.message(`  • ${inc}`);
  }
  // Single-step mode: name where the transcripts landed (the inspection loop's
  // whole point), and — before the corpus write — which step comes next.
  if (opts.only) {
    p.log.step(`sessions    ${sessionsRunDir}`);
  }
  if (stoppedAfter) {
    p.outro(
      `Stopped after ${SCAN_STEP_LABEL[stoppedAfter]} — corpus.json untouched. Next: \`truecourse spec scan --only-${SCAN_STEP_NEXT[stoppedAfter]}\`.`,
    );
    return;
  }
  // Open conflicts via the SAME resolved-derivation the gate uses (a flagged
  // overlap already verdicted/dismissed/excluded is not open). Point at guard
  // generate — the contracts pipeline is deprecated.
  const open = openConflicts(curate.corpus, curate.decisions);
  if (open.length > 0) {
    p.log.message("");
    p.log.message("Open overlaps (two docs may disagree — pick a side or dismiss with `spec conflicts resolve`):");
    for (const o of open.slice(0, 10)) {
      // A dormant verdict = this pair was resolved before and re-flagged with
      // drifted quotes — one `spec conflicts resolve` reapplies it.
      const dormant = dormantResolutionForPair(curate.decisions, o.a, o.b, o.sections);
      p.log.message(`  • ${o.area}:  ${o.a}  ↔  ${o.b}${dormant ? "   (has a previous verdict — see `spec conflicts list`)" : ""}`);
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
      `Corpus written to .truecourse/specs/corpus.json — INCOMPLETE: ${lost} session${lost === 1 ? "" : "s"} failed; re-run to fill the gaps.${conflictTail}`,
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
  p.log.warn("Scan sessions failed — the results above are incomplete:");
  for (const f of failures) {
    p.log.message(`  • ${stageLabel(f.stage)}: ${f.failures} of ${f.attempts} sessions failed — ${SCAN_STAGE_EFFECT[f.stage] ?? "affected items skipped"}`);
    if (f.firstError) p.log.message(`    first failure: ${f.firstError}`);
  }
}

/** The scan stage's short name, for a line that reads as prose. */
function stageLabel(stage: string): string {
  return SCAN_STAGE_LABEL[stage] ?? stage;
}

const SCAN_STAGE_LABEL: Record<string, string> = {
  // Session kinds (the scan runs agent sessions — plan 02).
  "spec-scan.orchestrate": "scan scope",
  "spec-scan.curate-doc": "doc curation",
  "spec-scan.settle-areas": "area settling",
  "spec-scan.overlap": "overlap",
};

/** Human name of each `--only-<step>` scan step, for prose lines. */
const SCAN_STEP_LABEL: Record<ScanStep, string> = {
  orchestrate: "scope orchestration",
  curate: "doc curation",
  settle: "area settling",
  overlap: "overlap",
};

/** The step to suggest after a stopped single-step run. `overlap` never stops
 *  (it completes the scan), so its row is unreachable. */
const SCAN_STEP_NEXT: Record<ScanStep, ScanStep> = {
  orchestrate: "curate",
  curate: "settle",
  settle: "overlap",
  overlap: "overlap",
};

/** What each kind's per-item fail-open default did to the sessions it lost. */
const SCAN_STAGE_EFFECT: Record<string, string> = {
  "spec-scan.orchestrate": "stored scope verdicts kept — no new subtree decisions",
  "spec-scan.curate-doc": "affected docs kept by default, untagged (they join no area)",
  "spec-scan.settle-areas": "area labels kept as-is (no merges/subdivisions)",
  "spec-scan.overlap": "affected clusters left unflagged (docs land in notReached, their pairs in uncheckedPairs)",
};


// ---------------------------------------------------------------------------
// status — a pure read of corpus.json + decisions.json (no LLM, no re-scan)
// ---------------------------------------------------------------------------

export async function runSpecStatus(opts: RunSpecOptions = {}): Promise<void> {
  const root = repoRoot(opts);
  const corpus = readCorpus(root);
  if (!corpus) {
    if (opts.json) {
      emitJson({
        hasCorpus: false,
        docs: 0,
        areas: 0,
        overlaps: { open: 0, resolved: 0 },
        manualIncludes: 0,
        areaList: [],
        orphaned: [],
      });
      return;
    }
    p.intro("Spec status");
    p.log.warn("No corpus — run `truecourse spec scan`.");
    p.outro("");
    return;
  }
  const decisions = readCorpusDecisions(root);
  const conflicts = buildCorpusConflicts(corpus, decisions);
  const open = conflicts.filter((c) => !c.resolved).length;
  const resolved = conflicts.length - open;
  // Orphan honesty: a recorded section-scoped verdict that no longer matches a
  // flagged conflict (the docs changed) is surfaced, never silently honored.
  const orphaned = orphanedConflictResolutions(corpus, decisions);

  if (opts.json) {
    emitJson({
      hasCorpus: true,
      docs: corpus.docs.length,
      areas: corpus.areas.length,
      overlaps: { open, resolved },
      manualIncludes: (decisions.manualIncludes ?? []).length,
      areaList: corpus.areas.map((a) => ({ id: a.id, docs: a.docRefs.length, overlaps: a.overlaps.length })),
      orphaned: orphaned.map((o) => ({ docA: o.docA, docB: o.docB, verdict: o.verdict })),
    });
    return;
  }

  p.intro("Spec status");
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

  // No orphan line: a verdict that no longer matches a flagged dispute is PRUNED
  // by the scan that wrote the corpus (see `curate()`), so status has nothing
  // stranded left to report. `spec conflicts list` is where a resolution stranded
  // by a hand-edited decisions.json surfaces; the JSON shape carries the array so
  // an agent reads one stable status contract.
  p.outro(
    open === 0
      ? "No open overlaps — run `truecourse guard generate`."
      : "Open overlaps — see `truecourse spec conflicts list`.",
  );
}

