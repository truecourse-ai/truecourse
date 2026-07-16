/**
 * `truecourse guard run` — build the entrypoint via the recipe, run the committed
 * scenarios in parallel sandboxes, stream non-pass results as they settle, and
 * write `.truecourse/guard/LATEST.json`. Passes stay in the live counter and the
 * closing counts (`--verbose` lists every scenario). Deterministic and LLM-free:
 * no `claude` preflight, no cost estimate. Unlike `verify`, it exits non-zero on any
 * non-pass outcome — fail, error, stale, or orphaned — so it works as a CI drift
 * gate: code drift (fail), infra trouble (error), and spec-side drift
 * (stale/orphaned) all break the build.
 */

import path from "node:path";
import * as p from "@clack/prompts";
import { guardResultPath, runFailureMessage } from "@truecourse/guard-runner";
import { readManifest, readGuardLatest, readGuardResult } from "@truecourse/core/lib/guard-store";
import type { GuardScenarioResult, GuardGenerateReport, GuardBirthFinding, GuardAutoResolved } from "@truecourse/shared";
import { StepTracker } from "@truecourse/core/progress";
import {
  guardGenerateInProcess,
  guardRunInProcess,
  GUARD_GENERATE_STEPS,
  GUARD_RUN_STEPS,
  EstimateDeclined,
  OpenConflictsError,
  type GenerateMode,
  type AuthorFailure,
} from "@truecourse/core/commands/guard-in-process";
import { composeGuardStatus, orderGuardDrifts, guardDriverIds } from "@truecourse/shared";
import { registerProject } from "@truecourse/core/config/registry";
import { createStdoutStepRenderer } from "../lib/stdout-step-renderer.js";
import { requireGitRepo } from "./git-guard.js";
import { preflightClaudeOrExit } from "../lib/claude-preflight.js";
import { promptLlmEstimate } from "./llm-prompt.js";
import { isInteractive } from "./helpers.js";

export interface RunGuardRunOptions {
  cwd?: string;
  /** Restrict the run to a single scenario id (`--scenario`). */
  scenario?: string;
  /** List every scenario (one ✓ line per pass) after the run (`--verbose`). */
  verbose?: boolean;
}

const MARK: Record<GuardScenarioResult["outcome"], string> = {
  pass: "✓",
  fail: "✗",
  error: "⚠",
  stale: "~",
  orphaned: "○",
};

/** One line per scenario result: severity icon, id, title, reason/duration. */
function scenarioLine(s: GuardScenarioResult): string {
  const suffix =
    s.outcome === "stale" || s.outcome === "orphaned"
      ? `  — ${BINDING_REASON[s.outcome]}`
      : `  (${Math.round(s.durationMs)}ms)`;
  return `${MARK[s.outcome]} ${s.id} — ${s.title}${suffix}`;
}

export async function runGuardRun(opts: RunGuardRunOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Guard");
  await requireGitRepo(repoRoot);

  const renderer = createStdoutStepRenderer();
  const tracker = new StepTracker(renderer.onProgress, GUARD_RUN_STEPS.map((s) => ({ ...s })));
  const result = await guardRunInProcess(repoRoot, {
    scenario: opts.scenario,
    tracker,
    // Non-pass results surface the moment they settle — a full line each,
    // printed above the live counter so they are never buried under pass
    // output. Passes ride the counter only (`--verbose` lists them at the end).
    onScenarioResult: (s) => {
      if (s.outcome !== "pass") renderer.log(scenarioLine(s));
    },
  });
  renderer.dispose();

  switch (result.status) {
    case "no-recipe":
    case "invalid-recipe":
      p.log.error(runFailureMessage(result));
      p.outro("Aborted.");
      process.exit(1);
      return;
    case "no-scenarios": {
      if (result.requestedId) {
        p.log.error(runFailureMessage(result));
      } else {
        p.log.info(runFailureMessage(result));
      }
      printLoadErrors(result.loadErrors);
      p.outro("Nothing ran.");
      process.exit(result.requestedId || result.loadErrors.length > 0 ? 1 : 0);
      return;
    }
    case "build-failed": {
      p.log.error(runFailureMessage(result));
      const tail = result.build.output.trimEnd().split("\n").slice(-15);
      for (const line of tail) console.log(`  ${line}`);
      printLoadErrors(result.loadErrors);
      p.outro("Aborted — no scenarios ran.");
      process.exit(1);
      return;
    }
    case "entry-preflight-failed": {
      // The build succeeded but the entry can't start — ONE loud error with the FULL
      // (untruncated) startup stderr, never N identical scenario failures.
      p.log.error(runFailureMessage(result));
      printLoadErrors(result.loadErrors);
      p.outro("Aborted — the entry could not start; no scenarios ran.");
      process.exit(1);
      return;
    }
    case "run-timed-out":
    case "aborted":
      p.log.error(runFailureMessage(result));
      p.outro("Aborted.");
      process.exit(1);
      return;
    case "ok":
      break;
  }

  const { latest, loadErrors, manifest } = result;

  // `--verbose` restores the full per-scenario listing (one ✓ line per pass);
  // by default passes stay in the live counter and only the summary tells the story.
  if (opts.verbose) {
    for (const s of latest.scenarios) p.log.message(scenarioLine(s));
  }

  printLoadErrors(loadErrors);
  if (manifest) p.log.info(`manifest: ${manifest.sections.length} section${manifest.sections.length === 1 ? "" : "s"} recorded`);

  const { pass, fail, error, stale, orphaned } = latest.summary;
  const parts = [`${pass} passed`];
  if (fail > 0) parts.push(`${fail} failed`);
  if (error > 0) parts.push(`${error} errored`);
  if (stale > 0) parts.push(`${stale} stale`);
  if (orphaned > 0) parts.push(`${orphaned} orphaned`);
  if (loadErrors.length > 0) parts.push(`${loadErrors.length} unloadable`);

  const bad = fail > 0 || error > 0 || stale > 0 || orphaned > 0 || loadErrors.length > 0;
  if (bad) {
    p.log.error(parts.join(" · "));
    // Pointers — the failure detail (step/expected/actual/evidence) lives in
    // the drift surfaces, mirroring the generate close.
    p.log.info(
      [
        "`truecourse guard drifts`  — inspect failures (expected/actual/evidence)",
        "`truecourse guard status`  — coverage",
      ].join("\n"),
    );
    p.outro("Guard found drift.");
    process.exit(1);
  }
  p.log.success(parts.join(" · "));
  p.outro("All sections guarded.");
}

