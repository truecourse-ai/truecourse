import * as p from "@clack/prompts";
import fs from "node:fs";
import path from "node:path";
import {
  generateFromCorpusInProcess,
  CORPUS_GENERATE_STEPS,
} from "@truecourse/core/commands/spec-in-process";
import { StepTracker } from "@truecourse/core/progress";
import { createStdoutStepRenderer } from "../lib/stdout-step-renderer.js";
import { syncShippedTcSyntax } from "./helpers.js";
import { requireGitRepo } from "./git-guard.js";
import { preflightClaudeOrExit } from "../lib/claude-preflight.js";

export interface RunContractsGenerateOptions {
  /** When true, perform a dry run — write nothing, show what would change. */
  diff?: boolean;
  /** Override the repo root; defaults to cwd. */
  cwd?: string;
  /** LLM transport: `cli` (default, spawn `claude -p`) or `agent` (filesystem mailbox under `io`). */
  llm?: "cli" | "agent";
  /** I/O dir for the `agent` transport's request/response mailbox. */
  io?: string;
}

export async function runContractsGenerate(
  options: RunContractsGenerateOptions = {},
): Promise<void> {
  const repoRoot = options.cwd ?? process.cwd();

  p.intro(options.diff ? "Contracts (dry run)" : "Contracts");
  await requireGitRepo(repoRoot);

  if (options.llm === "agent" && !options.io) {
    p.log.error("--llm agent requires --io <dir> (the request/response mailbox directory).");
    p.outro("Aborted.");
    process.exit(1);
  }
  // The enumerate + generate stages shell out to `claude`; probe once up front
  // (the `agent` transport answers via the filesystem mailbox, so skip it there).
  if (options.llm !== "agent") await preflightClaudeOrExit();

  const renderer = createStdoutStepRenderer();
  const tracker = new StepTracker(renderer.onProgress, CORPUS_GENERATE_STEPS.map((s) => ({ ...s })));
  const { corpus } = await generateFromCorpusInProcess(repoRoot, {
    tracker,
    source: "cli",
    llm: options.llm,
    io: options.io,
    dryRun: !!options.diff,
  });
  renderer.dispose();

  if (corpus.kind === "skipped") {
    p.log.error("No .truecourse/specs/corpus.json found. Run `truecourse spec scan` first.");
    p.outro("Aborted.");
    process.exit(1);
  }
  if (corpus.kind === "failed") {
    p.log.error(`Generation failed: ${corpus.error.message}`);
    p.outro("Aborted.");
    process.exit(1);
  }

  const result = corpus.result;
  const totalTargets = result.areas.reduce((n, a) => n + a.targets, 0);
  const totalEmitted = result.areas.reduce((n, a) => n + a.emitted, 0);
  p.log.step(`areas       ${result.areas.length}`);
  p.log.step(`targets     ${totalTargets} enumerated · ${totalEmitted} generated`);

  if (result.gaps.length > 0) {
    p.log.warn(`${result.gaps.length} gap${result.gaps.length === 1 ? "" : "s"} (enumerated but not generated):`);
    for (const g of result.gaps.slice(0, 20)) console.log(`  • ${g.areaId}  ${g.kind}:${g.identity}`);
    if (result.gaps.length > 20) console.log(`  … and ${result.gaps.length - 20} more`);
  }

  // Surface dropped-artifact validation issues, same split as the legacy path:
  // soft = unresolved cross-ref (non-blocking), hard = invalid .tc (dropped).
  const soft = result.validationIssues.filter((i) => i.severity === "soft");
  const hard = result.validationIssues.filter((i) => i.severity === "hard" && i.artifactKey !== "resolver");
  if (soft.length > 0) {
    const counts = new Map<string, number>();
    for (const i of soft) {
      const line = `${i.artifactKey}: ${i.message}`;
      counts.set(line, (counts.get(line) ?? 0) + 1);
    }
    p.log.warn(`${counts.size} unresolved cross-reference${counts.size === 1 ? "" : "s"} (non-blocking — \`truecourse verify\` flags real drift):`);
    for (const [line, n] of counts) console.log(`  ${line}${n > 1 ? `  (×${n})` : ""}`);
  }
  if (hard.length > 0) {
    p.log.error(`${hard.length} artifact${hard.length === 1 ? " was" : "s were"} dropped (invalid \`.tc\`):`);
    for (const i of hard) console.log(`  ${i.artifactKey}: ${i.message}`);
  }

  if (options.diff) {
    p.log.info(`Would write ${result.write.proposed.length} file${result.write.proposed.length === 1 ? "" : "s"}.`);
    p.outro("Run `truecourse contracts generate` to apply.");
    return;
  }
  if (result.write.written.length === 0) {
    p.outro("Up to date — run `truecourse verify`.");
    return;
  }
  p.log.success(`Wrote ${result.write.written.length} contract file${result.write.written.length === 1 ? "" : "s"}.`);
  syncShippedTcSyntax();
  p.outro("Run `truecourse verify` to check code against the new contracts.");
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
  // file paths. Reuses the verifier's ohm parser + resolver, same as `validate`.
  const { parserOhm, resolver } = await import("@truecourse/contract-verifier");
  const fileNodes: ReturnType<typeof parserOhm.parseTcFile>[] = [];
  let parseErrors = 0;
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith(".tc")) {
        try {
          fileNodes.push(parserOhm.parseTcFile(full, fs.readFileSync(full, "utf-8")));
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

  // Reuse the verifier's ohm parser + resolver for validation.
  const { parserOhm, resolver } = await import("@truecourse/contract-verifier");
  const fileNodes: ReturnType<typeof parserOhm.parseTcFile>[] = [];
  const issues: string[] = [];

  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith(".tc")) {
        try {
          fileNodes.push(parserOhm.parseTcFile(full, fs.readFileSync(full, "utf-8")));
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
