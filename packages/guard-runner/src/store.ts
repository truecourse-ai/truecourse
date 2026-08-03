/**
 * Guard store paths + readers/writers under `<repo>/.truecourse/guard/`, mirroring
 * the verify store: per-run snapshots, a materialized LATEST, and append-only
 * history. No `diff.json` — guard shows current state only.
 *
 *   guard/runs/<runId>.json      per-run snapshots (gitignored)
 *   guard/LATEST.json            materialized current run state (committable)
 *   guard/history.json           per-run summaries, append-only (gitignored)
 *   guard/result.json            last `guard generate` report (gitignored)
 *   guard/setup.json             last `guard setup` record + detection snapshot (gitignored)
 *   guard/journeys.json          last journey-mapping catalog (gitignored, re-derived)
 *   guard/evidence/<runId>/…     per-scenario transcripts (every executed outcome; gitignored)
 */

import fs from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'
import {
  EMPTY_GUARD_AUTO_RESOLUTIONS,
  GuardAutoResolutionsSchema,
  GuardGenerateReportSchema,
  GuardHistorySchema,
  GuardLatestSchema,
  GuardSetupReportSchema,
  JourneysFileSchema,
  type GuardAutoResolutions,
  type GuardGenerateReport,
  type GuardHistory,
  type GuardHistoryEntry,
  type GuardLatest,
  type GuardSetupReport,
  type JourneysFile,
} from '@truecourse/shared'

const TRUECOURSE_DIR = '.truecourse'
const GUARD_DIR = 'guard'
const SCENARIOS_DIR = 'scenarios'
const RUNS_DIR = 'runs'
const EVIDENCE_DIR = 'evidence'
const LATEST_FILE = 'LATEST.json'
const HISTORY_FILE = 'history.json'
const RESULT_FILE = 'result.json'
const SETUP_FILE = 'setup.json'
const AUTO_RESOLUTIONS_FILE = 'auto-resolutions.json'
const JOURNEYS_FILE = 'journeys.json'
const RECIPE_FILE = 'recipe.json'
const MANIFEST_FILE = 'manifest.json'
const DECISIONS_FILE = 'decisions.json'
const EXTERNALS_LOCAL_FILE = 'externals.local.json'

export function guardDir(repoRoot: string): string {
  return path.join(repoRoot, TRUECOURSE_DIR, GUARD_DIR)
}

export function guardLatestPath(repoRoot: string): string {
  return path.join(guardDir(repoRoot), LATEST_FILE)
}

export function guardRunsDir(repoRoot: string): string {
  return path.join(guardDir(repoRoot), RUNS_DIR)
}

/** Per-run snapshot path; the runId is already `<iso>_<short>` filesystem-safe. */
export function guardRunPath(repoRoot: string, runId: string): string {
  return path.join(guardRunsDir(repoRoot), `${runId}.json`)
}

export function guardHistoryPath(repoRoot: string): string {
  return path.join(guardDir(repoRoot), HISTORY_FILE)
}

export function guardResultPath(repoRoot: string): string {
  return path.join(guardDir(repoRoot), RESULT_FILE)
}

/** The last `guard setup` record — derived, gitignored, may be absent. */
export function guardSetupPath(repoRoot: string): string {
  return path.join(guardDir(repoRoot), SETUP_FILE)
}

/** The journey catalog the last mapping wrote — derived, gitignored, may be absent. */
export function guardJourneysPath(repoRoot: string): string {
  return path.join(guardDir(repoRoot), JOURNEYS_FILE)
}

export function scenariosDir(repoRoot: string): string {
  return path.join(repoRoot, TRUECOURSE_DIR, SCENARIOS_DIR)
}

export function recipePath(repoRoot: string): string {
  return path.join(scenariosDir(repoRoot), RECIPE_FILE)
}

export function manifestPath(repoRoot: string): string {
  return path.join(scenariosDir(repoRoot), MANIFEST_FILE)
}

/** The committable, user-authored guard decisions file — next to recipe/manifest,
 *  NOT under the mostly-gitignored `guard/` run store. */
export function guardDecisionsPath(repoRoot: string): string {
  return path.join(scenariosDir(repoRoot), DECISIONS_FILE)
}

/**
 * The GITIGNORED secrets overlay for `api.externals` — sibling of
 * recipe.json, deliberately NOT committable: it carries the API keys and the
 * per-developer sandbox URLs the committed declaration must never hold.
 */
export function externalsLocalPath(repoRoot: string): string {
  return path.join(scenariosDir(repoRoot), EXTERNALS_LOCAL_FILE)
}

export function evidenceRunDir(repoRoot: string, runId: string): string {
  return path.join(guardDir(repoRoot), EVIDENCE_DIR, runId)
}

export function evidenceScenarioDir(repoRoot: string, runId: string, scenarioId: string): string {
  return path.join(evidenceRunDir(repoRoot, runId), sanitizeSegment(scenarioId))
}