// ---------------------------------------------------------------------------
// `truecourse guard generate` — the LLM pipeline (classify → generate → birth).
// ---------------------------------------------------------------------------

export interface RunGuardGenerateOptions {
  cwd?: string;
  /** Skip the pre-flight cost-estimate confirm (`-y` / `--yes`). */
  yes?: boolean;
  /** LLM transport: `cli` (default, spawn `claude -p`) or `agent` (mailbox under `io`). */
  llmTransport?: "cli" | "agent";
  /** I/O dir for the `agent` transport's request/response mailbox. */
  io?: string;
}

/**
 * Author scenarios from spec sections. Birth findings (a scenario that failed
 * against current code — a generation defect OR real existing drift) are surfaced
 * as work to review, NOT a failure: they're the user's call to resolve, so the
 * command exits 0 with them listed. Only a hard failure (no docs, recipe
 * discovery failed) exits non-zero.
 */
export async function runGuardGenerate(opts: RunGuardGenerateOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Guard generate");
  await requireGitRepo(repoRoot);
  await registerProject(repoRoot);

  if (opts.llmTransport === "agent" && !opts.io) {
    p.log.error("--llm-transport agent requires --io <dir> (the request/response mailbox directory).");
    p.outro("Aborted.");
    process.exit(1);
  }
  // Classification + generation shell out to `claude`; probe once up front (the
  // `agent` transport answers via the filesystem mailbox, so skip it there).
  if (opts.llmTransport !== "agent") await preflightClaudeOrExit();

  const autoApprove = !!opts.yes || opts.llmTransport === "agent";
  const renderer = createStdoutStepRenderer();
  const tracker = new StepTracker(renderer.onProgress, GUARD_GENERATE_STEPS.map((s) => ({ ...s })));
  let guard;
  try {
    ({ guard } = await guardGenerateInProcess(repoRoot, {
      tracker,
      llm: opts.llmTransport,
      io: opts.io,
      // Fast-vs-economical ask (item 5), BEFORE the estimate — skipped internally
      // when nothing changed or `TRUECOURSE_GENERATE_BATCH` is set; auto-approve /
      // non-interactive keep the remembered/default mode without prompting.
      onModeChoice: (defaultMode) => promptGenerateMode(defaultMode, autoApprove),
      onLlmEstimate: (est) => promptLlmEstimate(est, { autoApprove, nouns: { verb: "Generate" } }),
      // Authoring failures surface live (item 2) — a warn line the moment each
      // attempt fails, above the checklist (the section never ticks the settle
      // counter, so a timing-out call is otherwise indistinguishable from a slow one).
      onAuthorFailure: (f) => renderer.log(authorFailureLine(f)),
    }));
  } catch (e: unknown) {
    renderer.dispose();
    if (e instanceof EstimateDeclined) {
      p.cancel("Generate cancelled.");
      process.exit(0);
    }
    // Open spec conflicts block generate before any spend — print the FULL list
    // (area, both repo-relative paths, note) and the resolution pointers, exit 1.
    if (e instanceof OpenConflictsError) {
      p.log.error(`${e.conflicts.length} open spec conflict${e.conflicts.length === 1 ? "" : "s"} block guard generate — resolve them first:`);
      for (const c of e.conflicts) {
        p.log.message(`  ${c.area}`);
        p.log.message(`    ${c.a}  ↔  ${c.b}${c.note ? `   · ${c.note}` : ""}`);
      }
      p.log.step("Resolve with `truecourse spec conflicts list` (or the dashboard Conflicts group), then re-run `truecourse guard generate`.");
      p.outro("Aborted — resolve the conflicts first.");
      process.exit(1);
    }
    // Presentation boundary: any residual unexpected error renders cleanly, never
    // a raw stack trace. The engine keeps its rethrow semantics upstream.
    p.log.error(`Guard generate failed: ${(e as Error).message}`);
    p.outro("Aborted.");
    process.exit(1);
  }
  renderer.dispose();

  if (guard.status === "no-docs") {
    p.log.error(guard.reason ?? "No spec docs to guard.");
    p.outro("Run `truecourse spec scan` first.");
    process.exit(1);
  }
  if (guard.status === "recipe-failed") {
    p.log.error(`Recipe discovery failed: ${guard.reason}`);
    p.outro("Add or fix `.truecourse/scenarios/recipe.json` and retry.");
    process.exit(1);
  }

  // The built entry couldn't start — birth validation never ran, so every changed
  // section stayed unsettled. ONE loud error with the FULL startup stderr (also
  // recorded in guard/result.json errors); a rebuild + re-run picks up where it left
  // off (authoring is cached).
  if (guard.entryPreflight) {
    p.log.error(`The recipe entry \`${guard.entryPreflight.entry}\` failed to start — every scenario would fail identically, so nothing was validated.`);
    for (const line of guard.entryPreflight.stderr.trimEnd().split("\n")) console.log(`  ${line}`);
    p.log.step(`Rebuild it with \`${guard.entryPreflight.buildCommand}\` (its build output is likely stale or incomplete), then re-run \`truecourse guard generate\`.`);
    p.outro("Aborted — the entry could not start; no scenarios were validated.");
    process.exit(1);
  }

  if (guard.recipe?.status === "discovered") {
    p.log.step(`recipe      wrote ${guard.recipe.wrotePath} — review and commit it`);
  }

  if (guard.noChanges) {
    p.log.success("Nothing changed — every section is already guarded since the last generate.");
    p.outro("Done.");
    return;
  }

  // The generate persisted its report at the end (usage + generatedAt); read it
  // back so the summary reuses the exact `guard status` composition. Fall back to
  // the in-memory result if the file is somehow absent.
  const report: GuardGenerateReport = (await readGuardResult(repoRoot)) ?? { ...guard, generatedAt: new Date().toISOString() };
  printGuardGenerateSummary(report, path.relative(repoRoot, guardResultPath(repoRoot)));

  if (guard.written.length === 0 && guard.birthFindings.length === 0 && guard.errors.length === 0) {
    p.outro("No scenarios written.");
    return;
  }
  if (guard.written.length > 0) {
    p.log.success(`Wrote ${guard.written.length} scenario file${guard.written.length === 1 ? "" : "s"} to .truecourse/scenarios/.`);
  }
  p.outro("Review + commit the scenarios, then `truecourse guard run`.");
}

