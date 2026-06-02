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
  runSpecResolve,
  runSpecStatus,
  runVerify,
  runInfer,
} from "./commands/spec.js";
import {
  runSpecConflictsList,
  runSpecConflictsShow,
  runSpecConflictsPick,
  runSpecConflictsCustom,
  runSpecConflictsRevoke,
} from "./commands/spec-conflicts.js";
import {
  runSpecChainsList,
  runSpecChainsAdd,
  runSpecChainsRemove,
} from "./commands/spec-chains.js";
import {
  runSpecDocsSkipped,
  runSpecDocsInclude,
  runSpecDocsUninclude,
} from "./commands/spec-docs.js";
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
  .version("0.6.0-next.6")
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
  .option("--stash", "Pre-approve stashing pending changes before analysis")
  .option("--no-stash", "Analyze the working tree as-is without stashing")
  .option("--install-skills", "Install Claude Code skills without prompting")
  .option("--no-skills", "Skip the Claude Code skills prompt")
  .action(async (options) => {
    const llm: boolean | undefined = typeof options.llm === "boolean" ? options.llm : undefined;
    const stash: boolean | undefined = typeof options.stash === "boolean" ? options.stash : undefined;
    const installSkills = resolveInstallSkills(options);
    if (options.diff) {
      await runAnalyzeDiff({ llm, stash, installSkills });
    } else {
      await runAnalyze({ llm, stash, installSkills });
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
  .description("Extract .tc artifacts from prose specs (LLM, cached)")
  .option("--diff", "Dry run — show what would change without writing")
  .action(async (options) => {
    await runContractsGenerate({ diff: !!options.diff });
  });

contractsCmd
  .command("list")
  .description("List the .tc artifacts in this repo")
  .action(async () => {
    await runContractsList();
  });

contractsCmd
  .command("validate")
  .description("Parse and resolve all .tc files, report any issues")
  .action(async () => {
    await runContractsValidate();
  });

// Spec consolidation — docs → claims → conflicts → canonical .truecourse/specs/.
const specCmd = program
  .command("spec")
  .description("Consolidate scattered docs into a canonical spec");

specCmd
  .command("scan")
  .description("Walk docs, extract claims, surface conflicts (no writes)")
  .action(async () => {
    await runSpecScan();
  });

specCmd
  .command("resolve")
  .description("Resolve open conflicts (interactive runs in the dashboard)")
  .option("--all-defaults", "Accept the engine's pre-pick on every open conflict")
  .action(async (options) => {
    await runSpecResolve({ allDefaults: !!options.allDefaults });
  });

specCmd
  .command("status")
  .description("Summary of docs, claims, modules, and pending decisions")
  .action(async () => {
    await runSpecStatus();
  });

// -- Conflicts ---------------------------------------------------------------
const conflictsCmd = specCmd
  .command("conflicts")
  .description("Inspect and resolve open / decided conflicts (agent-friendly)");

conflictsCmd
  .command("list")
  .description("List conflicts (open by default; --decided or --all to widen)")
  .option("--decided", "Show decided conflicts instead of open")
  .option("--all", "Show both open and decided conflicts")
  .action(async (opts) => {
    await runSpecConflictsList({ decided: !!opts.decided, all: !!opts.all });
  });

conflictsCmd
  .command("show <id>")
  .description("Show full detail for one conflict")
  .option(
    "--diff",
    "Include precomputed field-level diffs (paths + values) between candidates",
  )
  .action(async (id, opts) => {
    await runSpecConflictsShow(id, { diff: !!opts.diff });
  });

conflictsCmd
  .command("pick <id> <candidateIndex>")
  .description("Resolve a conflict by picking one of its candidates")
  .option("--note <text>", "Optional human-readable rationale")
  .action(async (id, idx, opts) => {
    await runSpecConflictsPick(id, parseInt(idx, 10), {
      note: opts.note,
    });
  });

conflictsCmd
  .command("custom <id>")
  .description("Resolve a conflict with a free-text custom answer")
  .requiredOption("--text <text>", "The authoritative content for this subject")
  .action(async (id, opts) => {
    await runSpecConflictsCustom(id, opts.text);
  });

conflictsCmd
  .command("revoke <id>")
  .description("Remove a previously-saved decision (the conflict re-opens)")
  .action(async (id) => {
    await runSpecConflictsRevoke(id);
  });

// -- Chains (manual supersession) -------------------------------------------
const chainsCmd = specCmd
  .command("chains")
  .description("Manage manual version chains (supersession overrides)");

chainsCmd
  .command("list")
  .description("List manual chains")
  .action(async () => {
    await runSpecChainsList();
  });

chainsCmd
  .command("add")
  .description("Mark `older` as superseded by `newer`")
  .requiredOption("--older <path>", "Repo-relative path of the older doc")
  .requiredOption("--newer <path>", "Repo-relative path of the newer doc")
  .option("--note <text>", "Optional rationale")
  .action(async (opts) => {
    await runSpecChainsAdd({
      older: opts.older,
      newer: opts.newer,
      note: opts.note,
    });
  });

chainsCmd
  .command("remove")
  .description("Remove a manual chain")
  .requiredOption("--older <path>", "Repo-relative path of the older doc")
  .requiredOption("--newer <path>", "Repo-relative path of the newer doc")
  .action(async (opts) => {
    await runSpecChainsRemove({
      older: opts.older,
      newer: opts.newer,
    });
  });

// -- Docs (relevance filter overrides) --------------------------------------
const docsCmd = specCmd
  .command("docs")
  .description("Manage LLM relevance-filter overrides (skipped docs)");

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
