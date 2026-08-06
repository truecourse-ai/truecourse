/**
 * `truecourse guard findings` — everything the last generate FOUND, grouped by the
 * flow it happened to. A read view over `guard/result.json`: `guard generate`
 * already surfaced the headline, so this exits 0 whether findings exist or not and
 * nonzero only when no generate has run at all.
 *
 * The rows are split by WHOSE FAULT they are (`guardFindingClass`, the shared
 * taxonomy the dashboard reads too):
 *
 *   drift      the code and the doc disagree — a committed red scenario, real work;
 *   defect     ours — a generation-defect verdict or a fidelity rejection. Nothing
 *              was committed; the flow re-authors next generate. Never drift;
 *   escalated  a defect re-generation keeps failing to fix, so it IS a human task.
 *
 * Under a divider comes the AUTO-RESOLVED ledger: the high-confidence judgments the
 * tool acted on ITSELF this run. It is not a task list — it is the audit trail that
 * makes "we handled it" visible instead of silent.
 *
 * `--json` is the point of the command for an agent: one stable envelope (counts,
 * the flow groups, the ledger) with every finding's own fields carried through
 * verbatim. `--kind` narrows the findings, `--flow` narrows findings AND ledger.
 */

import * as p from "@clack/prompts";
import { readGuardResult } from "@truecourse/core/lib/guard-store";
import {
  GUARD_FINDING_CLASS_LABEL,
  guardFindingClass,
  type GuardAutoResolved,
  type GuardBirthFinding,
  type GuardFindingClass,
} from "@truecourse/shared";
import { clip } from "../lib/guard-flow-format.js";

/** The classes `--kind` accepts — the display taxonomy, not the wire `kind`. */
export const GUARD_FINDING_CLASSES: GuardFindingClass[] = ["drift", "defect", "escalation"];

export interface RunGuardFindingsOptions {
  cwd?: string;
  /** Restrict to one class (`--kind drift|defect|escalation`). */
  kind?: string;
  /** Restrict to one flow id (`--flow <id>`) — narrows the ledger too. */
  flow?: string;
  /** Emit the machine-readable envelope instead of the formatted list. */
  json?: boolean;
}

/** One flow's findings, in report order — the grouping unit. */
interface FlowGroup {
  flowId: string;
  findings: GuardBirthFinding[];
}

/**
 * Group findings by the FLOW they happened to, first-seen order. A finding with no
 * flow (hand-written work, an older report) groups under its section instead of
 * being dropped — never silently missing from the one command that lists findings.
 */
export function groupFindingsByFlow(findings: readonly GuardBirthFinding[]): FlowGroup[] {
  const groups = new Map<string, FlowGroup>();
  for (const f of findings) {
    const flowId = f.flowId ?? `${f.doc} › ${f.anchor}`;
    const group = groups.get(flowId);
    if (group) group.findings.push(f);
    else groups.set(flowId, { flowId, findings: [f] });
  }
  return [...groups.values()];
}

/** Per-class counts over a finding set — the header line and the `--json` counts. */
export function countFindingClasses(
  findings: readonly GuardBirthFinding[],
): Record<GuardFindingClass, number> {
  const counts: Record<GuardFindingClass, number> = { drift: 0, defect: 0, escalation: 0 };
  for (const f of findings) counts[guardFindingClass(f)]++;
  return counts;
}

/** The `--json` row: the class this line derives, plus the finding's own fields. */
function jsonFinding(f: GuardBirthFinding): Record<string, unknown> {
  return { class: guardFindingClass(f), ...f };
}

/** The active filters as one phrase, for the empty-state and closing copy. */
function describeFilters(opts: RunGuardFindingsOptions): string {
  const parts: string[] = [];
  if (opts.kind) parts.push(`kind ${opts.kind}`);
  if (opts.flow) parts.push(`flow ${opts.flow}`);
  return parts.join(" · ") || "the filter";
}

/** `drift 1 · tool defect 2` — the non-zero classes of a finding set. */
function classSummary(counts: Record<GuardFindingClass, number>): string {
  const parts = GUARD_FINDING_CLASSES.filter((c) => counts[c] > 0).map(
    (c) => `${counts[c]} ${GUARD_FINDING_CLASS_LABEL[c]}`,
  );
  return parts.join(" · ");
}

