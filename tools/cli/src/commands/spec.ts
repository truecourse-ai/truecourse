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
import { buildCorpusConflicts, openConflicts } from "@truecourse/shared";
import { StepTracker } from "@truecourse/core/progress";
import {
  curateInProcess,
  CURATE_STEPS,
  EstimateDeclined,
} from "@truecourse/core/commands/spec-in-process";
import { registerProject } from "@truecourse/core/config/registry";
import { createStdoutStepRenderer } from "../lib/stdout-step-renderer.js";
import { preflightClaudeOrExit } from "../lib/claude-preflight.js";
import { promptLlmEstimate } from "./llm-prompt.js";
import { requireGitRepo } from "./git-guard.js";

export interface RunSpecOptions {
  cwd?: string;
  /** LLM transport: `cli` (default, spawn `claude -p`) or `agent` (filesystem mailbox under `io`). */
  llm?: "cli" | "agent";
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
  // fail every doc. Probe once up front (the `agent` transport answers via the
  // filesystem mailbox, so the probe is irrelevant there).
  if (opts.llm !== "agent") await preflightClaudeOrExit();
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
  // A failed classification is kept by fail-open — never silently: a broken
  // transport once failed 100% of calls and the corpus looked merely permissive.
  if (s.classifyFailed > 0) {
    p.log.warn(
      `${s.classifyFailed} doc${s.classifyFailed === 1 ? "" : "s"} failed classification — kept by default. ` +
        `All ${s.classifyFailed} failing means the LLM transport is broken, not that the docs are relevant.`,
    );
  }
  p.log.step(`areas       ${s.areaCount}`);
  p.log.step(`overlaps    ${s.overlapFlags}`);
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
  p.outro(
    openCount === 0
      ? "Corpus written to .truecourse/specs/corpus.json. Run `truecourse guard generate`."
      : `Corpus written to .truecourse/specs/corpus.json. ${openCount} conflict${openCount === 1 ? "" : "s"} to resolve (\`truecourse spec conflicts list\`), then \`truecourse guard generate\`.`,
  );
}


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

  // No orphan line: a verdict that no longer matches a flagged dispute is PRUNED
  // by the scan that wrote the corpus (see `curate()`), so status has nothing
  // stranded left to report.
  p.outro(
    open === 0
      ? "No open overlaps — run `truecourse guard generate`."
      : "Open overlaps — see `truecourse spec conflicts list`.",
  );
}

