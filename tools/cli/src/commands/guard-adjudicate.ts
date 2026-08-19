/**
 * `truecourse guard adjudicate` — classify the current board's failures
 * (plan 05): a deterministic pre-pass settles the failures that explain
 * themselves (a declared expected-red, a setup defect, an unserved route),
 * the verdict cache settles the ones an identical prior failure already
 * answered, and one agent session per surprise reads the evidence, hunts the
 * mechanism, and ends with a verdict the fold validates and persists onto the
 * run snapshot and the board.
 *
 *   guard adjudicate                       adjudicate every unadjudicated failure
 *   guard adjudicate --scenario <id>       re-adjudicate one row (prior verdict briefed)
 *   guard adjudicate --run <id>            only failures recorded by that run
 *   guard adjudicate --report              also render guard/findings.md (bug|drift)
 */

import * as p from "@clack/prompts";
import {
  planGuardAdjudication,
  readGuardAdjudicationView,
  runGuardAdjudication,
  writeGuardAdjudicationReport,
  type GuardAdjudicationRun,
  type GuardAdjudicationVerdictRow,
} from "@truecourse/core/commands/guard-adjudicate";
import { assertSessionBackendReady } from "@truecourse/core/services/llm/session-driver";
import { preflightLlmOrExit, type LlmTransportFlag } from "../lib/claude-preflight.js";
import { isInteractive } from "./helpers.js";

export interface RunGuardAdjudicateOptions {
  cwd?: string;
  /** Only failures recorded by this run. */
  run?: string;
  /** Adjudicate exactly these scenario ids (repeatable `--scenario`). */
  scenario?: string[];
  /** Render `guard/findings.md` after the verdicts land. */
  report?: boolean;
  /** How many sessions run at once. */
  concurrency?: number;
  yes?: boolean;
  llmTransport?: LlmTransportFlag;
}