export async function runGuardFindings(opts: RunGuardFindingsOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  const report = await readGuardResult(repoRoot);

  // The ONE nonzero exit: no generate has run, so there is nothing to read.
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

  // An unknown `--kind` is refused rather than silently matching nothing: an agent
  // reading an empty list would conclude the repo is clean.
  if (opts.kind && !GUARD_FINDING_CLASSES.includes(opts.kind as GuardFindingClass)) {
    const known = GUARD_FINDING_CLASSES.join(" | ");
    if (opts.json) console.error(`Unknown --kind "${opts.kind}". Known kinds: ${known}.`);
    else {
      p.intro("Guard findings");
      p.log.error(`Unknown --kind \`${opts.kind}\` — one of: ${known}.`);
      p.outro("Nothing to show.");
    }
    process.exit(1);
    return;
  }

  const matched = report.birthFindings.filter(
    (f) =>
      (!opts.kind || guardFindingClass(f) === opts.kind) && (!opts.flow || f.flowId === opts.flow),
  );
  // The ledger is flow-keyed, so `--flow` narrows it; `--kind` names a FINDING
  // class and an auto-resolution is not a finding, so it never narrows the ledger.
  const ledger = (report.autoResolved ?? []).filter((r) => !opts.flow || r.flowId === opts.flow);
  const counts = countFindingClasses(matched);
  const groups = groupFindingsByFlow(matched);

  if (opts.json) {
    console.log(
      JSON.stringify(
        {
          generatedAt: report.generatedAt,
          filters: {
            ...(opts.kind ? { kind: opts.kind } : {}),
            ...(opts.flow ? { flow: opts.flow } : {}),
          },
          total: report.birthFindings.length,
          matched: matched.length,
          counts,
          flows: groups.map((g) => ({ flowId: g.flowId, findings: g.findings.map(jsonFinding) })),
          autoResolved: ledger,
        },
        null,
        2,
      ),
    );
    return;
  }

  p.intro("Guard findings");
  p.log.step(`generated   ${report.generatedAt}`);
  const filtered = !!opts.kind || !!opts.flow;
  const summary = classSummary(counts);
  p.log.step(
    `findings    ${report.birthFindings.length} total${filtered ? ` · ${matched.length} match filter` : ""}${
      summary ? ` · ${summary}` : ""
    }`,
  );

  if (report.birthFindings.length === 0 && ledger.length === 0) {
    p.log.success("No findings in the last generate.");
    p.outro("Nothing to review.");
    return;
  }
  if (matched.length === 0 && ledger.length === 0) {
    p.log.info(`No findings match ${describeFilters(opts)}.`);
    p.outro("Nothing to review.");
    return;
  }

  let n = 0;
  for (const group of groups) {
    p.log.message("");
    p.log.message(group.flowId);
    for (const f of group.findings) {
      n += 1;
      for (const line of findingLines(f, n)) p.log.message(line);
    }
  }

  if (ledger.length > 0) {
    p.log.message("");
    p.log.message(`── auto-resolved (${ledger.length}) — handled without a task ──`);
    for (const row of ledger) p.log.message(`  ${autoResolvedLine(row)}`);
  }

  const suffix = filtered ? ` (${describeFilters(opts)})` : "";
  p.outro(
    matched.length === 0
      ? `No findings${suffix} — ${ledger.length} auto-resolved.`
      : `${matched.length} finding${matched.length === 1 ? "" : "s"}${suffix}.`,
  );
}

/**
 * ONE finding, as the lines a reviewer reads: what class it is and which surface,
 * the triage verdict in its own words, the disagreement, and where the evidence
 * lives. A withheld row says so explicitly — "no scenario was committed" is the whole
 * difference between our defect and the repo's drift.
 */
export function findingLines(f: GuardBirthFinding, n: number): string[] {
  const cls = guardFindingClass(f);
  const surface = f.surface ? `${f.surface} · ` : "";
  const lines = [`  ${n}. [${GUARD_FINDING_CLASS_LABEL[cls]}] ${surface}${clip(f.title, 80)}`];

  if (f.kind === "fidelity") {
    lines.push(`     fidelity review — ${clip(f.actual, 100)}`);
  } else if (f.triage) {
    lines.push(`     ${f.triage.verdict} (${f.triage.confidence}) — ${clip(f.triage.brief, 120)}`);
    lines.push(`     do: ${clip(f.triage.recommendation, 120)}`);
  } else {
    lines.push("     untriaged — no verdict was reached, so it committed as drift");
  }

  if (f.kind !== "fidelity") {
    lines.push(
      `     step ${f.step}${f.failedMilestone ? ` (milestone ${f.failedMilestone})` : ""} · expected ${clip(
        f.expected,
        60,
      )} · actual ${clip(f.actual, 60)}`,
    );
  }
  if (f.autoResolveEscalation) {
    const { count, source } = f.autoResolveEscalation;
    lines.push(
      `     re-generation is not fixing this — ${count} ${source} auto-resolution${count === 1 ? "" : "s"} without converging`,
    );
  }
  if (cls === "drift" && f.file) lines.push(`     scenario: ${f.file}`);
  if (cls !== "drift") lines.push("     withheld — no scenario was committed; the flow re-authors next generate");
  if (f.evidencePath) lines.push(`     evidence: ${f.evidencePath}`);
  return lines;
}

/** One ledger row: the flow, what the tool did, and what came of it. */
export function autoResolvedLine(row: GuardAutoResolved): string {
  const subject = `${row.flowId} · ${row.surface}`;
  if (row.kind === "fidelity-discard") {
    return `${subject} — discarded a weak scenario and re-authored it once → ${row.outcome} (${clip(row.mismatch, 80)})`;
  }
  if (row.kind === "retire") {
    return `${subject} — retired authoring after ${row.attempts} defective attempt${row.attempts === 1 ? "" : "s"} (${clip(row.detail, 80)})`;
  }
  return `${subject} — retired a ${row.verdict} failure, re-attempts next generate (${clip(row.brief, 80)})`;
}