/**
 * The fast-vs-economical prompt (item 5). Called by the driver BEFORE the estimate,
 * only when there is work and no `TRUECOURSE_GENERATE_BATCH` override. Auto-approve
 * (`-y` / agent) and non-interactive keep the remembered/default choice silently.
 */
async function promptGenerateMode(defaultMode: GenerateMode, autoApprove: boolean): Promise<GenerateMode> {
  if (autoApprove || !isInteractive()) return defaultMode;
  const choice = await p.select<GenerateMode>({
    message: "Authoring speed vs. cost?",
    initialValue: defaultMode,
    options: [
      {
        value: "economical",
        label: "Economical — batched (cheapest, slowest)",
        hint: "one call per batch of claims",
      },
      {
        value: "fast",
        label: "Fast — one claim per call, parallel",
        hint: "fastest, ~1.4× cost (re-pays the shared context per call)",
      },
    ],
  });
  return p.isCancel(choice) ? defaultMode : choice;
}

/**
 * A live authoring-failure warn line (item 2): the failing section leaf, the
 * one-line reason, and whether a corrective re-ask follows (`retrying (2/2)`) or the
 * section is given up on for this run (`will retry next generate`).
 */
function authorFailureLine(f: AuthorFailure): string {
  const leaf = sectionLeaf(f.anchor);
  return f.willRetry
    ? `✗ ${leaf} — ${f.reason}, retrying (${f.attempt + 1}/2)`
    : `✗ ${leaf} — ${f.reason}; section failed, will retry next generate`;
}

