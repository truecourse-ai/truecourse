#!/usr/bin/env node

import { Command } from "commander";
import * as p from "@clack/prompts";
import { runAdd } from "./commands/add.js";
import { runAnalyze, runAnalyzeDiff } from "./commands/analyze.js";
import {
  runDashboard,
  runDashboardStop,
  runDashboardStatus,
  runDashboardLogs,
  runDashboardUninstall,
} from "./commands/dashboard.js";
import { runList, runListDiff, parseSeverityFlag } from "./commands/list.js";
import {
  runRulesCategories,
  runRulesDisable,
  runRulesEnable,
  runRulesList,
  runRulesLlm,
  runRulesReset,
} from "./commands/rules.js";
import {
  runContractsGenerate,
  runContractsList,
  runContractsValidate,
} from "./commands/contracts.js";
import {
  runSpecScan,
  runSpecStatus,
  runVerify,
  runInfer,
} from "./commands/spec.js";
import {
  runSpecConflictsList,
  runSpecConflictsShow,
  runSpecConflictsResolve,
} from "./commands/spec-conflicts.js";
import {
  runSpecChainsList,
  runSpecChainsAdd,
  runSpecChainsRemove,
} from "./commands/spec-chains.js";
import {
  runSpecDocsList,
  runSpecDocsSkipped,
  runSpecDocsInclude,
  runSpecDocsUninclude,
  runSpecDocsExclude,
  runSpecDocsUnexclude,
} from "./commands/spec-docs.js";
import { runDriftsList, parseDriftSeverityFlag } from "./commands/drifts.js";
import { runConfigLlmShow } from "./commands/config.js";
import { readTelemetryConfig, writeTelemetryConfig } from "./telemetry.js";
import {
  runHooksInstall,
  runHooksUninstall,
  runHooksStatus,
  runHooksRun,
} from "./commands/hooks.js";

const program = new Command();

program
  .name("truecourse")
  .version("0.6.10")
  .description("TrueCourse CLI — analyze your repository and open the dashboard");

const dashboardCmd = program
  .command("dashboard")
  .description("Start the TrueCourse dashboard and open it in your browser")
  .option("--reconfigure", "Re-prompt for console vs background service mode")
  .option("--service", "Run as a background service (skips mode prompt)")
  .option("--console", "Run in this terminal (skips mode prompt)")
  .action(async (options) => {
    if (options.service && options.console) {
      console.error("error: --service and --console are mutually exclusive");
      process.exit(1);
    }
    const mode = options.service ? "service" : options.console ? "console" : undefined;
    await runDashboard({ reconfigure: options.reconfigure, mode });
  });

dashboardCmd
  .command("stop")
  .description("Stop the dashboard")
  .action(async () => {
    await runDashboardStop();
  });

dashboardCmd
  .command("status")
  .description("Show dashboard status")
  .action(async () => {
    await runDashboardStatus();
  });

dashboardCmd
  .command("logs")
  .description("Tail dashboard logs (service mode only)")
  .action(async () => {
    await runDashboardLogs();
  });

dashboardCmd
  .command("uninstall")
  .description("Remove the background service and revert to console mode")
  .action(async () => {
    await runDashboardUninstall();
  });

/**
 * Resolve the skills-install override from commander options.
 *
 * `--install-skills` and `--no-skills` are exposed as two separate flags
 * (rather than a paired `--skills` / `--no-skills`) because `--skills`
 * alone is ambiguous. That means commander stores them under two different
 * properties: `options.installSkills === true` for the first, and
 * `options.skills === false` for the second (commander's `--no-X` convention
 * creates a negated boolean under the `X` property).
 */
function resolveInstallSkills(
  options: { installSkills?: boolean; skills?: boolean },
): boolean | undefined {
  if (options.installSkills === true) return true;
  if (options.skills === false) return false;
  return undefined;
}

program
  .command("analyze")
  .description("Analyze the current repository")
  .option("--diff", "Run diff check against latest analysis")
  // `--llm` and `--no-llm` are auto-paired by commander — they both control
  // `options.llm`. Passing `--llm` → true, `--no-llm` → false, neither →
  // undefined (falls through to config / interactive prompt).
  .option("--llm", "Run LLM-powered rules (pre-approves the cost estimate)")
  .option("--no-llm", "Skip LLM-powered rules for this run")
  .option("--llm-transport <mode>", "How to reach the LLM: 'cli' (spawn claude -p, default) or 'agent' (filesystem mailbox)")
  .option("--io <dir>", "Mailbox dir for --llm-transport agent (request/response files)")
  .option("--stash", "Pre-approve stashing pending changes before analysis")
  .option("--no-stash", "Analyze the working tree as-is without stashing")
  .option("--install-skills", "Install Claude Code skills without prompting")
  .option("--no-skills", "Skip the Claude Code skills prompt")
  .action(async (options) => {
    const llm: boolean | undefined = typeof options.llm === "boolean" ? options.llm : undefined;
    const stash: boolean | undefined = typeof options.stash === "boolean" ? options.stash : undefined;
    const installSkills = resolveInstallSkills(options);
    const common = { llm, stash, installSkills, llmTransport: options.llmTransport, io: options.io };
    if (options.diff) {
      await runAnalyzeDiff(common);
    } else {
      await runAnalyze(common);
    }
  });

