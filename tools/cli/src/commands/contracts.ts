import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import {
  CanonicalSpecMissingError,
  defaultConcurrency,
  generateContracts,
  hasCanonicalSpec,
  spawnRunner,
} from "@truecourse/contract-extractor";
import { stampGeneratedMarker } from "@truecourse/core/commands/spec-in-process";
import { trackEvent, bucketFileCount, bucketDuration } from "@truecourse/core/services/telemetry";
import { resolveFallbackModel, resolveModel } from "@truecourse/core/config/llm-models";
import { syncShippedTcSyntax } from "./helpers.js";
import { requireGitRepo } from "./git-guard.js";
import { preflightClaudeOrExit } from "../lib/claude-preflight.js";

export interface RunContractsGenerateOptions {
  /** When true, perform a dry run — write nothing, show what would change. */
  diff?: boolean;
  /** Override the repo root; defaults to cwd. */
  cwd?: string;
}

export async function runContractsGenerate(
  options: RunContractsGenerateOptions = {},
): Promise<void> {
  const repoRoot = options.cwd ?? process.cwd();
  const startedAt = Date.now();

  p.intro(options.diff ? "Contracts (dry run)" : "Contracts");
  await requireGitRepo(repoRoot);

  // Module 2 reads the canonical spec produced by Module 1. If
  // `.truecourse/specs/` doesn't exist, the user hasn't run the
  // consolidator yet — tell them and bail.
  if (!hasCanonicalSpec(repoRoot)) {
    p.log.error(
      "No .truecourse/specs/claims.json found. Run `truecourse spec scan` first to build the canonical claim set.",
    );
    p.outro("Aborted.");
    process.exit(1);
  }

  // Extraction fans out one `claude` subprocess per spec slice, so a broken or
  // expired CLI would fail every slice and the user would only learn that at the
  // end. Probe once up front and bail with the CLI's own error if it isn't ready.
  await preflightClaudeOrExit();

  // Run the extraction pipeline against the canonical spec.
  const concurrency = defaultConcurrency();
  const extractModel = resolveModel("contract.extract", undefined, repoRoot);
  const repairModel = resolveModel("contract.repair", undefined, repoRoot);
  const fallbackModel = resolveFallbackModel(repoRoot) ?? undefined;
  // Slice counter — `totalSlices` comes from generateContracts's onSlicesReady
  // (fired before extraction). We tick on *completion* (onSliceDone), not start:
  // extraction is concurrent, so start events all fire up-front and the counter
  // would race to the total then sit silent through the LLM calls. Counting
  // completions makes the count reflect real, finished work.
  let totalSlices = 0;
  let doneSlices = 0;
  const runner = spawnRunner({
    concurrency,
    model: extractModel,
    fallbackModel,
    onSliceDone: (s, ok) => {
      p.log.step(
        `extracted  ${++doneSlices}/${totalSlices}  ${s.specPath} :: ${s.headingPath.join(" → ")}${ok ? "" : "  (failed)"}`,
      );
    },
  });

  let result;
  try {
    result = await generateContracts({
      repoRoot,
      runner,
      models: { extract: extractModel, repair: repairModel, fallback: fallbackModel },
      dryRun: !!options.diff,
      onSlicesReady: (t) => {
        totalSlices = t;
      },
      onSliceCacheHit: (s) => {
        p.log.message(`  cache hit  ${++doneSlices}/${totalSlices}  ${s.specPath} :: ${s.headingPath.join(" → ")}`, { symbol: "·" });
      },
      // The repair pass runs sequential `claude` re-prompts after extraction —
      // stream each one so the terminal isn't silent through the LLM calls.
      onRepairProgress: (e) => {
        p.log.step(`repairing  ${e.done}/${e.total}  ${e.message}`);
      },
    });
  } catch (e) {
    if (e instanceof CanonicalSpecMissingError) {
      p.log.error(e.message);
      process.exit(1);
    }
    const message = e instanceof Error ? e.message : String(e);
    p.log.error(`Extraction failed: ${message}`);
    process.exit(1);
  }

  // Surface per-slice run results (failures only — successes are quiet).
  const failures = result.slices.filter(
    (o) => o.cache === "miss" && o.run && !o.run.result,
  );
  if (failures.length > 0) {
    p.log.warn(`${failures.length} slice extraction${failures.length === 1 ? "" : "s"} failed:`);
    for (const f of failures) {
      console.log(`  ${f.slice.specPath} :: ${f.slice.headingPath.join(" → ")}`);
      if (f.run?.error) console.log(`    → ${f.run.error}`);
    }
  }

  // Surface validation issues by severity. The orchestrator already
  // honors this split: it writes every artifact that resolved, dropping
  // only the ones with HARD issues (parse errors, duplicate identities).
  // SOFT issues (an unresolved cross-reference — e.g. two slices coined
  // different identities for the same artifact, or a reference to an
  // artifact the spec never defined) do NOT block the write and must NOT
  // be reported as a fatal gate failure. We abort only when the run
  // genuinely produced nothing.
  const hardIssues = result.validationIssues.filter((i) => i.severity === "hard");
  const softIssues = result.validationIssues.filter((i) => i.severity === "soft");

  // Soft issues → warnings. The resolver reports every occurrence of an
  // unresolved ref separately, so collapse identical lines and show the
  // count instead of repeating the same message.
  if (softIssues.length > 0) {
    const counts = new Map<string, number>();
    for (const issue of softIssues) {
      const line = `${issue.artifactKey}: ${issue.message}`;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    p.log.warn(
      `${counts.size} unresolved cross-reference${counts.size === 1 ? "" : "s"} (non-blocking — the referenced artifact wasn't generated; \`truecourse verify\` will flag any real drift):`,
    );
    for (const [line, n] of counts) console.log(`  ${line}${n > 1 ? `  (×${n})` : ""}`);
  }

  // Hard issues → errors. These artifacts were dropped, but the rest
  // still reached disk, so this is not necessarily a failed run.
  if (hardIssues.length > 0) {
    p.log.error(
      `${hardIssues.length} artifact${hardIssues.length === 1 ? " was" : "s were"} dropped (invalid \`.tc\` — parse error or duplicate identity):`,
    );
    for (const issue of hardIssues) console.log(`  ${issue.artifactKey}: ${issue.message}`);
  }

  // Abort ONLY when the run produced nothing at all despite having issues
  // — e.g. duplicate identities that corrupt the whole corpus. A normal
  // run measures output by `write.written`; a dry run by `write.proposed`.
  // (A clean "nothing to write because everything is up to date" run has
  // no issues and falls through to the up-to-date summary below.)
  const produced = options.diff ? result.write.proposed.length : result.write.written.length;
  if (produced === 0 && result.validationIssues.length > 0) {
    p.outro("No contracts were written. Edit the spec or re-run after fixing.");
    process.exit(1);
  }

  // Surface merge diagnostics (non-blocking). Repair "re-prompting" lines were
  // already streamed live via onRepairProgress, so skip them here to avoid
  // printing each twice — repair failures/skips (also repair-kind) still show.
  for (const d of result.mergeDiagnostics) {
    if (d.artifactKey === "repair" && d.message.includes("re-prompting")) continue;
    p.log.warn(d.message);
  }

  // List files with a cap so large generations don't flood the terminal —
  // the count line above always reports the true total.
  const LIST_CAP = 20;
  const printFileList = (files: string[], marker: string): void => {
    for (const f of files.slice(0, LIST_CAP)) console.log(`  ${marker} ${path.relative(repoRoot, f)}`);
    if (files.length > LIST_CAP) console.log(`  … and ${files.length - LIST_CAP} more`);
  };

  // Final summary.
  if (options.diff) {
    if (result.write.proposed.length === 0) {
      p.outro("No changes — every contract is already up to date.");
      return;
    }
    p.log.info(`Would write ${result.write.proposed.length} file${result.write.proposed.length === 1 ? "" : "s"}:`);
    printFileList(result.write.proposed, "+");
    p.outro("Run `truecourse contracts generate` to apply.");
    return;
  }

  // Stamp the generate marker on every successful run (including the
  // "nothing to write" case — we confirmed contracts match the claim
  // set). Keeps the dashboard's `contractsStale` dot honest when
  // generation is driven from the terminal.
  stampGeneratedMarker(repoRoot);

  // CLI generate goes through the package runner directly (not the core
  // in-process wrapper the dashboard uses), so emit the telemetry event here.
  await trackEvent("contracts_generate", {
    source: "cli",
    artifactsWrittenRange: bucketFileCount(result.write.written.length),
    validationIssues: result.validationIssues.length,
    durationRange: bucketDuration(Date.now() - startedAt),
  });

  if (result.write.written.length === 0) {
    p.outro("Up to date — run `truecourse verify`.");
    return;
  }
  p.log.success(`Wrote ${result.write.written.length} contract file${result.write.written.length === 1 ? "" : "s"}.`);
  printFileList(result.write.written, "•");

  // Install the bundled VS Code grammar for `.tc` files. We do this on
  // `contracts generate` because that's the command that actually
  // writes `.tc` artifacts. No prompt, idempotent across runs.
  syncShippedTcSyntax();

  p.outro(`Run \`truecourse verify\` to check code against the new contracts.`);
}

// ---------------------------------------------------------------------------
// `truecourse contracts list`
// ---------------------------------------------------------------------------

export async function runContractsList(
  options: { cwd?: string; inferred?: boolean; authored?: boolean } = {},
): Promise<void> {
  const repoRoot = options.cwd ?? process.cwd();
  const contractsDir = path.join(repoRoot, ".truecourse", "contracts");
  if (!fs.existsSync(contractsDir)) {
    p.log.info("No contracts found. Run `truecourse contracts generate` first.");
    return;
  }

  // Parse + resolve every `.tc` so we can show kind / identity / confidence /
  // location (like `infer`'s output) and filter by provenance — not just bare
  // file paths. Reuses the verifier's parser + resolver, same as `validate`.
  const { parser, resolver } = await import("@truecourse/contract-verifier");
  const fileNodes: ReturnType<typeof parser.parseFile>[] = [];
  let parseErrors = 0;
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith(".tc")) {
        try {
          fileNodes.push(parser.parseFile(full, fs.readFileSync(full, "utf-8")));
        } catch {
          parseErrors += 1;
        }
      }
    }
  };
  visit(contractsDir);

  // `--inferred` and `--authored` are exclusive lenses; neither (or both) → all.
  const filter = options.inferred && !options.authored
    ? "inferred"
    : options.authored && !options.inferred
      ? "authored"
      : null;

  const resolution = resolver.resolve(fileNodes);
  const artifacts = [...resolution.index.values()]
    .filter((a) => (filter ? a.provenance === filter : true))
    .sort((a, b) =>
      a.ref.type === b.ref.type
        ? a.ref.identity.localeCompare(b.ref.identity)
        : a.ref.type.localeCompare(b.ref.type),
    );

  if (artifacts.length === 0) {
    if (filter === "inferred") {
      p.log.info("No inferred contracts. Run `truecourse infer` to reverse-engineer undocumented decisions.");
    } else if (filter === "authored") {
      p.log.info("No authored contracts. Run `truecourse contracts generate` first.");
    } else {
      p.log.info("No .tc files in .truecourse/contracts/.");
    }
    return;
  }

  const scope = filter ? `${filter} ` : "";
  p.intro(`Contracts — ${artifacts.length} ${scope}artifact${artifacts.length === 1 ? "" : "s"}`);
  for (const a of artifacts) {
    // Confidence is inferred-only; authored artifacts omit the prefix. Location
    // points at the origin (code path for inferred, doc for authored), falling
    // back to the `.tc` declaration site when no origin was recorded.
    const conf = a.confidence ? `[${a.confidence}] ` : "";
    const loc = a.origin
      ? a.origin.lines[0] >= 0
        ? `${a.origin.source}:${a.origin.lines[0]}`
        : a.origin.source
      : `${path.relative(repoRoot, a.declarationLoc.filePath)}:${a.declarationLoc.lineStart}`;
    console.log(`  ${conf}${a.ref.type}:${a.ref.identity}  ${loc}`);
  }
  if (parseErrors > 0) {
    p.log.warn(`${parseErrors} file${parseErrors === 1 ? "" : "s"} could not be parsed — run \`truecourse contracts validate\`.`);
  }
  p.outro(
    filter
      ? "`truecourse verify`."
      : "Filter with `--inferred` / `--authored`. `truecourse contracts validate` then `truecourse verify`.",
  );
}