/**
 * The closing summary for `guard generate` — a compact counts block, the top few
 * birth findings, ALL failed authoring sections (deduped by doc+anchor), and
 * pointers to the detail surfaces. Reuses the `guard status` summary composition so
 * the terminal and the store never tell different stories; the full detail
 * (expected/actual/evidence) lives in `guard/result.json`, `guard drifts`, and
 * `guard status`.
 */
export function printGuardGenerateSummary(report: GuardGenerateReport, reportPath: string): void {
  const g = composeGuardStatus(null, null, report).lastGenerate!;

  // Changed sections split into settled (recorded) and unsettled (re-attempt next
  // run — a birth finding or an authoring error). Extraction failures re-attempt
  // whole docs and are surfaced on their own line below.
  const unsettled = new Set<string>();
  for (const f of report.birthFindings) unsettled.add(`${f.doc}\0${f.anchor}`);
  for (const e of report.errors) unsettled.add(`${e.doc}\0${e.anchor}`);
  // A triage-auto-resolved finding (item 14) left `birthFindings`, but its section
  // committed nothing this run — count it unsettled so `settled` stays honest (an
  // environment dismissal settles next run; a generation-defect re-attempts).
  for (const a of report.autoResolved ?? []) {
    if (a.kind === "triage-dismiss" || a.kind === "triage-resolve") unsettled.add(`${a.doc}\0${a.anchor}`);
  }
  const settled = Math.max(0, report.sectionsChanged - unsettled.size);

  p.log.step(`sections    ${report.sectionsChanged} changed · ${settled} settled · ${unsettled.size} unsettled · ${report.skippedUnchanged} unchanged`);
  const birth = g.birthPassed !== null ? ` · ${g.birthPassed} passed birth` : "";
  p.log.step(`scenarios   ${g.written} written${birth}`);
  // Ready-but-held: birth-passed scenarios an unsettled sibling withheld — validated
  // work that would otherwise vanish into the authoring cache. Only when any exist.
  if (g.readyButHeld > 0) {
    p.log.step(
      `held        ${g.readyButHeld} ready but held (${g.heldByFindings} finding${g.heldByFindings === 1 ? "" : "s"} · ${g.heldByErrors} error${g.heldByErrors === 1 ? "" : "s"})`,
    );
  }

  const gapTotal = Object.values(g.coverageGapsByKind).reduce((a, b) => a + b, 0);
  if (gapTotal > 0) {
    const kinds = Object.entries(g.coverageGapsByKind)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => (k === "blocked-on" ? `${n} blocked-on${blockedOnBreakdown(g.blockedOnCapabilities)}` : `${n} ${k}`));
    p.log.step(`gaps        ${gapTotal} not guarded (${kinds.join(", ")})`);
  }
  if (report.orphaned.length > 0) {
    p.log.step(`orphaned    ${report.orphaned.length} section${report.orphaned.length === 1 ? "" : "s"} — bound but gone; scenarios kept`);
  }
  if (report.extractionFailures.length > 0) {
    p.log.step(`extraction  ${report.extractionFailures.length} document${report.extractionFailures.length === 1 ? "" : "s"} failed — re-run to retry`);
  }
  // Orphan honesty (item 20): a dismissal whose claim text no longer matches any
  // live claim in a re-read doc — surfaced so it is never silently honored forever.
  if (report.orphanedDismissals && report.orphanedDismissals.length > 0) {
    const n = report.orphanedDismissals.length;
    p.log.step(`dismissals  ${n} orphaned — the dismissed claim no longer exists; re-dismiss the new text or drop it from decisions.json`);
  }
  if (g.birthFindings > 0) p.log.step(`findings    ${g.birthFindings} birth finding${g.birthFindings === 1 ? "" : "s"} — human decision needed`);
  if (g.errors > 0) p.log.step(`errors      ${g.errors} authoring error${g.errors === 1 ? "" : "s"}`);
  // Auto-resolved ledger (items 13 + 14): high-confidence machine judgments the tool
  // handled itself — a visible count, never a hidden deletion or a human task. One
  // honest breakdown line: weak scenarios re-authored (item 13), plus triage
  // auto-resolutions (item 14) — environment claims dismissed, generation-defect
  // findings retired to re-attempt.
  if (report.autoResolved && report.autoResolved.length > 0) {
    const n = report.autoResolved.length;
    const parts = autoResolvedBreakdown(report.autoResolved);
    p.log.step(`auto-resolved ${n} without a task (${parts})`);
  }
  if (g.usage) p.log.step(`cost        ${g.usage.calls} call${g.usage.calls === 1 ? "" : "s"} · $${g.usage.costUsd.toFixed(2)}`);

  // Top 3 birth findings, one line each (title + section leaf). The rest live in
  // the store surfaces — the terminal is for the story, not the dump.
  if (report.birthFindings.length > 0) {
    p.log.warn(`Top birth finding${report.birthFindings.length === 1 ? "" : "s"} (generation defect or real drift — your call):`);
    for (const f of report.birthFindings.slice(0, 3)) p.log.message(`✗ ${f.title} — ${sectionLeaf(f.anchor)}`);
    const more = report.birthFindings.length - 3;
    if (more > 0) p.log.message(`… and ${more} more — see \`truecourse guard drifts\``);
  }

  // ALL failed authoring sections, deduped by doc+anchor, one line each (no cap):
  // section leaf + collapsed reason (`timed out (3 attempts)` / `invalid output
  // twice`), then the note that nothing was written for them.
  if (report.errors.length > 0) {
    const sections = collapseAuthoringErrors(report.errors);
    p.log.warn(
      `Authoring failure${sections.length === 1 ? "" : "s"} — nothing was written for ${sections.length === 1 ? "this section" : "these sections"}, re-run generate to retry:`,
    );
    for (const s of sections) p.log.message(`✗ ${sectionLeaf(s.anchor)} — ${s.reason}`);
  }

  // Pointers — the surfaces hold the detail the terminal no longer dumps.
  p.log.info(
    [
      "`truecourse guard drifts`  — inspect failures",
      "`truecourse guard status`  — coverage",
      `report: ${reportPath}`,
    ].join("\n"),
  );
}