program
  .command("add")
  .description("Register the current directory with TrueCourse")
  .option("--install-skills", "Install Claude Code skills without prompting")
  .option("--no-skills", "Skip the Claude Code skills prompt")
  .action(async (options) => {
    await runAdd({ installSkills: resolveInstallSkills(options) });
  });

program
  .command("list")
  .description("List violations from the latest analysis")
  .option("--diff", "Show diff check results (new and resolved)")
  .option("--limit <n>", "Number of violations to show (default: 20)", parseInt)
  .option("--offset <n>", "Skip first N violations", parseInt)
  .option("--all", "Show all violations")
  .option(
    "--severity <list>",
    "Comma-separated severities to include (critical,high,medium,low,info)",
  )
  .action(async (options) => {
    if (options.diff) {
      await runListDiff();
    } else {
      await runList({
        limit: options.all ? Infinity : (options.limit ?? 20),
        offset: options.offset ?? 0,
        severity: parseSeverityFlag(options.severity),
      });
    }
  });

// Contract framework — spec → .tc extraction + validation.
const contractsCmd = program
  .command("contracts")
  .description("Manage spec-driven contract artifacts");

contractsCmd
  .command("generate")
  .description("Generate .tc artifacts from the curated corpus (corpus.json)")
  .option("--diff", "Dry run — show what would change without writing")
  .option("-y, --yes", "Skip the pre-flight LLM cost-estimate confirmation")
  .option("--llm-transport <mode>", "How to reach the LLM: 'cli' (spawn claude -p, default) or 'agent' (filesystem mailbox)")
  .option("--io <dir>", "Mailbox dir for --llm-transport agent (request/response files)")
  .action(async (options) => {
    await runContractsGenerate({ diff: !!options.diff, yes: !!options.yes, llm: options.llmTransport, io: options.io });
  });

contractsCmd
  .command("list")
  .description("List the .tc artifacts in this repo (kind · identity · location)")
  .option("--inferred", "Only inferred artifacts (reverse-engineered, in _inferred/)")
  .option("--authored", "Only authored artifacts (exclude _inferred/)")
  .action(async (options) => {
    await runContractsList({ inferred: !!options.inferred, authored: !!options.authored });
  });

contractsCmd
  .command("validate")
  .description("Parse and resolve all .tc files, report any issues")
  .action(async () => {
    await runContractsValidate();
  });

// Spec scan — docs → curated corpus (areas + doc relations + overlaps) in .truecourse/specs/.
const specCmd = program
  .command("spec")
  .description("Curate scattered docs into a corpus of areas and doc relations");

specCmd
  .command("scan")
  .description("Curate docs into corpus.json (areas + doc relations + overlap flags)")
  .option("-y, --yes", "Skip the pre-flight LLM cost-estimate confirmation")
  .option("--llm-transport <mode>", "How to reach the LLM: 'cli' (spawn claude -p, default) or 'agent' (filesystem mailbox)")
  .option("--io <dir>", "Mailbox dir for --llm-transport agent (request/response files)")
  .action(async (options) => {
    await runSpecScan({ yes: !!options.yes, llm: options.llmTransport, io: options.io });
  });

specCmd
  .command("status")
  .description("Summary of docs, areas, relations, and open vs resolved overlaps")
  .action(async () => {
    await runSpecStatus();
  });

// -- Conflicts (within-area overlaps → relations) ---------------------------
const conflictsCmd = specCmd
  .command("conflicts")
  .description("Inspect and resolve flagged within-area doc overlaps (agent-friendly)");

conflictsCmd
  .command("list")
  .description("List flagged overlaps still awaiting a relation")
  .action(async () => {
    await runSpecConflictsList();
  });

conflictsCmd
  .command("show <area>")
  .description("Show an area's overlapping docs with prose excerpts")
  .action(async (area) => {
    await runSpecConflictsShow(area);
  });

