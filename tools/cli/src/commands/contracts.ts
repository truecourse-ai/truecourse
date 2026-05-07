import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {
  ConfigMissingError,
  defaultConcurrency,
  gatherCandidates,
  generateContracts,
  proposeWithHeuristic,
  proposeWithLlm,
  readSpecsConfig,
  spawnRunner,
  writeSpecsConfig,
  SPECS_CONFIG_FILE,
} from "@truecourse/contract-extractor";
import type {
  BootstrapProposal,
  SpecsConfig,
} from "@truecourse/contract-extractor";

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

  p.intro(options.diff ? "Contracts (dry run)" : "Contracts");

  // 1. Bootstrap specs.yaml if missing.
  let config = readSpecsConfig(repoRoot);
  if (!config) {
    config = await bootstrapSpecsConfig(repoRoot);
    if (!config) {
      p.outro("Aborted — no specs.yaml written.");
      return;
    }
  }

  p.log.step(`config  ${SPECS_CONFIG_FILE} (${config.specs.length} entries)`);

  // 2. Run the extraction pipeline.
  const concurrency = defaultConcurrency();
  const runner = spawnRunner({
    concurrency,
    onSliceStart: (s) => {
      p.log.step(`extracting  ${s.specPath} :: ${s.headingPath.join(" → ")}`);
    },
  });

  let result;
  try {
    result = await generateContracts({
      repoRoot,
      runner,
      config,
      dryRun: !!options.diff,
      onSliceCacheHit: (s) => {
        p.log.message(`  cache hit  ${s.specPath} :: ${s.headingPath.join(" → ")}`, { symbol: "·" });
      },
    });
  } catch (e) {
    if (e instanceof ConfigMissingError) {
      p.log.error(e.message);
      process.exit(1);
    }
    const message = e instanceof Error ? e.message : String(e);
    p.log.error(`Extraction failed: ${message}`);
    process.exit(1);
  }

  // 3. Surface per-slice run results (failures only — successes are quiet).
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

  // 4. Surface validation issues — these block the write.
  if (result.validationIssues.length > 0) {
    p.log.error(`Validation gate failed (${result.validationIssues.length} issue${result.validationIssues.length === 1 ? "" : "s"}):`);
    for (const issue of result.validationIssues) {
      console.log(`  ${issue.artifactKey}: ${issue.message}`);
    }
    p.outro("No contracts were written. Edit the spec or re-run after fixing.");
    process.exit(1);
  }

  // 5. Surface merge diagnostics (non-blocking).
  for (const d of result.mergeDiagnostics) {
    p.log.warn(d.message);
  }

  // 6. Final summary.
  if (options.diff) {
    if (result.write.proposed.length === 0) {
      p.outro("No changes — every contract is already up to date.");
      return;
    }
    p.log.info(`Would write ${result.write.proposed.length} file${result.write.proposed.length === 1 ? "" : "s"}:`);
    for (const f of result.write.proposed) console.log(`  + ${path.relative(repoRoot, f)}`);
    p.outro("Run `truecourse contracts generate` to apply.");
    return;
  }

  if (result.write.written.length === 0) {
    p.outro("Up to date — no contract files needed updating.");
    return;
  }
  p.log.success(`Wrote ${result.write.written.length} contract file${result.write.written.length === 1 ? "" : "s"}.`);
  for (const f of result.write.written) console.log(`  • ${path.relative(repoRoot, f)}`);
  p.outro(`Run \`truecourse analyze\` to verify code against the new contracts.`);
}

// ---------------------------------------------------------------------------
// Inline bootstrap — propose specs.yaml when missing.
// ---------------------------------------------------------------------------