/** The trailing heading of a section anchor (`cli/version` → `version`). */
function sectionLeaf(anchor: string): string {
  return anchor.split("/").pop() || anchor;
}

/** The honest per-kind breakdown of the auto-resolved ledger, for the summary line —
 *  item-13 fidelity discards (re-authored) and item-14 triage auto-resolutions
 *  (environment dismissed, generation-defect re-attempts). Only nonzero kinds show. */
function autoResolvedBreakdown(entries: readonly GuardAutoResolved[]): string {
  const discarded = entries.filter((a) => a.kind === "fidelity-discard").length;
  const dismissed = entries.filter((a) => a.kind === "triage-dismiss").length;
  const resolved = entries.filter((a) => a.kind === "triage-resolve").length;
  const parts: string[] = [];
  if (discarded > 0) parts.push(`${discarded} weak scenario${discarded === 1 ? "" : "s"} re-authored`);
  if (dismissed > 0) parts.push(`${dismissed} environment claim${dismissed === 1 ? "" : "s"} dismissed`);
  if (resolved > 0) parts.push(`${resolved} generation defect${resolved === 1 ? "" : "s"} re-attempt`);
  return parts.join(" · ");
}

/** Collapse whitespace and clip an error message to one readable line. */
function oneLine(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 100 ? `${t.slice(0, 100)}…` : t;
}

/** One failed authoring section: doc+anchor plus a reason collapsed from all its
 *  error entries (its per-claim/per-attempt failures). */
interface FailedAuthoringSection {
  doc: string;
  anchor: string;
  reason: string;
}

/**
 * Dedupe the report's authoring errors by doc+anchor and collapse each section's
 * messages into one reason with an attempt count (item 2). A section that only
 * timed out reads `timed out (N attempts)`; one that returned invalid output reads
 * `invalid output twice`; anything else leads with the first message.
 */
function collapseAuthoringErrors(errors: { doc: string; anchor: string; message: string }[]): FailedAuthoringSection[] {
  const groups = new Map<string, { doc: string; anchor: string; messages: string[] }>();
  for (const e of errors) {
    const k = `${e.doc}\0${e.anchor}`;
    const g = groups.get(k);
    if (g) g.messages.push(e.message);
    else groups.set(k, { doc: e.doc, anchor: e.anchor, messages: [e.message] });
  }
  return [...groups.values()].map((g) => ({ doc: g.doc, anchor: g.anchor, reason: collapseFailureReason(g.messages) }));
}

/** Collapse one section's authoring-error messages into a single reason + count. */
function collapseFailureReason(messages: string[]): string {
  const n = messages.length;
  const attempts = `${n} attempt${n === 1 ? "" : "s"}`;
  const isTimeout = (m: string) => /timed out/i.test(m);
  const isInvalid = (m: string) => /invalid|composition/i.test(m);
  if (messages.every(isTimeout)) return `timed out (${attempts})`;
  if (messages.every(isInvalid)) return n === 1 ? "invalid output twice" : `invalid output twice (${attempts})`;
  const first = oneLine(messages[0]);
  return n === 1 ? first : `${first} (+${n - 1} more)`;
}

// ---------------------------------------------------------------------------
// `truecourse guard status` — a compact, deterministic, LLM-free summary read
// from three store files (manifest / LATEST / result). Thin printer over the
// pure `composeGuardStatus` composition in core.
// ---------------------------------------------------------------------------

export interface RunGuardStatusOptions {
  cwd?: string;
}