conflictsCmd
  .command("resolve <area>")
  .description("Resolve an overlap by recording a doc→doc relation")
  .requiredOption("--older <path>", "Repo-relative path of the older / superseded doc")
  .requiredOption("--newer <path>", "Repo-relative path of the newer / authoritative doc")
  .option("--replace", "`newer` fully supersedes `older` (excluded from generate)")
  .option("--precedence", "Both feed generate; `newer` wins where they overlap")
  .option("--keep-both", "Both are current peers (combine)")
  .option("--note <text>", "Optional rationale")
  .action(async (area, opts) => {
    const type = opts.replace
      ? "replace"
      : opts.precedence
        ? "precedence"
        : opts.keepBoth
          ? "keep-both"
          : undefined;
    if (!type) {
      console.error("Pass one of --replace | --precedence | --keep-both");
      process.exit(1);
    }
    await runSpecConflictsResolve(area, { older: opts.older, newer: opts.newer, type, note: opts.note });
  });

// -- Chains (doc→doc relations) ---------------------------------------------
const chainsCmd = specCmd
  .command("chains")
  .description("Manage doc→doc relations (supersession / precedence overrides)");

chainsCmd
  .command("list")
  .description("List effective relations (auto-detected + user-authored)")
  .action(async () => {
    await runSpecChainsList();
  });

chainsCmd
  .command("add")
  .description("Record a relation between two docs")
  .requiredOption("--older <path>", "Repo-relative path of the older doc")
  .requiredOption("--newer <path>", "Repo-relative path of the newer doc")
  .option("--type <type>", "replace (default) | precedence | keep-both", "replace")
  .option("--scope <area>", "Confine the relation to one area id (product/concern)")
  .option("--note <text>", "Optional rationale")
  .action(async (opts) => {
    await runSpecChainsAdd({
      older: opts.older,
      newer: opts.newer,
      type: opts.type,
      scope: opts.scope,
      note: opts.note,
    });
  });

chainsCmd
  .command("remove")
  .description("Remove a relation")
  .requiredOption("--older <path>", "Repo-relative path of the older doc")
  .requiredOption("--newer <path>", "Repo-relative path of the newer doc")
  .option("--scope <area>", "Only the relation scoped to this area")
  .action(async (opts) => {
    await runSpecChainsRemove({
      older: opts.older,
      newer: opts.newer,
      scope: opts.scope,
    });
  });

// -- Docs (relevance filter overrides) --------------------------------------
const docsCmd = specCmd
  .command("docs")
  .description("Manage corpus doc overrides — force-include skipped docs or force-exclude kept ones");

docsCmd
  .command("list")
  .description("List the kept (corpus) docs with their area tags")
  .action(async () => {
    await runSpecDocsList();
  });

docsCmd
  .command("skipped")
  .description("List docs the relevance filter excluded from extraction")
  .action(async () => {
    await runSpecDocsSkipped();
  });

docsCmd
  .command("include <path>")
  .description("Force-include a skipped doc and re-scan")
  .action(async (docPath) => {
    await runSpecDocsInclude(docPath);
  });

docsCmd
  .command("uninclude <path>")
  .description("Remove a force-include override")
  .action(async (docPath) => {
    await runSpecDocsUninclude(docPath);
  });

docsCmd
  .command("exclude <path>")
  .description("Force-exclude a kept doc from the corpus and re-scan")
  .action(async (docPath) => {
    await runSpecDocsExclude(docPath);
  });

docsCmd
  .command("unexclude <path>")
  .description("Remove a force-exclude override")
  .action(async (docPath) => {
    await runSpecDocsUnexclude(docPath);
  });

// Verify — compares generated TC contracts against the code.
program
  .command("verify")
  .description("Compare code against the canonical TC contracts")
  .option("--code-dir <path>", "Override the code directory (default: auto-detect)")
  .option("--diff", "Diff current drifts against the committed LATEST baseline")
  .option("--stash", "Pre-approve stashing pending changes (verify committed state)")
  .option("--no-stash", "Verify the working tree as-is without stashing")
  .action(async (options) => {
    await runVerify({ codeDir: options.codeDir, diff: options.diff, stash: options.stash });
  });

// Infer — reverse-engineers undocumented decisions from code into _inferred/.
program
  .command("infer")
  .description("Reverse-engineer undocumented decisions from code into inferred contracts")
  .option("--code-dir <path>", "Override the code directory (default: auto-detect)")
  .option("--dry-run", "Report what would be written without touching disk")
  .action(async (options) => {
    await runInfer({ codeDir: options.codeDir, dryRun: options.dryRun });
  });

// Drifts — inspect the drifts from the latest verify. Reads verifier/LATEST.json
// (no re-run); paginated + filterable like `truecourse list` for violations.
const driftsCmd = program
  .command("drifts")
  .description("Inspect drifts from the latest verify");

