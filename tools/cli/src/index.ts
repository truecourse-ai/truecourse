#!/usr/bin/env node

import { Command, Option } from "commander";
import * as p from "@clack/prompts";
import { LLM_PROVIDER_KINDS } from "@truecourse/shared";
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
import {
  runSpecSourceAdd,
  runSpecSourceList,
  runSpecSourceRefresh,
  runSpecSourceRemove,
} from "./commands/spec-sources.js";
import { runGuardRun, runGuardGenerate, runGuardStatus, runGuardDrifts } from "./commands/guard.js";
import {
  runGuardFlows,
  runGuardFlowDismiss,
  runGuardFlowUndismiss,
} from "./commands/guard-flows.js";
import { runGuardFindings } from "./commands/guard-findings.js";
import { runGuardSetup } from "./commands/guard-setup.js";
import { runGuardRecipe } from "./commands/guard-recipe.js";
import { runGuardExternals } from "./commands/guard-externals.js";
import {
  runGuardInterfaces,
  runGuardInterfacesAuthor,
} from "./commands/guard-interfaces.js";
import { runGuardSeed } from "./commands/guard-seed.js";
import { runConfigLlmShow, runConfigLlmTest, runConfigLlmUse } from "./commands/config.js";
import { runConfigLlmSetup, runLlmFirstRun } from "./commands/config-llm-setup.js";
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
  .version("0.8.0")
  .description("TrueCourse CLI — analyze your repository and open the dashboard");

/** `--llm-transport <mode>` — the per-run override of the saved LLM selection. */
function llmTransportOption(): Option {
  return new Option(
    "--llm-transport <mode>",
    "How to reach the LLM for this run: 'cli' (spawn claude -p), 'agent' (filesystem mailbox), or 'api' (the provider in ~/.truecourse/config.json)",
  ).choices(["cli", "agent", "api"]);
}