export async function runGuardStatus(opts: RunGuardStatusOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Guard status");

  const summary = composeGuardStatus(
    await readManifest(repoRoot),
    await readGuardLatest(repoRoot),
    await readGuardResult(repoRoot),
  );

  // Coverage — scenarios/manifest.json.
  if (!summary.coverage) {
    p.log.info("coverage    (none) — run `truecourse guard generate`");
  } else {
    const c = summary.coverage;
    p.log.step(`coverage    ${c.withScenarios}/${c.totalSections} section${c.totalSections === 1 ? "" : "s"} guarded`);
    const cl = c.classification;
    const parts = [...guardDriverIds.map((d) => `${d} ${cl[d]}`), `untestable ${cl.untestable}`];
    if (cl.unclassified > 0) parts.push(`unclassified ${cl.unclassified}`);
    p.log.message(`    ${parts.join(" · ")}`);
  }

  // Last run — guard/LATEST.json.
  if (!summary.lastRun) {
    p.log.info("last run    (none) — run `truecourse guard run`");
  } else {
    const r = summary.lastRun;
    const ref = [r.branch, r.commit ? r.commit.slice(0, 8) : null].filter(Boolean).join(" @ ");
    p.log.step(`last run    ${r.ranAt}${ref ? ` · ${ref}` : ""}`);
    const s = r.summary;
    const parts = [`${MARK.pass} ${s.pass} pass`];
    if (s.fail > 0) parts.push(`${MARK.fail} ${s.fail} fail`);
    if (s.error > 0) parts.push(`${MARK.error} ${s.error} error`);
    if (s.stale > 0) parts.push(`${MARK.stale} ${s.stale} stale`);
    if (s.orphaned > 0) parts.push(`${MARK.orphaned} ${s.orphaned} orphaned`);
    p.log.message(`    ${parts.join(" · ")}`);
  }

  // Last generate — guard/result.json.
  if (!summary.lastGenerate) {
    p.log.info("last gen    (none) — run `truecourse guard generate`");
  } else {
    const g = summary.lastGenerate;
    if (g.noChanges) {
      p.log.step(`last gen    ${g.generatedAt} · nothing changed`);
    } else if (g.status !== "ok") {
      p.log.step(`last gen    ${g.generatedAt} · ${g.status}`);
    } else {
      const birth = g.birthPassed !== null ? ` · ${g.birthPassed} passed birth` : "";
      p.log.step(`last gen    ${g.generatedAt} · ${g.written} written${birth}`);
      const gapTotal = Object.values(g.coverageGapsByKind).reduce((a, b) => a + b, 0);
      const detail: string[] = [];
      if (gapTotal > 0) {
        const kinds = Object.entries(g.coverageGapsByKind)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => (k === "blocked-on" ? `${n} blocked-on${blockedOnBreakdown(g.blockedOnCapabilities)}` : `${n} ${k}`));
        detail.push(`${gapTotal} gap${gapTotal === 1 ? "" : "s"} (${kinds.join(", ")})`);
      }
      if (g.readyButHeld > 0) detail.push(`${g.readyButHeld} ready but held`);
      if (g.birthFindings > 0) detail.push(`${g.birthFindings} birth finding${g.birthFindings === 1 ? "" : "s"}`);
      if (g.errors > 0) detail.push(`${g.errors} error${g.errors === 1 ? "" : "s"}`);
      if (detail.length > 0) p.log.message(`    ${detail.join(" · ")}`);
      if (g.usage) p.log.message(`    ${g.usage.calls} call${g.usage.calls === 1 ? "" : "s"} · $${g.usage.costUsd.toFixed(2)}`);
    }
  }

  if (!summary.coverage && !summary.lastRun && !summary.lastGenerate) {
    p.outro("No guard data yet. Run `truecourse guard generate`, then `truecourse guard run`.");
    return;
  }
  p.outro("Guard status.");
}

// ---------------------------------------------------------------------------
// `truecourse guard drifts` — the current run's non-pass scenarios, most severe
// first. Informational (always exits 0); `guard run` is the gate. Mirrors the
// `drifts list` UX (pagination flags, `--json`, empty-state pointer).
// ---------------------------------------------------------------------------

export interface RunGuardDriftsOptions {
  cwd?: string;
  /** Page size. Pass Infinity (via `--all`) to show every drift. */
  limit?: number;
  offset?: number;
  /** Emit machine-readable JSON instead of the formatted list. */
  json?: boolean;
}

