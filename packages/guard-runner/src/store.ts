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
 *   guard/interfaces.json        last interface-mapping catalog (gitignored, re-derived)
 *   guard/interfaces.authored.json  the hand-authored half of that catalog (COMMITTED)
 *   guard/interfaces.findings.md    the authoring sessions' doc-bug feed (COMMITTED)
 *   guard/evidence/<runId>/…     per-scenario transcripts (every executed outcome; gitignored)
 *
 * The committable corpus files live one level over, under `scenarios/`:
 *
 *   scenarios/recipe.json        how to build/run the app (committable)
 *   scenarios/manifest.json      flow → scenario map (committable)
 *   scenarios/flows.json         the synthesized flow corpus (committable)
 *   scenarios/claims.json        the extracted claim corpus (committable)
 *   scenarios/decisions.json     user-authored dismissals (committable)
 */

import fs from 'node:fs'
import path from 'node:path'
import type { z } from 'zod'
import {
  EMPTY_GUARD_AUTO_RESOLUTIONS,
  GuardAutoResolutionsSchema,
  GuardClaimsFileSchema,
  GuardFlowsFileSchema,
  GuardGenerateReportSchema,
  GuardHistorySchema,
  GuardLatestSchema,
  GuardSetupReportSchema,
  InterfacesFileSchema,
  InterfacesFragmentSchema,
  type GuardAutoResolutions,
  type GuardClaimsFile,
  type GuardFlowsFile,
  type GuardGenerateReport,
  type GuardHistory,
  type GuardHistoryEntry,
  type GuardLatest,
  type GuardSetupReport,
  type Interface,
  type InterfacesFile,
  type MapperDiagnostic,
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
const INTERFACES_FILE = 'interfaces.json'
const AUTHORED_INTERFACES_FILE = 'interfaces.authored.json'
const INTERFACE_FINDINGS_FILE = 'interfaces.findings.md'
const SETUP_FINDINGS_FILE = 'setup.findings.md'
const RECIPE_FILE = 'recipe.json'
const MANIFEST_FILE = 'manifest.json'
const DECISIONS_FILE = 'decisions.json'
const FLOWS_FILE = 'flows.json'
const CLAIMS_FILE = 'claims.json'
const EXTERNALS_LOCAL_FILE = 'externals.local.json'
const DEPENDENCIES_FILE = 'dependencies.json'
const DEPENDENCIES_LOCAL_FILE = 'dependencies.local.json'

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

/** The interface catalog the last mapping wrote — derived, gitignored, may be absent. */
export function guardInterfacesPath(repoRoot: string): string {
  return path.join(guardDir(repoRoot), INTERFACES_FILE)
}

/**
 * The HAND-AUTHORED half of the catalog — committed, and the one file under
 * `guard/` no derivation ever writes. See {@link readAuthoredInterfaceCatalog}.
 */
export function guardAuthoredInterfacesPath(repoRoot: string): string {
  return path.join(guardDir(repoRoot), AUTHORED_INTERFACES_FILE)
}

/**
 * The FINDINGS LEDGER the authoring sessions append to — committed, like the
 * catalog half beside it, because what it holds is a report about the
 * REPOSITORY (a doc that disagrees with the source), not a record of a run. A
 * teammate who never ran authoring still has to be able to read it.
 */
export function guardInterfaceFindingsPath(repoRoot: string): string {
  return path.join(guardDir(repoRoot), INTERFACE_FINDINGS_FILE)
}

/**
 * The SETUP FINDINGS LEDGER — where `guard setup`'s sessions (the dependency
 * catalog, later the seed and auth sessions) append the code-vs-docs
 * discrepancies they read. Committed for the interface ledger's reason: what it
 * holds is a report about the REPOSITORY, not a record of a run. Keep it out of
 * `GITIGNORE_CONTENTS`.
 */
export function guardSetupFindingsPath(repoRoot: string): string {
  return path.join(guardDir(repoRoot), SETUP_FINDINGS_FILE)
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

/** The committable synthesized flow corpus — `scenarios/flows.json`. */
export function guardFlowsPath(repoRoot: string): string {
  return path.join(scenariosDir(repoRoot), FLOWS_FILE)
}

/**
 * The committable extracted claim corpus — `scenarios/claims.json`, next to the
 * flow corpus it is the denominator of. Committable for the same reason
 * `flows.json` is: claims are what scenarios' milestones and flows' bindings
 * REFERENCE, so a fresh clone that inherits the scenarios must inherit the claims
 * they name or every reference dangles.
 */
export function guardClaimsPath(repoRoot: string): string {
  return path.join(scenariosDir(repoRoot), CLAIMS_FILE)
}

/**
 * The GITIGNORED secrets overlay for `api.externals` — sibling of
 * recipe.json, deliberately NOT committable: it carries the API keys and the
 * per-developer sandbox URLs the committed declaration must never hold.
 */
export function externalsLocalPath(repoRoot: string): string {
  return path.join(scenariosDir(repoRoot), EXTERNALS_LOCAL_FILE)
}

/**
 * The COMMITTED dependency catalog — `scenarios/dependencies.json`, sibling of the
 * recipe it is fingerprinted with. Committable for the recipe's reason: it declares
 * WHAT starting state the program needs, which every teammate's run must agree on.
 */
export function dependenciesPath(repoRoot: string): string {
  return path.join(scenariosDir(repoRoot), DEPENDENCIES_FILE)
}

/**
 * The GITIGNORED instance overlay — `scenarios/dependencies.local.json`. Holds the
 * machine-specific half the committed catalog must never carry (a path to a real
 * project, a config dir, an API key), merged over the declaration per field at load
 * time and deliberately outside every fingerprint.
 */
export function dependenciesLocalPath(repoRoot: string): string {
  return path.join(scenariosDir(repoRoot), DEPENDENCIES_LOCAL_FILE)
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
 * Read the interface catalog the last mapping DERIVED, or `null` when it is absent
 * or unparseable. The catalog is derived and gitignored, so a missing/corrupt one is
 * simply "no interface knowledge" — it never fails a run, it only means the drift
 * annotation has nothing to compare against.
 *
 * This is HALF the catalog. A consumer asking what surfaces the repo has wants
 * {@link readMergedInterfaceCatalog}, which joins the hand-authored sibling over
 * it; this reader is for the callers that mean the derivation specifically (the
 * drift baseline, the raw-file view).
 */
export function readInterfaceCatalog(repoRoot: string): InterfacesFile | null {
  return readJsonOr(guardInterfacesPath(repoRoot), InterfacesFileSchema, null)
}

/**
 * Read the COMMITTED authored catalog — `guard/interfaces.authored.json`, the
 * home of the interfaces and places NO derivation produces. The mapper derives
 * `cli` and `api` and nothing else, so every web surface in existence is
 * hand-authored; until this file existed they lived in the derived snapshot and
 * one mapping deleted them.
 *
 * A MISSING file is the normal state and reads as "nothing authored" — most
 * repos author none. A PRESENT-but-invalid one THROWS, and that is the one place
 * this module refuses to degrade: every other reader here reads a corrupt file
 * as absent because the file is derived and the next run re-derives it, while
 * nothing re-derives this one. Reading it as empty would silently drop the exact
 * surfaces it exists to protect and settle their flows as `no-interface` — the
 * failure the whole design removes.
 *
 * It is read as a FRAGMENT (`InterfacesFragmentSchema`): the shape in full, the
 * cross-reference rules not here. An authored task stands on a place the
 * DERIVATION writes (item 103 derives the web screens into the gitignored half),
 * so its `at`/`to` ids resolve in the merge and nowhere else — and on a fresh
 * clone, where nothing has mapped yet, the derived half does not exist at all.
 * Checking them here would refuse a file that is correct. They are checked where
 * they can be: against the merged catalog, by the authoring write path.
 */
export function readAuthoredInterfaceCatalog(repoRoot: string): InterfacesFile | null {
  const file = guardAuthoredInterfacesPath(repoRoot)
  if (!fs.existsSync(file)) return null
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (error) {
    throw new Error(
      `${file} is not readable JSON (${error instanceof Error ? error.message : String(error)}). ` +
        `It is the only home of the hand-authored surfaces, so it is never read as empty — fix the file, or move it aside to run without it.`,
    )
  }
  const parsed = InterfacesFragmentSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(
      `${file} is not a valid interface catalog: ${issue ? `${issue.path.join('.')} — ${issue.message}` : 'schema validation failed'}. ` +
        `It is the only home of the hand-authored surfaces, so it is never read as empty.`,
    )
  }
  return parsed.data
}

/**
 * THE CATALOG AS A WHOLE: the derived snapshot joined with its authored sibling,
 * authored winning. This is what every consumer that asks "what surfaces does
 * this repo have" should read — {@link readInterfaceCatalog} answers only "what
 * did the last mapping derive".
 *
 * `null` when neither half exists (a repo that has never mapped and authored
 * nothing), so callers keep their single "no interface knowledge" branch.
 */
export function readMergedInterfaceCatalog(repoRoot: string): InterfacesFile | null {
  const derived = readInterfaceCatalog(repoRoot)
  const authored = readAuthoredInterfaceCatalog(repoRoot)
  if (!derived && !authored) return null
  return mergeInterfaceCatalogs(derived, authored)
}

/**
 * The pure fold behind {@link readMergedInterfaceCatalog}, exported so a caller
 * holding a FRESH mapping (guard generate's interface seam) merges by the exact
 * same rules a reader does — one merge, not two that drift.
 *
 * Interfaces union by `id`, the authored entry winning OUTRIGHT (replaced, never
 * field-merged: half a derived entry under an authored title is a shape neither
 * side wrote). An override lands in the derived list's position, so authoring
 * one entry never reshuffles the catalog. Registries — `resources` and `states`
 * alike — merge per AREA and then by id inside it, the same way: an authored
 * area arrives whole, an authored definition replaces the derived one it names.
 * The state registry travels for a reason the interfaces alone would hide: an
 * authored task's `startingState`/`at` ids resolve in it, and a merge that
 * dropped it would hand consumers ids that name nothing.
 *
 * `origin` is STAMPED here, on both sides, and always overwrites what the file
 * said. It is the honest answer the field exists for, and it is why the merge
 * does NOT invent an `authored` value for `source`: `source` says how one AREA
 * was DERIVED (`tree` vs the `probes` ladder), so an authored surface has no
 * answer to give and claims none — its absence beside a non-empty interface list
 * means "nobody derived this, a human wrote it", while its absence beside an
 * EMPTY one means the derivation failed. The authored file's own `source` is
 * dropped for the same reason: a hand-written catalog claiming
 * `{"api":"tree","web":"tree"}` is precisely the lie that hid this loss, and no
 * merged view will restate it.
 *
 * The envelope (`generatedAt`, `recipeFingerprint`) is the DERIVED run's when
 * there is one: it dates a mapping, and the authored file is not a mapping.
 */
export function mergeInterfaceCatalogs(
  derived: InterfacesFile | null,
  authored: InterfacesFile | null,
): InterfacesFile {
  const envelope = derived ?? authored
  const resources = mergeRegistries(derived?.resources, authored?.resources)
  const states = mergeRegistries(derived?.states, authored?.states)
  return {
    version: 2,
    generatedAt: envelope?.generatedAt ?? '',
    recipeFingerprint: envelope?.recipeFingerprint ?? '',
    interfaces: mergeInterfaceLists(derived?.interfaces ?? [], authored?.interfaces ?? []),
    ...(states ? { states } : {}),
    ...(resources ? { resources } : {}),
    ...(derived?.source ? { source: derived.source } : {}),
  }
}

/** The interface half of {@link mergeInterfaceCatalogs}, stamping both sides. */
export function mergeInterfaceLists(
  derived: readonly Interface[],
  authored: readonly Interface[],
): Interface[] {
  return overlayById<Interface>(
    derived.map((iface) => ({ ...iface, origin: 'derived' })),
    authored.map((iface) => ({ ...iface, origin: 'authored' })),
    (iface) => iface.id,
  )
}

/** The registry half: per AREA, then by id inside it. `undefined` when neither
 *  side names a single area — an absent registry is not an empty one. */
export function mergeRegistries<T extends { id: string }>(
  derived: Record<string, T[]> | undefined,
  authored: Record<string, T[]> | undefined,
): Record<string, T[]> | undefined {
  if (!derived && !authored) return undefined
  const areas = [...new Set([...Object.keys(derived ?? {}), ...Object.keys(authored ?? {})])]
  const merged: Record<string, T[]> = {}
  for (const area of areas) {
    merged[area] = overlayById(derived?.[area] ?? [], authored?.[area] ?? [], (entry) => entry.id)
  }
  return merged
}

/**
 * One thing the two catalog halves disagree about, noticed at merge time and
 * REPORTED, never stored — a diagnostic is a statement about this working tree
 * and goes stale the moment the tree moves, so it lives in run reporting the way
 * the context pack does. IS the general `MapperDiagnostic` union (shared owns
 * the type precisely so this producer and the mapper's cli union fold into one
 * stream without a package cycle); the alias survives for its callers' vocabulary.
 */
export type InterfaceMergeDiagnostic = MapperDiagnostic

/**
 * The authored SCREENS the derivation no longer backs — stale places.
 *
 * An authored screen whose id no derivation produced usually means the routing
 * tree moved on: the measured case is a route module that now only redirects
 * (item 5 correctly drops it), leaving an authored entry that re-earns an
 * authoring session on every `--replace` run for an address nobody can stand at.
 * The MERGE keeps the entry regardless — a fresh clone has no derived half at
 * all, and dropping authored places there would drop every web surface — so
 * the rule lives here as a REPORT for the authoring work-list to act on, never
 * as a merge rule.
 *
 * Two deliberate exclusions:
 * - authored `panel`/`dialog` places are never stale — nothing derives those,
 *   which is precisely why they are authored;
 * - a repo whose derived web half is absent or EMPTY reports nothing — the
 *   documented escape hatch for a routing idiom the derivation does not
 *   recognize, where every authored screen is legitimate.
 */
export function staleAuthoredPlaceDiagnostics(
  derived: InterfacesFile | null,
  authored: InterfacesFile | null,
): InterfaceMergeDiagnostic[] {
  const derivedPlaces = derived?.resources?.['web'] ?? []
  if (derivedPlaces.length === 0) return []
  const derivedIds = new Set(derivedPlaces.map((place) => place.id))
  const diagnostics: InterfaceMergeDiagnostic[] = []
  for (const place of authored?.resources?.['web'] ?? []) {
    if (place.kind !== 'screen' || derivedIds.has(place.id)) continue
    diagnostics.push({
      surface: 'web',
      kind: 'authored-place-not-derived',
      subject: place.id,
      detail:
        `authored screen \`${place.id}\`${place.address ? ` (${place.address})` : ''} is not in the derived catalog — ` +
        `the routing tree no longer produces it (moved, deleted, or a redirect-only module). ` +
        `It stays in the merged catalog, but authoring skips it; remove it from guard/interfaces.authored.json if it is truly gone.`,
    })
  }
  return diagnostics
}

/** Overlay `over` onto `base` by key: a match replaces IN PLACE, the rest append
 *  in `over`'s own order. */
function overlayById<T>(base: readonly T[], over: readonly T[], key: (value: T) => string): T[] {
  const overrides = new Map(over.map((value) => [key(value), value]))
  const taken = new Set<string>()
  const merged = base.map((value) => {
    const id = key(value)
    const override = overrides.get(id)
    if (!override) return value
    taken.add(id)
    return override
  })
  for (const value of over) {
    if (!taken.has(key(value))) merged.push(value)
  }
  return merged
}

/**
 * The catalog file's own TEXT, unvalidated — what the dashboard's raw interface
 * mode shows a slice of. Schema-free on purpose: the raw reading must be the
 * bytes on disk, not a re-serialization of what the schema kept.
 */
export function readInterfaceCatalogRaw(repoRoot: string): string | null {
  const file = guardInterfacesPath(repoRoot)
  if (!fs.existsSync(file)) return null
  try {
    return fs.readFileSync(file, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Read the committed flow corpus, or `null` when it is absent or unparseable — a
 * repo that has never synthesized legitimately has none.
 */
export function readGuardFlowsCorpus(repoRoot: string): GuardFlowsFile | null {
  return readJsonOr(guardFlowsPath(repoRoot), GuardFlowsFileSchema, null)
}

/**
 * Read the committed claim corpus, or `null` when it is absent or unparseable. A
 * missing file is "claims have never been extracted here", not a failure: the
 * cross-checks that resolve milestone and milestone-identity references against
 * it simply have nothing to check.
 */
export function readGuardClaimsCorpus(repoRoot: string): GuardClaimsFile | null {
  return readJsonOr(guardClaimsPath(repoRoot), GuardClaimsFileSchema, null)
}

/** Write the claim corpus atomically. */
export function writeGuardClaims(repoRoot: string, claims: GuardClaimsFile): string {
  const target = guardClaimsPath(repoRoot)
  atomicWriteJson(target, claims)
  return target
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