async function bootstrapSpecsConfig(repoRoot: string): Promise<SpecsConfig | null> {
  p.log.warn(`No ${SPECS_CONFIG_FILE} found.`);
  p.log.step("Scanning the repo for candidate spec documents…");

  const candidates = gatherCandidates(repoRoot);
  if (candidates.length === 0) {
    p.log.error("No markdown files that look like specs were found in this repo.");
    p.log.message(
      `Create a SPEC.md (or similar) describing your API contracts, then re-run \`truecourse contracts generate\`.`,
    );
    return null;
  }

  // Render the raw candidate list first so the user can see what we're
  // about to ask the LLM about — gives context if Claude takes a moment.
  console.log("");
  console.log("Found:");
  for (const c of candidates) {
    console.log(`  ${c.file.padEnd(50)} → ${candidateKindLabel(c.kind)}`);
  }
  console.log("");

  // Try the LLM-driven proposer first. The deterministic heuristic is the
  // fallback when claude isn't available, the call fails, or its output
  // doesn't match the schema.
  let proposal: BootstrapProposal;
  let reasons: Map<string, string> = new Map();
  let summary: string | undefined;

  const llmSpinner = p.spinner();
  llmSpinner.start("Asking Claude Code to classify candidates…");
  try {
    const llm = await proposeWithLlm(candidates);
    proposal = llm.proposal;
    reasons = llm.reasons;
    summary = llm.summary;
    llmSpinner.stop("Claude Code proposal received.");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    llmSpinner.stop("Claude Code unavailable — falling back to heuristic.");
    p.log.warn(`LLM bootstrap failed: ${message}`);
    proposal = proposeWithHeuristic(candidates);
  }

  if (proposal.config.specs.length === 0) {
    p.log.error("Couldn't classify any candidates as specs.");
    if (proposal.excluded.length > 0) {
      p.log.message("Found these markdown files but didn't include them:");
      for (const ex of proposal.excluded) {
        console.log(`  ${ex.file}    (${ex.reason})`);
      }
    }
    return null;
  }

  // Render proposal with reasoning lines (when the LLM provided them).
  if (summary) {
    console.log("Summary:");
    console.log(`  ${summary}`);
    console.log("");
  }
  console.log("Proposed specs.yaml:");
  console.log(yaml.dump(proposal.config, { lineWidth: 100 }));
  if (reasons.size > 0) {
    console.log("Reasoning:");
    for (const entry of proposal.config.specs) {
      const reason = reasons.get(entry.file);
      if (reason) console.log(`  - ${entry.file}: ${reason}`);
    }
    console.log("");
  }
  if (proposal.excluded.length > 0) {
    console.log("Excluded:");
    for (const ex of proposal.excluded) {
      console.log(`  - ${ex.file}: ${ex.reason}`);
    }
    console.log("");
  }

  const answer = await p.confirm({ message: "Write this config?" });
  if (p.isCancel(answer) || !answer) return null;

  writeSpecsConfig(repoRoot, proposal.config);
  p.log.success(`Wrote ${SPECS_CONFIG_FILE}.`);
  return proposal.config;
}

function candidateKindLabel(kind: string): string {
  switch (kind) {
    case "base-spec":
      return "base spec";
    case "adr-series":
      return "ADR";
    case "rfc":
      return "RFC";
    case "overview":
      return "overview (likely excluded)";
    default:
      return kind;
  }
}

// ---------------------------------------------------------------------------
// `truecourse contracts list`
// ---------------------------------------------------------------------------

export async function runContractsList(
  options: { cwd?: string } = {},
): Promise<void> {
  const repoRoot = options.cwd ?? process.cwd();
  const contractsDir = path.join(repoRoot, ".truecourse", "contracts");
  if (!fs.existsSync(contractsDir)) {
    p.log.info("No contracts found. Run `truecourse contracts generate` first.");
    return;
  }
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith(".tc")) files.push(full);
    }
  };
  visit(contractsDir);
  files.sort();
  if (files.length === 0) {
    p.log.info("No .tc files in .truecourse/contracts/.");
    return;
  }
  p.intro(`Contracts (${files.length})`);
  for (const f of files) console.log(`  ${path.relative(repoRoot, f)}`);
  p.outro("");
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
    return;
  }
  p.log.error(`${issues.length} issue${issues.length === 1 ? "" : "s"}:`);
  for (const issue of issues) console.log(`  ${issue}`);
  process.exit(1);
}