export async function runGuardDrifts(opts: RunGuardDriftsOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  const latest = await readGuardLatest(repoRoot);
  const drifts = orderGuardDrifts(latest?.scenarios);

  if (opts.json) {
    const payload = {
      total: drifts.length,
      drifts: drifts.map((d) => ({
        id: d.id,
        title: d.title,
        outcome: d.outcome,
        doc: d.binds.doc,
        section: d.binds.section,
        ...(d.claim ? { claim: d.claim } : {}),
        ...(d.failure ? { failure: d.failure } : {}),
        ...(d.evidencePath ? { evidencePath: d.evidencePath } : {}),
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  p.intro("Guard drifts");

  if (!latest) {
    p.log.info("No guard run yet. Run `truecourse guard run` first.");
    p.outro("Nothing to show.");
    return;
  }

  if (drifts.length === 0) {
    p.log.success("No drift — every guarded section passed.");
    p.outro("Nothing to show.");
    return;
  }

  const total = drifts.length;
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = opts.limit ?? 20;
  const end = isFinite(limit) ? offset + limit : total;
  const page = drifts.slice(offset, end);

  p.log.message("");
  p.log.message("Drifts:");
  for (const d of page) {
    p.log.message(`  ${MARK[d.outcome]} [${d.outcome}] ${d.id} — ${d.title}`);
    p.log.message(`      ${d.binds.doc} › ${d.binds.section}`);
    // The claim this scenario defends — a failure reads as doc-vs-code, not regex-vs-stdout.
    if (d.claim) p.log.message(`      doc says: ${oneLine(d.claim)}`);
    if (d.outcome === "fail" && d.failure) {
      p.log.message(`      step ${d.failure.step} · expected ${d.failure.expected} · actual ${d.failure.actual}`);
    }
    if (d.evidencePath) p.log.message(`      evidence: ${d.evidencePath}`);
  }

  const shownFrom = offset + 1;
  const shownTo = offset + page.length;
  const remaining = total - shownTo;
  if (remaining > 0) {
    p.log.message("");
    p.log.message(
      `  … ${remaining} more — \`truecourse guard drifts --offset ${shownTo}\` (or \`--all\`)`,
    );
  }

  p.outro(`Showing ${shownFrom}–${shownTo} of ${total} drift${total === 1 ? "" : "s"}.`);
}

// ---------------------------------------------------------------------------
// `truecourse guard findings` — the last generate's birth/fidelity findings,
// grouped by doc+anchor and numbered for review. A read view over
// guard/result.json: `guard generate` already surfaced these, so it exits 0
// whether findings exist or not, and nonzero only when no generate report
// exists at all. `--kind`/`--doc` filter (composable); `--json` emits the
// filtered findings array straight from the report, no decoration.
// ---------------------------------------------------------------------------

export interface RunGuardFindingsOptions {
  cwd?: string;
  /** Restrict to one finding kind (`--kind birth|fidelity`). */
  kind?: "birth" | "fidelity";
  /** Restrict to findings bound to one doc (exact repo-relative path, `--doc`). */
  doc?: string;
  /** Emit the filtered findings array as JSON instead of the formatted list. */
  json?: boolean;
}

/** A finding's effective kind — `birth` is the default when the field is unset. */
function findingKind(f: GuardBirthFinding): "birth" | "fidelity" {
  return f.kind ?? "birth";
}

/**
 * Print the auto-resolved ledger beneath a divider in `guard findings` — the
 * high-confidence machine judgments the tool handled WITHOUT a human task (item 13
 * fidelity discards + item 14 triage auto-resolutions). The human findings list is
 * the default view; this rides below it as a visible record. No-op when empty.
 */
function printAutoResolvedLedger(report: GuardGenerateReport): void {
  const entries = report.autoResolved ?? [];
  if (entries.length === 0) return;
  p.log.message("");
  p.log.message(`── auto-resolved · no human task (${entries.length}) ──`);
  for (const a of entries) {
    const at = `${a.doc} › ${a.anchor}`;
    if (a.kind === "fidelity-discard") {
      p.log.message(`  · [re-authored ${a.outcome}] ${a.title} — ${oneLine(a.mismatch)}  (${at})`);
    } else if (a.kind === "triage-dismiss") {
      p.log.message(`  · [dismissed · environment] ${a.title} — ${oneLine(a.brief)}  (${at})`);
    } else {
      p.log.message(`  · [re-attempts · generation-defect] ${a.title} — ${oneLine(a.brief)}  (${at})`);
    }
  }
}

/** Human description of the active `--kind`/`--doc` filters, for the close/empty copy. */
function describeFindingsFilter(opts: { kind?: string; doc?: string }): string {
  const parts: string[] = [];
  if (opts.kind) parts.push(`kind ${opts.kind}`);
  if (opts.doc) parts.push(`doc ${opts.doc}`);
  return parts.join(" · ") || "the filter";
}

export async function runGuardFindings(opts: RunGuardFindingsOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  const report = await readGuardResult(repoRoot);

  // The only nonzero exit: no generate has run, so there is nothing to read.
  if (!report) {
    if (opts.json) {
      console.error("No guard generate report. Run `truecourse guard generate` first.");
    } else {
      p.intro("Guard findings");
      p.log.error("No guard generate report yet — run `truecourse guard generate` first.");
      p.outro("Nothing to show.");
    }
    process.exit(1);
    return;
  }

  const filtered = report.birthFindings.filter(
    (f) => (!opts.kind || findingKind(f) === opts.kind) && (!opts.doc || f.doc === opts.doc),
  );

  if (opts.json) {
    // The filtered findings array, verbatim from the report — no TUI decoration.
    console.log(JSON.stringify(filtered, null, 2));
    return;
  }

  p.intro("Guard findings");

  // Header — the report's identity and headline counts, straight from the store.
  const birth = report.birthPassed !== undefined ? ` · ${report.birthPassed} passed birth` : "";
  const filterActive = !!opts.kind || !!opts.doc;
  const matchNote = filterActive ? ` · ${filtered.length} match filter` : "";
  p.log.step(`generated   ${report.generatedAt}`);
  p.log.step(`sections    ${report.sectionsTotal} total · ${report.sectionsChanged} changed`);
  p.log.step(`scenarios   ${report.written.length} written${birth}`);
  p.log.step(`findings    ${report.birthFindings.length} total${matchNote}`);

  // Empty states: nothing to review at all, vs. filters excluded everything. The
  // auto-resolved ledger still prints beneath a divider — a visible record even when
  // no human finding remains.
  if (report.birthFindings.length === 0) {
    p.log.success(
      `No findings in the last generate — ${report.written.length} scenario${report.written.length === 1 ? "" : "s"} written.`,
    );
    printAutoResolvedLedger(report);
    p.outro("Nothing to review.");
    return;
  }
  if (filtered.length === 0) {
    p.log.info(`No findings match ${describeFindingsFilter(opts)}.`);
    printAutoResolvedLedger(report);
    p.outro("Nothing to review.");
    return;
  }

  // Group by doc+anchor in first-appearance order; findings numbered globally
  // 1..N so a review can reference "finding 42" across the whole list.
  const groups = new Map<string, GuardBirthFinding[]>();
  for (const f of filtered) {
    const key = `${f.doc}\0${f.anchor}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(f);
    else groups.set(key, [f]);
  }

  let n = 0;
  for (const bucket of groups.values()) {
    p.log.message("");
    p.log.message(`${bucket[0].doc} › ${bucket[0].anchor}`);
    for (const f of bucket) {
      n += 1;
      p.log.message(`  ${n}. [${findingKind(f)}] ${f.title}`);
      p.log.message(`     ${oneLine(f.expected)} → ${oneLine(f.actual)}`);
      // Triage verdict + the concrete recommendation for how to unblock it — the
      // Opus judgment attached at generate. Absent on older reports / untriaged runs.
      if (f.triage) {
        p.log.message(`     verdict: ${f.triage.verdict} (${f.triage.confidence} confidence)`);
        p.log.message(`     recommend: ${oneLine(f.triage.recommendation)}`);
      }
      // Item-14 escalation: this finding kept auto-resolving without converging, so it
      // is surfaced instead of auto-resolved again — re-generation is not fixing it.
      if (f.autoResolveEscalation) {
        p.log.message(
          `     ⚠ re-generation is not fixing this — auto-resolved ${f.autoResolveEscalation.count}× as ${f.autoResolveEscalation.verdict}; needs a human`,
        );
      }
      if (f.evidencePath) p.log.message(`     evidence: ${f.evidencePath}`);
    }
  }

  // The auto-resolved ledger beneath the human findings — a divider separates them.
  printAutoResolvedLedger(report);

  const suffix = filterActive ? ` (${describeFindingsFilter(opts)})` : "";
  p.outro(`${filtered.length} finding${filtered.length === 1 ? "" : "s"}${suffix}.`);
}

/** ` (git 9, db 3, … 12 more)` — top blocked-on capabilities; the full tally lives
 *  in the report/`guard status`, the terminal shows the story. */
function blockedOnBreakdown(byCapability: Record<string, number>): string {
  const parts = Object.entries(byCapability)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([cap, n]) => `${cap} ${n}`);
  if (parts.length === 0) return "";
  const TOP = 5;
  const shown = parts.slice(0, TOP);
  const rest = parts.length - shown.length;
  return ` (${shown.join(", ")}${rest > 0 ? `, … ${rest} more` : ""})`;
}

/** One-line reason for the binding outcomes that skip execution. */
const BINDING_REASON: Record<"stale" | "orphaned", string> = {
  stale: "section edited since binding",
  orphaned: "section not found",
};

function printLoadErrors(loadErrors: { file: string; message: string }[]): void {
  if (loadErrors.length === 0) return;
  p.log.warn(`${loadErrors.length} scenario file${loadErrors.length === 1 ? "" : "s"} could not be loaded:`);
  for (const e of loadErrors) console.log(`  ${e.file}: ${e.message}`);
}
