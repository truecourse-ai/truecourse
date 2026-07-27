/**
 * `truecourse guard flows` — the flow inventory and its drill-down.
 *
 *   guard flows              list every synthesized flow with its per-surface state
 *   guard flows --show <id>  one flow: goal, milestones, binds, surfaces, journeys, gaps
 *
 * Deterministic and LLM-free: it joins the committed flow corpus
 * (`scenarios/flows.json`), the flow-keyed manifest (`scenarios/manifest.json`),
 * the committed scenarios (for their journey paths), and the last run
 * (`guard/LATEST.json`). Any of them may be missing — each absence renders as an
 * empty state pointing at the command that produces it, never as an error.
 */

import * as p from "@clack/prompts";
import { readFlowsFile } from "@truecourse/guard-generator";
import { loadScenarios } from "@truecourse/guard-runner";
import { readManifest, readGuardLatest } from "@truecourse/core/lib/guard-store";
import type {
  GuardFlow,
  GuardManifestFlow,
  GuardManifestGap,
  GuardScenarioResult,
} from "@truecourse/shared";
import { gapChipLabel, gapLine, milestoneChain } from "../lib/guard-flow-format.js";

export interface RunGuardFlowsOptions {
  cwd?: string;
  /** Show ONE flow's detail instead of the list (`--show <id>`). */
  show?: string;
}

/** Per-scenario run marks — the same glyphs `guard run` and `guard status` use. */
const MARK: Record<GuardScenarioResult["outcome"], string> = {
  pass: "✓",
  fail: "✗",
  error: "⚠",
  stale: "~",
  orphaned: "○",
};

/** A flow's coverage state — the list glyph and the header tally both key on it. */
type FlowState = "guarded" | "gap" | "ungenerated";

interface FlowView {
  flow: GuardFlow;
  /** The manifest entry, absent when the flow was synthesized but never generated. */
  entry: GuardManifestFlow | undefined;
  state: FlowState;
  /** Worst run outcome across the flow's scenarios; null when nothing ran. */
  runOutcome: GuardScenarioResult["outcome"] | null;
  /** One chip per surface, scenarios first then gaps: `api ✓`, `web awaiting driver`. */
  chips: string[];
}

/** Non-pass outcomes, worst first — the flow row inherits the worst of its scenarios. */
const OUTCOME_SEVERITY: GuardScenarioResult["outcome"][] = ["fail", "error", "stale", "orphaned", "pass"];

function worstRunOutcome(results: GuardScenarioResult[]): GuardScenarioResult["outcome"] | null {
  for (const outcome of OUTCOME_SEVERITY) {
    if (results.some((r) => r.outcome === outcome)) return outcome;
  }
  return null;
}

function flowState(entry: GuardManifestFlow | undefined): FlowState {
  if (!entry) return "ungenerated";
  if (entry.scenarios.length === 0) return "gap";
  return entry.gaps.length === 0 ? "guarded" : "gap";
}

/** The row glyph: a run outcome outranks coverage, since a red flow is the story. */
function flowGlyph(view: FlowView): string {
  if (view.runOutcome && view.runOutcome !== "pass") return MARK[view.runOutcome];
  if (view.state === "ungenerated") return MARK.orphaned;
  return view.state === "guarded" ? "✓" : "✗";
}

/** Worst-first ordering: run drift, then coverage gaps, then healthy flows. */
function severityRank(view: FlowView): number {
  if (view.runOutcome && view.runOutcome !== "pass") return 0;
  if (view.state === "ungenerated") return 1;
  if (view.state === "gap") return 2;
  return 3;
}

/** Join the flow corpus with the manifest and the last run — the list's data model. */
function buildViews(
  flows: GuardFlow[],
  entries: Map<string, GuardManifestFlow>,
  resultsByScenario: Map<string, GuardScenarioResult>,
): FlowView[] {
  return flows.map((flow) => {
    const entry = entries.get(flow.id);
    const results = (entry?.scenarios ?? [])
      .map((s) => resultsByScenario.get(s.id))
      .filter((r): r is GuardScenarioResult => !!r);
    const chips = [
      ...(entry?.scenarios ?? []).map((s) => {
        const result = resultsByScenario.get(s.id);
        // No run yet ⇒ the scenario is committed, i.e. it passed birth: `api ✓`.
        return `${s.surface} ${result ? MARK[result.outcome] : "✓"}`;
      }),
      ...(entry?.gaps ?? []).map((g) => `${g.surface} ${gapChipLabel(g)}`),
    ];
    return { flow, entry, state: flowState(entry), runOutcome: worstRunOutcome(results), chips };
  });
}

export async function runGuardFlows(opts: RunGuardFlowsOptions = {}): Promise<void> {
  const repoRoot = opts.cwd ?? process.cwd();
  const flowsFile = readFlowsFile(repoRoot);
  const manifest = await readManifest(repoRoot);
  const latest = await readGuardLatest(repoRoot);

  const entries = new Map((manifest?.flows ?? []).map((f) => [f.flowId, f]));
  const resultsByScenario = new Map((latest?.scenarios ?? []).map((s) => [s.id, s]));

  p.intro(opts.show ? "Guard flow" : "Guard flows");

  if (!flowsFile || flowsFile.flows.length === 0) {
    p.log.warn("No flows yet — run `truecourse guard generate` to synthesize them from the spec corpus.");
    p.outro("Nothing to show.");
    return;
  }

  const views = buildViews(flowsFile.flows, entries, resultsByScenario);

  if (opts.show) {
    const view = views.find((v) => v.flow.id === opts.show);
    if (!view) {
      p.log.error(`No flow with id \`${opts.show}\`.`);
      const ids = views.slice(0, 5).map((v) => v.flow.id);
      p.log.message(`  known ids: ${ids.join(" · ")}${views.length > ids.length ? " · …" : ""}`);
      p.outro("Run `truecourse guard flows` for the full list.");
      process.exit(1);
      return;
    }
    printFlowDetail(view, repoRoot, resultsByScenario);
    return;
  }

  printFlowList(views, flowsFile.noFlowClaims.length);
}