/** Accumulate repeatable `--place <id>` values. */
function collectPlace(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** Accumulate repeatable `--header k=v` values. */
function collectHeader(value: string, previous: string[]): string[] {
  return [...previous, value];
}

/** The invoked command's path, e.g. `spec scan` (empty for the bare `truecourse`). */
function commandPath(command: Command): string {
  const names: string[] = [];
  for (let c: Command | null = command; c && c.parent; c = c.parent) names.unshift(c.name());
  return names.join(" ");
}

// The first-run LLM choice runs before EVERY command's action (the first
// `truecourse` command a user ever runs is the one that asks). It skips itself
// when a selection is saved, when this run overrides the transport, and when
// there is no terminal to ask on.
program.hook("preAction", async (_program, actionCommand) => {
  await runLlmFirstRun({
    commandPath: commandPath(actionCommand),
    transportFlag: (actionCommand.opts() as { llmTransport?: string }).llmTransport,
  });
});

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
  .addOption(llmTransportOption())
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
  .addOption(llmTransportOption())
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
  .command("exclude <path...>")
  .description("Force-exclude one or more kept docs from the corpus and re-scan once")
  .action(async (docPaths) => {
    await runSpecDocsExclude(docPaths);
  });

docsCmd
  .command("unexclude <path>")
  .description("Remove a force-exclude override")
  .action(async (docPath) => {
    await runSpecDocsUnexclude(docPath);
  });

// -- Sources (llms.txt documentation sites) ---------------------------------
const sourceCmd = specCmd
  .command("source")
  .description("Register llms.txt documentation sites as spec docs");

sourceCmd
  .command("add <llms-txt-url>")
  .description("Fetch a site's llms.txt and snapshot every markdown page it lists")
  .option("-y, --yes", "Skip the fetch confirmation")
  .option("--id <slug>", "Override the source id derived from the URL")
  .action(async (llmsTxtUrl, options) => {
    await runSpecSourceAdd(llmsTxtUrl, { yes: !!options.yes, id: options.id });
  });

sourceCmd
  .command("list")
  .description("List registered sources with page counts and last fetch")
  .action(async () => {
    await runSpecSourceList();
  });

sourceCmd
  .command("refresh [id]")
  .description("Refetch a source (all of them when id is omitted) and report the diff")
  .action(async (id) => {
    await runSpecSourceRefresh(id);
  });

sourceCmd
  .command("remove <id>")
  .description("Delete a source's snapshot and its registry entry")
  .action(async (id) => {
    await runSpecSourceRemove(id);
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
  .addOption(llmTransportOption())
  .option("--io <dir>", "Request/response mailbox dir for --llm-transport agent")
  .action(async (options) => {
    await runGuardGenerate({
      yes: options.yes,
      llmTransport: options.llmTransport,
      io: options.io,
    });
  });

// Setup — the cheap preparation stage between `spec scan` and `guard generate`.
// Derives + PROVES the recipe, detects the repo's third parties and its
// database, declares every external API, and drafts the one seed that creates both
// the rows and the authenticated principals. `guard generate` refuses to run
// until it has: fixing any of these facts is free here and expensive afterwards.
guardCmd
  .command("setup")
  .description("Prepare the repo for guard: recipe, external APIs, and the data + auth seed")
  .option("--refresh", "Re-derive the recipe and re-draft the seed even when both exist")
  .option("-y, --yes", "Skip the cost confirm (and, with --refresh, consent to replacing the seed)")
  .addOption(llmTransportOption())
  .option("--io <dir>", "Request/response mailbox dir for --llm-transport agent")
  .action(async (options) => {
    await runGuardSetup({
      refresh: !!options.refresh,
      yes: !!options.yes,
      llmTransport: options.llmTransport,
      io: options.io,
    });
  });

guardCmd
  .command("recipe")
  .description("Show the preparation recipe and its staleness (read-only; `guard setup` derives it)")
  .option("--init", "Removed — `truecourse guard setup` derives the recipe")
  .option("--refresh", "Removed — `truecourse guard setup --refresh` re-derives it")
  .action(async (options) => {
    await runGuardRecipe({ init: !!options.init, refresh: !!options.refresh });
  });

guardCmd
  .command("seed")
  .description("Show the database seed (api.seed) and the flows blocked on missing data (read-only)")
  .option("--init", "Removed — `truecourse guard setup` drafts the seed")
  .action(async (options) => {
    await runGuardSeed({ init: !!options.init });
  });

// The interface catalog: the derived half is read off the tree by `guard setup`;
// the web TASKS are authored, one agent session per place (SPEC_GUARD_PLAN 104).
const guardInterfacesCmd = guardCmd
  .command("interfaces")
  .description("Show the interface catalog's places and the tasks authored on them (read-only)")
  .action(async () => {
    await runGuardInterfaces({});
  });

guardInterfacesCmd
  .command("author")
  .description("Author the web tasks no derivation produces — one agent session per place")
  .option("--place <id>", "Author only this place (repeatable)", collectPlace, [])
  .option("--replace", "Re-author places that already carry tasks")
  .option("--limit <n>", "Author at most N places", parseInt)
  .option("-y, --yes", "Skip the pre-flight confirmation")
  .addOption(llmTransportOption())
  .action(async (options) => {
    await runGuardInterfacesAuthor({
      place: options.place,
      replace: !!options.replace,
      limit: options.limit,
      yes: !!options.yes,
      llmTransport: options.llmTransport,
    });
  });

guardCmd
  .command("externals")
  .description("Show the third-party APIs this repo depends on and how each resolves (read-only)")
  .option("--list", "Kept for compatibility — the view is this command's only behaviour")
  .action(async (options) => {
    await runGuardExternals({ list: !!options.list });
  });

const guardFlowsCmd = guardCmd
  .command("flows")
  .description("List the synthesized flows with their per-surface coverage (LLM-free)")
  .option("--show <id>", "Show one flow: goal, milestones, binds, surfaces, interfaces, gaps")
  .action(async (options) => {
    await runGuardFlows({ show: options.show });
  });

// The FLOW is the one manual dismissal unit — a generated test's id moves when
// the flow is re-authored, so a test dismissal would silently stop matching.
// Both writes touch only the committable `scenarios/decisions.json`: instant,
// free, no engine run.
guardFlowsCmd
  .command("dismiss <flow-id>")
  .description("Rule a flow out of testing — the next generate drops it and deletes its tests")
  .option("--note <text>", "Why it was ruled out (stored with the dismissal)")
  .action(async (flowId, options) => {
    await runGuardFlowDismiss(flowId, { note: options.note });
  });

guardFlowsCmd
  .command("undismiss <flow-id>")
  .description("Put a dismissed flow back — the next generate authors tests for it again")
  .action(async (flowId) => {
    await runGuardFlowUndismiss(flowId);
  });

guardCmd
  .command("status")
  .description("Compact guard summary — section coverage, last run, last generate (LLM-free)")
  .action(async () => {
    await runGuardStatus();
  });

// The last generate's findings — what guard FOUND, grouped by flow, split by whose
// fault it is (drift = the repo's, defect = ours). `--json` is the agent contract.
guardCmd
  .command("findings")
  .description("List the last generate's findings by flow (drift vs tool defect) + the auto-resolved ledger")
  .option("--kind <class>", "Only one class: drift | defect | escalation")
  .option("--flow <id>", "Only this flow (narrows the auto-resolved ledger too)")
  .option("--json", "Emit machine-readable JSON")
  .action(async (options) => {
    await runGuardFindings({ kind: options.kind, flow: options.flow, json: !!options.json });
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

// Configuration — how TrueCourse reaches the LLM (per-user, in
// `~/.truecourse/config.json`) plus the per-repo model resolution view. Per-stage
// model overrides are still set via env vars or `.truecourse/config.json#llm`.
const configCmd = program
  .command("config")
  .description("Inspect and change TrueCourse configuration");

const configLlmCmd = configCmd
  .command("llm")
  .description("How TrueCourse calls the LLM, and which model each stage uses");

configLlmCmd
  .command("setup")
  .description("Choose the LLM transport — Claude Code or a provider API — and store its credentials")
  .addOption(
    new Option("--transport <mode>", "Transport to save (skips the prompts)").choices([
      "claude-code",
      "api",
    ]),
  )
  .addOption(new Option("--provider <name>", "API provider").choices([...LLM_PROVIDER_KINDS]))
  .option("--model <id>", "Model id every stage runs on (required in api mode)")
  .option("--fallback-model <id>", "Model tried once if the primary errors")
  .option("--api-key <key>", "API key (discouraged — it stays in your shell history)")
  .option("--api-key-env <VAR>", "Name of the env var holding the key (resolved at run time)")
  .option("--api-key-stdin", "Read the API key from stdin")
  .option("--base-url <url>", "Gateway / self-hosted endpoint speaking the provider's protocol")
  .option("--region <region>", "AWS region (bedrock)")
  .option("--access-key-id <id>", "AWS access key id (bedrock)")
  .option("--secret-access-key <key>", "AWS secret access key (bedrock)")
  .option("--session-token <token>", "AWS session token (bedrock)")
  .option("--header <k=v>", "Extra request header (repeatable)", collectHeader, [])
  .option("--no-test", "Skip the live provider probe before saving")
  .action(async (options) => {
    await runConfigLlmSetup(options);
  });

configLlmCmd
  .command("show")
  .description("Print the active transport, the saved API config (key masked), and every stage's model")
  .action(async () => {
    await runConfigLlmShow();
  });

configLlmCmd
  .command("test")
  .description("Run one live call against the saved API configuration")
  .action(async () => {
    await runConfigLlmTest();
  });

configLlmCmd
  .command("use <mode>")
  .description("Switch the saved transport between claude-code and api")
  .action(async (mode: string) => {
    await runConfigLlmUse(mode);
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