/** Repo-relative evidence pointer stored in LATEST (portable, POSIX separators). */
export function evidenceRelPath(runId: string, scenarioId: string): string {
  return [TRUECOURSE_DIR, GUARD_DIR, EVIDENCE_DIR, runId, sanitizeSegment(scenarioId)].join('/')
}

/** A scenario id may contain dots; keep it filesystem-safe as a directory name. */
export function sanitizeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_')
}

/**
 * Write `data` to `targetPath` atomically (write-to-tmp + rename). Mirrors core's
 * `atomicWriteJson` so guard-runner stays free of a `@truecourse/core` dependency.
 */
export function atomicWriteJson(targetPath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  const tmp = `${targetPath}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
  fs.renameSync(tmp, targetPath)
}

export function writeGuardLatest(repoRoot: string, latest: GuardLatest): string {
  const target = guardLatestPath(repoRoot)
  atomicWriteJson(target, latest)
  return target
}

/** Read + validate LATEST, or `null` when absent or unparseable. */
export function readGuardLatest(repoRoot: string): GuardLatest | null {
  return readJsonOr(guardLatestPath(repoRoot), GuardLatestSchema, null)
}

/** Write the per-run snapshot to `runs/<runId>.json`. */
export function writeGuardRun(repoRoot: string, latest: GuardLatest): string {
  const target = guardRunPath(repoRoot, latest.run.runId)
  atomicWriteJson(target, latest)
  return target
}

/** Read the append-only run history; a missing or corrupt file reads as empty. */
export function readGuardHistory(repoRoot: string): GuardHistory {
  return readJsonOr(guardHistoryPath(repoRoot), GuardHistorySchema, { runs: [] })
}

/** Append one summary row to the run history (read + push + atomic write). */
export function appendGuardHistory(repoRoot: string, entry: GuardHistoryEntry): void {
  const history = readGuardHistory(repoRoot)
  history.runs.push(entry)
  atomicWriteJson(guardHistoryPath(repoRoot), history)
}

/** Write the last `guard generate` report. */
export function writeGuardResult(repoRoot: string, report: GuardGenerateReport): string {
  const target = guardResultPath(repoRoot)
  atomicWriteJson(target, report)
  return target
}

/** Read the last `guard generate` report, or `null` when absent or unparseable. */
export function readGuardResult(repoRoot: string): GuardGenerateReport | null {
  return readJsonOr(guardResultPath(repoRoot), GuardGenerateReportSchema, null)
}

/** The durable auto-resolve ledger + flow-taint set — gitignored run
 *  memory under `guard/`, like `result.json`. */
export function guardAutoResolutionsPath(repoRoot: string): string {
  return path.join(guardDir(repoRoot), AUTO_RESOLUTIONS_FILE)
}

/** Read the ledger; a missing or corrupt file reads as empty (never blocks a run). */
export function readGuardAutoResolutions(repoRoot: string): GuardAutoResolutions {
  return readJsonOr(guardAutoResolutionsPath(repoRoot), GuardAutoResolutionsSchema, EMPTY_GUARD_AUTO_RESOLUTIONS)
}

/** Write the durable auto-resolution ledger atomically. */
export function writeGuardAutoResolutions(repoRoot: string, ledger: GuardAutoResolutions): string {
  const target = guardAutoResolutionsPath(repoRoot)
  atomicWriteJson(target, ledger)
  return target
}

/** Write the last `guard setup` record. */
export function writeGuardSetup(repoRoot: string, report: GuardSetupReport): string {
  const target = guardSetupPath(repoRoot)
  atomicWriteJson(target, report)
  return target
}

/**
 * Read the last `guard setup` record, or `null` when absent or unparseable. A
 * missing/corrupt file means "setup has not run" — never a failure: the file is
 * derived and gitignored, so a fresh clone legitimately has none.
 */
export function readGuardSetup(repoRoot: string): GuardSetupReport | null {
  return readJsonOr(guardSetupPath(repoRoot), GuardSetupReportSchema, null)
}

/**
 * Read the journey catalog the last mapping wrote, or `null` when it is absent or
 * unparseable. The catalog is derived and gitignored, so a missing/corrupt one is
 * simply "no journey knowledge" — it never fails a run, it only means the drift
 * annotation has nothing to compare against.
 */
export function readJourneyCatalog(repoRoot: string): JourneysFile | null {
  return readJsonOr(guardJourneysPath(repoRoot), JourneysFileSchema, null)
}

/** Parse `file` against `schema`, returning `fallback` when absent or unreadable.
 *  The input type is decoupled from the output so schemas that `z.preprocess`
 *  (whose input is `unknown`, e.g. the legacy coverage-gap migration) still bind. */
function readJsonOr<T>(file: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, fallback: T): T {
  if (!fs.existsSync(file)) return fallback
  try {
    const parsed = schema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')))
    return parsed.success ? parsed.data : fallback
  } catch {
    return fallback
  }
}