// ---------------------------------------------------------------------------
// `truecourse contracts validate`
// ---------------------------------------------------------------------------

export async function runContractsValidate(
  options: { cwd?: string } = {},
): Promise<void> {
  const repoRoot = options.cwd ?? process.cwd();
  const contractsDir = path.join(repoRoot, ".truecourse", "contracts");
  if (!fs.existsSync(contractsDir)) {
    p.log.error("No .truecourse/contracts/ directory found.");
    process.exit(1);
  }

  // Reuse the verifier's parser + resolver for validation.
  const { parser, resolver } = await import("@truecourse/contract-verifier");
  const fileNodes: ReturnType<typeof parser.parseFile>[] = [];
  const issues: string[] = [];

  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith(".tc")) {
        try {
          fileNodes.push(parser.parseFile(full, fs.readFileSync(full, "utf-8")));
        } catch (e) {
          issues.push(`${path.relative(repoRoot, full)}: parse error: ${e instanceof Error ? e.message : e}`);
        }
      }
    }
  };
  visit(contractsDir);

  const resolution = resolver.resolve(fileNodes);
  for (const err of resolution.errors) {
    issues.push(`${path.relative(repoRoot, err.filePath)}:${err.line} ${err.message}`);
  }
  const trulyUnresolved = resolution.unresolvedRefs.filter((u) => u.ref.type !== "Unknown");
  for (const u of trulyUnresolved) {
    issues.push(`${path.relative(repoRoot, u.usedAt.filePath)}:${u.usedAt.lineStart} unresolved ${u.ref.type}:${u.ref.identity}`);
  }

  if (issues.length === 0) {
    p.log.success(`Validated ${resolution.index.size} artifact${resolution.index.size === 1 ? "" : "s"} — no issues.`);
    p.outro("Run `truecourse verify`.");
    return;
  }
  p.log.error(`${issues.length} issue${issues.length === 1 ? "" : "s"}:`);
  for (const issue of issues) console.log(`  ${issue}`);
  process.exit(1);
}
