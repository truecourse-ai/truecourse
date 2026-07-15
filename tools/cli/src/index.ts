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
  runSpecScan,
  runSpecStatus,
} from "./commands/spec.js";
import {
  runSpecConflictsList,
  runSpecConflictsShow,
  runSpecConflictsResolve,
} from "./commands/spec-conflicts.js";
import {
  runSpecDocsList,
  runSpecDocsSkipped,
  runSpecDocsInclude,
  runSpecDocsUninclude,
  runSpecDocsExclude,
  runSpecDocsUnexclude,
} from "./commands/spec-docs.js";
import { runGuardRun, runGuardGenerate, runGuardStatus, runGuardDrifts, runGuardFindings } from "./commands/guard.js";
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
  .version("0.7.2")
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
  .option("--json", "Emit the corpus summary as raw JSON (no TUI)")
  .action(async (options) => {
    await runSpecStatus({ json: !!options.json });
  });

// -- Conflicts (within-area overlaps → section-scoped verdicts) --------------
const conflictsCmd = specCmd
  .command("conflicts")
  .description("Inspect and resolve flagged within-area doc overlaps (agent-friendly)");

conflictsCmd
  .command("list")
  .description("List flagged overlaps still awaiting a verdict")
  .option("--json", "Emit the flagged overlaps as raw JSON (no TUI)")
  .action(async (options) => {
    await runSpecConflictsList({ json: !!options.json });
  });

conflictsCmd
  .command("show <n|area>")
  .description("Show a conflict's disputed section passages with path:line anchors (by index or area)")
  .option("--json", "Emit the conflict + resolved excerpts as raw JSON (no TUI)")
  .action(async (target, options) => {
    await runSpecConflictsShow(target, { json: !!options.json });
  });

conflictsCmd
  .command("resolve [targets...]")
  .description("Resolve flagged overlaps: pick a side (--right), dismiss (--dismiss, bulk), or apply --recommended")
  .option("--right <path>", "Pick a side (one conflict): this doc is right; the other's disputed claim is suppressed at generate")
  .option("--dismiss", "Not a real conflict — dismiss (accepts several indexes, or --area for a whole area)")
  .option("--area <id>", "With --dismiss: dismiss every conflict flagged in this area")
  .option("--recommended", "Apply the verify pass's recommendation for one conflict (pick-a/pick-b/dismiss; fix-doc prints guidance)")
  .option("--note <text>", "Optional rationale")
  .action(async (targets, opts) => {
    await runSpecConflictsResolve(targets, {
      right: opts.right,
      dismiss: opts.dismiss,
      area: opts.area,
      recommended: opts.recommended,
      note: opts.note,
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
  .command("include <path...>")
  .description("Force-include one or more skipped docs and re-scan once")
  .action(async (docPaths) => {
    await runSpecDocsInclude(docPaths);
  });

docsCmd
  .command("uninclude <path>")
  .description("Remove a force-include override")
  .action(async (docPath) => {
    await runSpecDocsUninclude(docPath);
  });

docsCmd
  .command("exclude [path...]")
  .description("Force-exclude kept docs and/or add subtree exclude globs (--glob), then re-scan once")
  .option(
    "--glob <pattern>",
    "Subtree exclude glob written to config.json#spec.exclude (repeatable)",
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .action(async (docPaths, options) => {
    await runSpecDocsExclude(docPaths ?? [], { glob: options.glob });
  });

docsCmd
  .command("unexclude <path>")
  .description("Remove a force-exclude override")
  .action(async (docPath) => {
    await runSpecDocsUnexclude(docPath);
  });

// Guard — run committed spec-section scenario tests (build once via recipe, run
// scenarios in parallel sandboxes). Deterministic, LLM-free; exits non-zero on
// any failure/error so it works as a CI gate.
const guardCmd = program
  .command("guard")
  .description("Run spec-section-bound scenario tests");

guardCmd
  .command("run")
  .description("Build via the recipe and run the committed scenarios")
  .option("--scenario <id>", "Run only the scenario with this id")
  .option("--verbose", "List every scenario result (one ✓ line per pass)")
  .action(async (options) => {
    await runGuardRun({ scenario: options.scenario, verbose: !!options.verbose });
  });

guardCmd
  .command("generate")
  .description("Author spec-section-bound scenarios (classify → generate → birth-validate)")
  .option("-y, --yes", "Skip the pre-flight cost-estimate confirmation")
  .option("--llm-transport <mode>", "LLM transport: cli (default) or agent")
  .option("--io <dir>", "Request/response mailbox dir for --llm-transport agent")
  .action(async (options) => {
    await runGuardGenerate({
      yes: options.yes,
      llmTransport: options.llmTransport,
      io: options.io,
    });
  });

guardCmd
  .command("status")
  .description("Compact guard summary — section coverage, last run, last generate (LLM-free)")
  .action(async () => {
    await runGuardStatus();
  });

guardCmd
  .command("drifts")
  .description("List the current non-pass scenarios from the latest guard run (paginated)")
  .option("--limit <n>", "Number of drifts to show (default: 20)", parseInt)
  .option("--offset <n>", "Skip first N drifts", parseInt)
  .option("--all", "Show all drifts")
  .option("--json", "Emit machine-readable JSON")
  .action(async (options) => {
    await runGuardDrifts({
      limit: options.all ? Infinity : (options.limit ?? 20),
      offset: options.offset ?? 0,
      json: !!options.json,
    });
  });

guardCmd
  .command("findings")
  .description("List the last generate's birth/fidelity findings, grouped by spec section")
  .option("--kind <kind>", "Filter by finding kind: birth or fidelity")
  .option("--doc <path>", "Filter to findings bound to this doc (exact repo-relative path)")
  .option("--json", "Emit the filtered findings array as JSON")
  .action(async (options) => {
    if (options.kind && options.kind !== "birth" && options.kind !== "fidelity") {
      console.error("error: --kind must be 'birth' or 'fidelity'");
      process.exit(1);
    }
    await runGuardFindings({
      kind: options.kind,
      doc: options.doc,
      json: !!options.json,
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