driftsCmd
  .command("list")
  .description("List drifts from the latest verify (paginated)")
  .option("--limit <n>", "Number of drifts to show (default: 20)", parseInt)
  .option("--offset <n>", "Skip first N drifts", parseInt)
  .option("--all", "Show all drifts")
  .option(
    "--severity <list>",
    "Comma-separated severities to include (critical,high,medium,low,info)",
  )
  .action(async (options) => {
    await runDriftsList({
      limit: options.all ? Infinity : (options.limit ?? 20),
      offset: options.offset ?? 0,
      severity: parseDriftSeverityFlag(options.severity),
    });
  });

// Rules management — reads/writes per-repo config.json directly. No server needed.
const rulesCmd = program
  .command("rules")
  .description("Manage analysis rules");

rulesCmd
  .command("categories")
  .description("View or override rule categories for this repository")
  .option("--enable <category>", "Enable a category")
  .option("--disable <category>", "Disable a category")
  .option("--reset", "Reset to global default")
  .action(async (options) => {
    await runRulesCategories(options);
  });

rulesCmd
  .command("llm")
  .description("Enable or disable LLM-powered rules for this repository")
  .option("--enable", "Enable LLM rules")
  .option("--disable", "Disable LLM rules")
  .option("--reset", "Reset to global default")
  .action(async (options) => {
    await runRulesLlm(options);
  });

rulesCmd
  .command("list")
  .description("List rules with their enabled/disabled status for this repository")
  .option("--domain <name>", "Only show rules in this domain (e.g. security, bugs)")
  .option("--enabled", "Only show enabled rules")
  .option("--disabled", "Only show disabled rules")
  .option("--search <text>", "Filter by key, name, or description")
  .option("--language <lang>", "Show per-language support status (javascript, python, csharp)")
  .action(async (options) => {
    await runRulesList(options);
  });

rulesCmd
  .command("enable <ruleKey>")
  .description("Enable a single rule for this repository")
  .action(async (ruleKey: string) => {
    await runRulesEnable({ ruleKey });
  });

rulesCmd
  .command("disable <ruleKey>")
  .description("Disable a single rule for this repository")
  .action(async (ruleKey: string) => {
    await runRulesDisable({ ruleKey });
  });

rulesCmd
  .command("reset [ruleKey]")
  .description("Clear per-rule overrides (one rule, or all if no key given)")
  .action(async (ruleKey?: string) => {
    await runRulesReset({ ruleKey });
  });

// Per-repo configuration — today the only surface is the LLM model
// resolution view. Writes happen via env vars or by hand-editing
// `.truecourse/config.json#llm`.
const configCmd = program
  .command("config")
  .description("Inspect per-repo TrueCourse configuration");

const configLlmCmd = configCmd
  .command("llm")
  .description("LLM model configuration for the current repo");

configLlmCmd
  .command("show")
  .description("Print the effective model resolution for every pipeline stage")
  .action(async () => {
    await runConfigLlmShow();
  });

// Telemetry management
const telemetryCmd = program
  .command("telemetry")
  .description("Manage anonymous usage telemetry");

telemetryCmd
  .command("enable")
  .description("Enable anonymous usage telemetry")
  .action(() => {
    writeTelemetryConfig({ enabled: true });
    p.log.success("Telemetry enabled. Thank you for helping improve TrueCourse!");
  });

telemetryCmd
  .command("disable")
  .description("Disable anonymous usage telemetry")
  .action(() => {
    writeTelemetryConfig({ enabled: false });
    p.log.success("Telemetry disabled. No data will be collected.");
  });

telemetryCmd
  .command("status")
  .description("Show current telemetry status")
  .action(() => {
    const config = readTelemetryConfig();
    if (process.env.CI === "true") {
      p.log.info("Telemetry is automatically disabled in CI environments.");
    } else if (config.enabled) {
      p.log.info("Telemetry is enabled.");
    } else {
      p.log.info("Telemetry is disabled.");
    }
  });

// Git hooks management
const hooksCmd = program
  .command("hooks")
  .description("Manage git hooks");

hooksCmd
  .command("install")
  .description("Install pre-commit hook")
  .action(async () => {
    await runHooksInstall();
  });

hooksCmd
  .command("uninstall")
  .description("Remove pre-commit hook")
  .action(() => {
    runHooksUninstall();
  });

hooksCmd
  .command("status")
  .description("Show hook installation status")
  .action(() => {
    runHooksStatus();
  });

hooksCmd
  .command("run")
  .description("Run pre-commit checks (called by the hook)")
  .action(async () => {
    await runHooksRun();
  });

program.action(() => {
  program.outputHelp();
});

program.parse();
