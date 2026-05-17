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
import { syncShippedTcSyntax } from "./helpers.js";

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

  // Module 2 reads the canonical spec produced by Module 1. If
  // `.truecourse/spec/` doesn't exist, the user hasn't run the
  // consolidator yet — tell them and bail.
  if (!hasCanonicalSpec(repoRoot)) {
    p.log.error(
      "No .truecourse/spec/ found. Run `truecourse spec apply` first to produce the canonical spec.",
    );
    p.outro("Aborted.");
    process.exit(1);
  }

  // Run the extraction pipeline against the canonical spec.
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
      dryRun: !!options.diff,
      onSliceCacheHit: (s) => {
        p.log.message(`  cache hit  ${s.specPath} :: ${s.headingPath.join(" → ")}`, { symbol: "·" });
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

  // Surface validation issues — these block the write.
  if (result.validationIssues.length > 0) {
    p.log.error(`Validation gate failed (${result.validationIssues.length} issue${result.validationIssues.length === 1 ? "" : "s"}):`);
    for (const issue of result.validationIssues) {
      console.log(`  ${issue.artifactKey}: ${issue.message}`);
    }
    p.outro("No contracts were written. Edit the spec or re-run after fixing.");
    process.exit(1);
  }

  // Surface merge diagnostics (non-blocking).
  for (const d of result.mergeDiagnostics) {
    p.log.warn(d.message);
  }

  // Final summary.
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

  // Stamp the generate marker on every successful run (including the
  // "nothing to write" case — we still confirmed contracts match the
  // canonical). Keeps the dashboard's `contractsStale` signal honest
  // when generation is driven from the terminal.
  stampGeneratedMarker(repoRoot);

  if (result.write.written.length === 0) {
    p.outro("Up to date — no contract files needed updating.");
    return;
  }
  p.log.success(`Wrote ${result.write.written.length} contract file${result.write.written.length === 1 ? "" : "s"}.`);
  for (const f of result.write.written) console.log(`  • ${path.relative(repoRoot, f)}`);

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
