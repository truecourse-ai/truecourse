/**
 * THE WORK TREE — the `.truecourse/` directory the engine reads and writes
 * inside a RUN'S WORKING DIRECTORY.
 *
 * A run works on a copy: a job clones the repository, materializes the state it
 * needs out of Postgres into this tree, runs the engine over it, and collects
 * the result back out. Nothing here outlives the run, nothing here is shown to
 * anyone, and nothing here is committed — the durable store is Postgres.
 *
 * This module owns the LAYOUT. Every path inside a work tree is derived here,
 * so the shape of the tree is one file's business and the producers and
 * consumers (`@truecourse/guard-runner`, `@truecourse/guard-generator`,
 * `@truecourse/spec-consolidator`, `@truecourse/core` and the jobs that
 * materialize and collect) never spell a segment themselves.
 *
 *   specs/corpus.json              the curated document corpus
 *   specs/decisions.json           the curation the corpus was folded with
 *   guard/LATEST.json              the current run state
 *   guard/runs/<runId>.json        per-run snapshots
 *   guard/history.json             per-run summaries, append-only
 *   guard/sections/<runId>.json    a run's per-section summary
 *   guard/result.json              the last `guard generate` report
 *   guard/setup.json               the last `guard setup` record
 *   guard/interfaces.json          the derived interface catalog
 *   guard/interfaces.authored.json the hand-authored half of that catalog
 *   guard/interfaces.findings.md   the authoring sessions' findings ledger
 *   guard/interfaces.noncanonical.json  every step locator that needed `css`
 *   guard/setup.findings.md        the setup sessions' findings ledger
 *   guard/adjudicate.findings.md   the adjudication sessions' findings ledger
 *   guard/findings.md              the rendered findings report
 *   guard/auto-resolutions.json    the auto-resolve ledger + flow-taint set
 *   guard/.world-dirty             the marker a mutating tail leaves behind
 *   guard/evidence/<runId>/<scenario>/  per-scenario evidence bundles
 *   scenarios/recipe.json          how to build and run the program
 *   scenarios/manifest.json        flow → scenario map
 *   scenarios/flows.json           the synthesized flow corpus
 *   scenarios/claims.json          the extracted claim corpus
 *   scenarios/decisions.json       the dismissals generate honors
 *   scenarios/dependencies.json    the dependency catalog
 *   scenarios/dependencies.local.json  this run's registered instances
 *   scenarios/externals.local.json     this run's external-service secrets
 *   scenarios/<area>/*.yaml        the scenarios themselves
 *   .cache/<name>/<key>.json       the per-stage LLM caches
 *   logs/                          a run's own LLM call diagnostics
 */

import path from 'node:path';

/** The one directory name the whole tree hangs off. */
export const WORK_TREE_DIR = '.truecourse';

const SPECS_DIR = 'specs';
const GUARD_DIR = 'guard';
const SCENARIOS_DIR = 'scenarios';
const RUNS_DIR = 'runs';
const SECTIONS_DIR = 'sections';
const EVIDENCE_DIR = 'evidence';
const CACHE_DIR = '.cache';
const LOGS_DIR = 'logs';

const CORPUS_FILE = 'corpus.json';
const SPEC_DECISIONS_FILE = 'decisions.json';
const LATEST_FILE = 'LATEST.json';
const HISTORY_FILE = 'history.json';
const RESULT_FILE = 'result.json';
const SETUP_FILE = 'setup.json';
const AUTO_RESOLUTIONS_FILE = 'auto-resolutions.json';
const WORLD_DIRTY_FILE = '.world-dirty';
const INTERFACES_FILE = 'interfaces.json';
const AUTHORED_INTERFACES_FILE = 'interfaces.authored.json';
const INTERFACE_FINDINGS_FILE = 'interfaces.findings.md';
const NON_CANONICAL_LOCATORS_FILE = 'interfaces.noncanonical.json';
const SETUP_FINDINGS_FILE = 'setup.findings.md';
const ADJUDICATE_FINDINGS_FILE = 'adjudicate.findings.md';
const FINDINGS_REPORT_FILE = 'findings.md';
const RECIPE_FILE = 'recipe.json';
const MANIFEST_FILE = 'manifest.json';
const GUARD_DECISIONS_FILE = 'decisions.json';
const FLOWS_FILE = 'flows.json';
const CLAIMS_FILE = 'claims.json';
const DEPENDENCIES_FILE = 'dependencies.json';
const DEPENDENCIES_LOCAL_FILE = 'dependencies.local.json';
const EXTERNALS_LOCAL_FILE = 'externals.local.json';

/** `<workDir>/.truecourse` — the root of one run's tree. */
export function workTreeDir(workDir: string): string {
  return path.join(workDir, WORK_TREE_DIR);
}

// --- specs ------------------------------------------------------------------

export function specsDir(workDir: string): string {
  return path.join(workTreeDir(workDir), SPECS_DIR);
}

export function corpusFilePath(workDir: string): string {
  return path.join(specsDir(workDir), CORPUS_FILE);
}

export function specDecisionsPath(workDir: string): string {
  return path.join(specsDir(workDir), SPEC_DECISIONS_FILE);
}

// --- guard run store --------------------------------------------------------

export function guardDir(workDir: string): string {
  return path.join(workTreeDir(workDir), GUARD_DIR);
}

export function guardLatestPath(workDir: string): string {
  return path.join(guardDir(workDir), LATEST_FILE);
}

export function guardRunsDir(workDir: string): string {
  return path.join(guardDir(workDir), RUNS_DIR);
}

/** The runId is already `<iso>_<short>`, filesystem-safe. */
export function guardRunPath(workDir: string, runId: string): string {
  return path.join(guardRunsDir(workDir), `${runId}.json`);
}