export async function runGuardAdjudicate(opts: RunGuardAdjudicateOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  p.intro("Adjudicate failures");

  if (opts.llmTransport === "agent") {
    p.log.error(
      "--llm-transport agent has no session driver: an adjudication session needs a live backend (claude-code or api).",
    );
    p.outro("Aborted.");
    process.exit(1);
  }

  const view = await readGuardAdjudicationView(repoRoot);
  if (view.runId === null) {
    p.log.error("No guard board. Run `truecourse guard run` first — adjudication classifies its failures.");
    p.outro("Aborted.");
    process.exit(1);
  }
  if (view.failures.length === 0) {
    if (opts.report) {
      const report = await writeGuardAdjudicationReport(repoRoot);
      p.log.info(report ? `report    ${report.findings} finding(s) → ${report.path}` : "Nothing to report.");
    }
    p.outro("The board has no failing scenario — nothing to adjudicate.");
    return;
  }

  // The pre-flight, in the §3.5 shape: the run's OWN pre-pass and cache keys
  // decide which failures pay for a session, so the confirm and the spend can
  // never disagree.
  let plan;
  try {
    plan = await planGuardAdjudication(repoRoot, {
      ...(opts.run ? { runId: opts.run } : {}),
      ...(opts.scenario && opts.scenario.length > 0 ? { scenarios: opts.scenario } : {}),
    });
  } catch (error) {
    p.log.error(error instanceof Error ? error.message : String(error));
    p.outro("Aborted.");
    process.exit(1);
  }
  const settled = plan.prePassed + plan.cached;
  p.log.info(
    [
      `${plan.failures} failure(s) in scope` +
        (plan.alreadyAdjudicated > 0 ? ` (${plan.alreadyAdjudicated} already adjudicated, skipped)` : ""),
      settled > 0
        ? `  ${plan.prePassed} settle deterministically · ${plan.cached} from the verdict cache — zero sessions`
        : "",
      plan.sessions > 0
        ? `  ${plan.sessions} session(s), each up to ${plan.maxTurnsPerSession} turns (most converge in ~${plan.expectedTurns}); a suspected bug may spawn one control child.`
        : "  no session needed",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (plan.failures === 0) {
    if (opts.report) {
      const report = await writeGuardAdjudicationReport(repoRoot);
      if (report) p.log.info(`report    ${report.findings} finding(s) → ${report.path}`);
    }
    p.outro("Every failure already carries a verdict. `--scenario <id>` re-adjudicates one.");
    return;
  }

  if (plan.sessions > 0) {
    await preflightLlmOrExit(opts.llmTransport);
    try {
      await assertSessionBackendReady(opts.llmTransport);
    } catch (error) {
      p.log.error(error instanceof Error ? error.message : String(error));
      p.outro("Aborted.");
      process.exit(1);
    }
    if (!opts.yes && isInteractive()) {
      const go = await p.confirm({ message: `Adjudicate ${plan.failures} failure(s) (${plan.sessions} session(s))?` });
      if (p.isCancel(go) || !go) {
        p.outro("Cancelled.");
        return;
      }
    }
  }

  const spinner = p.spinner();
  spinner.start("Adjudicating");
  const inFlight = new Map<string, string>();
  let done = 0;
  let total = plan.sessions;
  const render = (): string =>
    total === 0
      ? "pre-pass"
      : `${done}/${total} session(s)` +
        (inFlight.size > 0
          ? ` · ${[...inFlight.entries()].map(([id, tool]) => (tool ? `${id} ${tool}` : id)).join(", ").slice(0, 72)}`
          : "");

  let run: GuardAdjudicationRun;
  try {
    run = await runGuardAdjudication({
      repoRoot,
      ...(opts.run ? { runId: opts.run } : {}),
      ...(opts.scenario && opts.scenario.length > 0 ? { scenarios: opts.scenario } : {}),
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.llmTransport ? { transport: opts.llmTransport } : {}),
      ...(opts.report !== undefined ? { report: opts.report } : {}),
      onStatus: (message) => spinner.message(message),
      onProgress: (event) => {
        if (event.kind === "session-start") {
          total = event.total;
          inFlight.set(event.scenarioId, "");
        } else if (event.kind === "session-done") {
          inFlight.delete(event.scenarioId);
          done += 1;
        }
        spinner.message(render());
      },
      onSessionEvent: (scenarioId, event) => {
        if (event.type === "assistant-turn" && event.toolCall && inFlight.has(scenarioId)) {
          inFlight.set(scenarioId, event.toolCall.name);
          spinner.message(render());
        }
      },
    });
  } catch (error) {
    spinner.stop("Failed");
    p.log.error(error instanceof Error ? error.message : String(error));
    p.outro("Aborted.");
    process.exit(1);
  }
  spinner.stop(
    run.transport
      ? `${run.usage.sessions.count} session(s) on ${run.transport.provider}/${run.transport.model} via ${run.transport.mode}`
      : "settled without a session",
  );

  for (const row of run.scenarios) printVerdict(row);

  const routing = summarizeRouting(run.scenarios);
  p.log.message(
    [
      `verdicts  ${run.scenarios.filter((r) => r.verdict).length}/${run.scenarios.length}`,
      routing,
      run.findingsLedger ? `findings  ${run.findingsLedger.appended} → ${run.findingsLedger.path}` : "",
      run.report ? `report    ${run.report.findings} finding(s) → ${run.report.path}` : "",
      run.usage.sessions.count > 0 ? `turns     ${run.usage.sessions.turns}` : "",
      run.usage.sessions.count > 0 ? `tokens    ${run.usage.sessions.tokens.toLocaleString()}` : "",
      run.usage.sessions.costUsd > 0 ? `cost      $${run.usage.sessions.costUsd.toFixed(2)}` : "",
      run.runDir ? `sessions  ${run.runDir}` : "",
      `converged ${run.converged ? "yes" : "no"}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const failed = run.scenarios.filter((row) => row.failed !== undefined);
  if (failed.length > 0) process.exitCode = 1;
  p.outro(
    failed.length > 0
      ? `${failed.length} failure(s) got no verdict — re-run to retry them.`
      : "Every scoped failure carries a verdict. Review, and commit `guard/LATEST.json` per the board convention.",
  );
}

function printVerdict(row: GuardAdjudicationVerdictRow): void {
  if (row.failed) {
    p.log.error(`${row.scenarioId} — no verdict (${row.source}): ${row.failed}`);
    return;
  }
  const v = row.verdict!;
  const head = `${row.scenarioId} — ${v.class} (${v.confidence}, ${row.source})`;
  const detail = [
    `  ${v.mechanism}${v.code ? ` (${v.code.file}:${v.code.line})` : ""}`,
    ...(v.control ? [`  control: ${v.control.conclusion} (${v.control.transcriptRef})`] : []),
    ...(v.fix ? [`  fix (${v.fix.layer}): ${v.fix.description}`] : []),
    ...(row.routing?.tainted
      ? [
          `  flow tainted (auto-resolutions ×${row.routing.tainted.count})${
            row.routing.tainted.escalated ? " — ESCALATED: re-generation is not fixing this" : ""
          }`,
        ]
      : []),
    ...(row.routing?.autoDismissed
      ? [`  claim auto-dismissed: ${row.routing.autoDismissed.doc} #${row.routing.autoDismissed.anchor}`]
      : []),
  ].join("\n");
  if (v.class === "bug" || v.class === "drift") p.log.warn(`${head}\n${detail}`);
  else p.log.success(`${head}\n${detail}`);
}

function summarizeRouting(rows: readonly GuardAdjudicationVerdictRow[]): string {
  const byClass = new Map<string, number>();
  for (const row of rows) {
    if (!row.verdict) continue;
    byClass.set(row.verdict.class, (byClass.get(row.verdict.class) ?? 0) + 1);
  }
  if (byClass.size === 0) return "";
  return `classes   ${[...byClass.entries()].map(([c, n]) => `${c} ${n}`).join(" · ")}`;
}
