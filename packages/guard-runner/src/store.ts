/**
 * Guard store paths + readers/writers under `<repo>/.truecourse/guard/`, mirroring
 * the verify store: per-run snapshots, a materialized LATEST, and append-only
 * history. No `diff.json` — guard shows current state only.
 *
 *   guard/runs/<runId>.json      per-run snapshots (gitignored)
 *   guard/LATEST.json            materialized current run state (committable)
 *   guard/history.json           per-run summaries, append-only (gitignored)
 *   guard/result.json            last `guard generate` report (gitignored)
 *   guard/evidence/<runId>/…     per-scenario transcripts (every executed outcome; gitignored)
 */

import fs from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'
import {
  GuardGenerateReportSchema,
  GuardHistorySchema,
  GuardLatestSchema,
  GuardPackManifestSchema,
  type GuardGenerateReport,
  type GuardHistory,
  type GuardHistoryEntry,
  type GuardLatest,
  type GuardPackManifest,
} from '@truecourse/shared'

const TRUECOURSE_DIR = '.truecourse'
const GUARD_DIR = 'guard'
const SCENARIOS_DIR = 'scenarios'
const CORPUS_DIR = 'corpus'
const RUNS_DIR = 'runs'
const EVIDENCE_DIR = 'evidence'
const LATEST_FILE = 'LATEST.json'
const HISTORY_FILE = 'history.json'
const RESULT_FILE = 'result.json'
const RECIPE_FILE = 'recipe.json'
const MANIFEST_FILE = 'manifest.json'
const DECISIONS_FILE = 'decisions.json'
const PACK_MANIFEST_FILE = 'pack.json'

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

// --- Input-corpus store (item 8) ------------------------------------
// Committed input packs under `scenarios/corpus/<pack>/` — the many inputs an
// invariant scenario runs its rule over. The `scenarios/` tree is committable by
// convention, so packs travel via git with no `.gitignore` work.

/** The corpus root — `scenarios/corpus/`. */
export function corpusDir(repoRoot: string): string {
  return path.join(scenariosDir(repoRoot), CORPUS_DIR)
}

/** One pack's directory — `scenarios/corpus/<pack>/`. */
export function packDir(repoRoot: string, packId: string): string {
  return path.join(corpusDir(repoRoot), packId)
}

/** A pack's `pack.json` manifest path. */
export function packManifestPath(repoRoot: string, packId: string): string {
  return path.join(packDir(repoRoot, packId), PACK_MANIFEST_FILE)
}

/** Read + validate a pack's manifest, or `null` when absent or unparseable. */
export function readPackManifest(repoRoot: string, packId: string): GuardPackManifest | null {
  return readJsonOr(packManifestPath(repoRoot, packId), GuardPackManifestSchema, null)
}

/** Write a pack's `pack.json` manifest atomically. */
export function writePackManifest(repoRoot: string, manifest: GuardPackManifest): string {
  const target = packManifestPath(repoRoot, manifest.pack)
  atomicWriteJson(target, manifest)
  return target
}

/** One staged input file: its pack-relative name and its content. */
export interface PackInput {
  name: string
  content: string
}

/**
 * Load a pack's input files (everything under `scenarios/corpus/<pack>/` except the
 * `pack.json` manifest), sorted by name for a deterministic sweep order. A failure
 * result — the pack directory is missing or holds no input files — is returned so
 * the runner can fail LOUD (an orphaned pack must never be silently skipped), never
 * an empty success.
 */
export function loadPackInputs(
  repoRoot: string,
  packId: string,
): { ok: true; files: PackInput[] } | { ok: false; reason: string } {
  const dir = packDir(repoRoot, packId)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return { ok: false, reason: `input pack "${packId}" not found at ${path.relative(repoRoot, dir)}` }
  }
  const files: PackInput[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || entry.name === PACK_MANIFEST_FILE) continue
    files.push({ name: entry.name, content: fs.readFileSync(path.join(dir, entry.name), 'utf-8') })
  }
  if (files.length === 0) {
    return { ok: false, reason: `input pack "${packId}" has no input files under ${path.relative(repoRoot, dir)}` }
  }
  return { ok: true, files }
}

/**
 * Seed (write) a pack: its input files plus the `pack.json` manifest. Idempotent
 * per file — overwrites `seed`-source files, but PRESERVES any existing `user`-source
 * file (a hand-added real-world repro survives regeneration; the item-9 ratchet). The
 * manifest is rewritten to the union so the provenance record stays complete.
 */
export function writePack(
  repoRoot: string,
  manifest: GuardPackManifest,
  files: Record<string, string>,
): void {
  const dir = packDir(repoRoot, manifest.pack)
  fs.mkdirSync(dir, { recursive: true })
  // Preserve user-added files from a prior manifest — never clobber a real repro.
  const prior = readPackManifest(repoRoot, manifest.pack)
  const userFiles = (prior?.files ?? []).filter((f) => f.source === 'user')
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content)
  }
  const merged: GuardPackManifest = {
    ...manifest,
    files: [
      ...manifest.files,
      ...userFiles.filter((u) => !manifest.files.some((f) => f.name === u.name)),
    ],
  }
  writePackManifest(repoRoot, merged)
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