export function guardHistoryPath(workDir: string): string {
  return path.join(guardDir(workDir), HISTORY_FILE);
}

export function guardSectionsDir(workDir: string): string {
  return path.join(guardDir(workDir), SECTIONS_DIR);
}

export function guardSectionsPath(workDir: string, runId: string): string {
  return path.join(guardSectionsDir(workDir), `${runId}.json`);
}

export function guardResultPath(workDir: string): string {
  return path.join(guardDir(workDir), RESULT_FILE);
}

export function guardSetupPath(workDir: string): string {
  return path.join(guardDir(workDir), SETUP_FILE);
}

/** The catalog a mapping derives from the tree. */
export function guardInterfacesPath(workDir: string): string {
  return path.join(guardDir(workDir), INTERFACES_FILE);
}

/** The hand-authored half of the catalog — the one file under `guard/` no
 *  derivation ever writes. */
export function guardAuthoredInterfacesPath(workDir: string): string {
  return path.join(guardDir(workDir), AUTHORED_INTERFACES_FILE);
}

/** Where the authoring sessions append the doc bugs they read. */
export function guardInterfaceFindingsPath(workDir: string): string {
  return path.join(guardDir(workDir), INTERFACE_FINDINGS_FILE);
}

/** The record of every authored step that reaches its element through `css`,
 *  regenerated from the catalog after each authoring run. */
export function guardNonCanonicalLocatorsPath(workDir: string): string {
  return path.join(guardDir(workDir), NON_CANONICAL_LOCATORS_FILE);
}

/** Where setup's sessions (the dependency catalog, the seed) append the
 *  code-vs-docs discrepancies they read. */
export function guardSetupFindingsPath(workDir: string): string {
  return path.join(guardDir(workDir), SETUP_FINDINGS_FILE);
}

/** Where adjudication's sessions append theirs. */
export function guardAdjudicateFindingsPath(workDir: string): string {
  return path.join(guardDir(workDir), ADJUDICATE_FINDINGS_FILE);
}

/** The rendered `bug` / `drift` findings report — regenerated, never appended. */
export function guardFindingsReportPath(workDir: string): string {
  return path.join(guardDir(workDir), FINDINGS_REPORT_FILE);
}

/**
 * The marker that says the datastore's state is UNKNOWN, so the next boot runs
 * `api.services.reset` before `up`. A successful reset clears it. Two writers
 * put it there: a run about to execute a `world: mutates` tail (one that
 * survives means the tail's damage was never undone), and a job materializing a
 * fresh clone of a world earlier jobs of this repository shared.
 */
export function guardWorldDirtyMarkerPath(workDir: string): string {
  return path.join(guardDir(workDir), WORLD_DIRTY_FILE);
}

/** The auto-resolve ledger + flow-taint set generate reads and rewrites. */
export function guardAutoResolutionsPath(workDir: string): string {
  return path.join(guardDir(workDir), AUTO_RESOLUTIONS_FILE);
}

export function evidenceRunDir(workDir: string, runId: string): string {
  return path.join(guardDir(workDir), EVIDENCE_DIR, runId);
}

export function evidenceScenarioDir(workDir: string, runId: string, scenarioId: string): string {
  return path.join(evidenceRunDir(workDir, runId), sanitizeSegment(scenarioId));
}

/** The tree-relative evidence pointer stored in LATEST (POSIX separators). */
export function evidenceRelPath(runId: string, scenarioId: string): string {
  return [WORK_TREE_DIR, GUARD_DIR, EVIDENCE_DIR, runId, sanitizeSegment(scenarioId)].join('/');
}

/** A scenario id may contain dots; keep it safe as a directory name. */
export function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// --- scenario corpus --------------------------------------------------------

export function scenariosDir(workDir: string): string {
  return path.join(workTreeDir(workDir), SCENARIOS_DIR);
}

export function recipePath(workDir: string): string {
  return path.join(scenariosDir(workDir), RECIPE_FILE);
}

export function manifestPath(workDir: string): string {
  return path.join(scenariosDir(workDir), MANIFEST_FILE);
}

/** The dismissals `guard generate` honors. */
export function guardDecisionsPath(workDir: string): string {
  return path.join(scenariosDir(workDir), GUARD_DECISIONS_FILE);
}

export function guardFlowsPath(workDir: string): string {
  return path.join(scenariosDir(workDir), FLOWS_FILE);
}

/** The claim corpus the scenarios' milestones and the flows' bindings name. */
export function guardClaimsPath(workDir: string): string {
  return path.join(scenariosDir(workDir), CLAIMS_FILE);
}

/** What starting state the program needs, per class. */
export function dependenciesPath(workDir: string): string {
  return path.join(scenariosDir(workDir), DEPENDENCIES_FILE);
}

/**
 * The instance overlay — the registered API keys, config dirs and paths merged
 * over the catalog per field at load time, and outside every fingerprint. The
 * repository's stored overlay row is decrypted into here for the run.
 */
export function dependenciesLocalPath(workDir: string): string {
  return path.join(scenariosDir(workDir), DEPENDENCIES_LOCAL_FILE);
}

/** The same, for the base URLs and keys of the recipe's external services. */
export function externalsLocalPath(workDir: string): string {
  return path.join(scenariosDir(workDir), EXTERNALS_LOCAL_FILE);
}

// --- derived ----------------------------------------------------------------

/** One LLM stage's cache directory. Content-keyed, safe to delete. */
export function workTreeCacheDir(workDir: string, cacheName: string): string {
  return path.join(workTreeDir(workDir), CACHE_DIR, cacheName);
}

/** A run's own LLM call diagnostics. */
export function workTreeLogsDir(workDir: string): string {
  return path.join(workTreeDir(workDir), LOGS_DIR);
}