/** The inventory: a header tally, then one padded row per flow, worst first. */
function printFlowList(views: FlowView[], noFlowClaims: number): void {
  const guarded = views.filter((v) => v.state === "guarded").length;
  const gap = views.filter((v) => v.state === "gap").length;
  const ungenerated = views.filter((v) => v.state === "ungenerated").length;
  const header = [`FLOWS (${views.length})`, `${guarded} guarded`, `${gap} gap`];
  if (ungenerated > 0) header.push(`${ungenerated} not generated`);
  p.log.step(header.join(" · "));

  const rows = [...views].sort((a, b) => severityRank(a) - severityRank(b) || a.flow.id.localeCompare(b.flow.id));
  const idWidth = Math.min(28, Math.max(...rows.map((v) => v.flow.id.length)));
  const chipWidth = Math.min(34, Math.max(...rows.map((v) => v.chips.join(" · ").length)));

  for (const view of rows) {
    const chips = view.chips.length > 0 ? view.chips.join(" · ") : "not generated";
    const milestones = view.flow.milestones.length;
    const sections = view.flow.bindings.length;
    const counts = `${milestones} milestone${milestones === 1 ? "" : "s"} · ${sections} section${sections === 1 ? "" : "s"}`;
    p.log.message(
      `  ${flowGlyph(view)} ${view.flow.id.padEnd(idWidth)}  ${chips.padEnd(chipWidth)}  ${counts}`,
    );
  }

  if (noFlowClaims > 0) {
    p.log.message("");
    p.log.message(
      `  ${noFlowClaims} claim${noFlowClaims === 1 ? "" : "s"} in no flow — see \`noFlowClaims\` in .truecourse/scenarios/flows.json`,
    );
  }
  p.outro("Inspect one with `truecourse guard flows --show <id>`.");
}

/** The drill-down: goal, milestones, binds, per-surface scenarios, journeys, gaps. */
function printFlowDetail(
  view: FlowView,
  repoRoot: string,
  resultsByScenario: Map<string, GuardScenarioResult>,
): void {
  const { flow, entry } = view;
  p.log.step(`${flow.title} — ${flow.goal}`);
  p.log.message(`  milestones  ${milestoneChain(flow.milestones)}`);

  for (const [i, line] of bindLines(flow).entries()) {
    p.log.message(`  ${i === 0 ? "binds      " : "           "} ${line}`);
  }

  if (flow.composedOf.length > 0) {
    p.log.message(`  composes    ${flow.composedOf.join(" · ")}`);
  }

  const surfaces = surfaceLines(entry, resultsByScenario);
  const surfaceText = surfaces.length > 0 ? surfaces.join(" · ") : "(none) — run `truecourse guard generate`";
  p.log.message(`  surfaces    ${surfaceText}`);

  const journeys = journeyIds(repoRoot, entry);
  if (journeys.length > 0) p.log.message(`  journeys    ${journeys.join(" · ")}`);

  const gaps = entry?.gaps ?? [];
  for (const [i, gap] of gaps.entries()) {
    p.log.message(`  ${i === 0 ? "gaps       " : "           "} ${gapLine(gap)}`);
  }

  p.outro(
    view.state === "guarded"
      ? "Run it with `truecourse guard run`."
      : "Re-run `truecourse guard generate` after closing the gaps.",
  );
}

/** One line per bound doc: `docs/specs/tasks.md  §creating-tasks · §listing-tasks`. */
function bindLines(flow: GuardFlow): string[] {
  const byDoc = new Map<string, string[]>();
  for (const b of flow.bindings) {
    const anchors = byDoc.get(b.doc) ?? [];
    if (!anchors.includes(b.anchor)) anchors.push(b.anchor);
    byDoc.set(b.doc, anchors);
  }
  return [...byDoc.entries()].map(([doc, anchors]) => `${doc}  ${anchors.map((a) => `§${a}`).join(" · ")}`);
}

/** `api → task-lifecycle.api.1 (pass ✓)` — the run state when there is one, else birth. */
function surfaceLines(
  entry: GuardManifestFlow | undefined,
  resultsByScenario: Map<string, GuardScenarioResult>,
): string[] {
  const lines = (entry?.scenarios ?? []).map((s) => {
    const result = resultsByScenario.get(s.id);
    // A committed scenario passed birth by construction; a run outcome supersedes it.
    const state = result ? `${result.outcome} ${MARK[result.outcome]}` : "birth ✓";
    const drift = result?.journeyDrifted ? " · journey drifted" : "";
    return `${s.surface} → ${s.id} (${state}${drift})`;
  });
  for (const gap of entry?.gaps ?? []) lines.push(`${gap.surface} → ${gapChipLabel(gap)}`);
  return lines;
}

/**
 * The realization plan behind the flow's scenarios — the journey ids each one is
 * grounded on, read from the committed YAMLs (journeys are derived, never
 * committed; only the ids/fingerprints ride in the scenario).
 */
function journeyIds(repoRoot: string, entry: GuardManifestFlow | undefined): string[] {
  if (!entry || entry.scenarios.length === 0) return [];
  const wanted = new Set(entry.scenarios.map((s) => s.id));
  const ids: string[] = [];
  for (const scenario of loadScenarios(repoRoot).scenarios) {
    if (!wanted.has(scenario.id)) continue;
    for (const id of scenario.journey?.path ?? []) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
