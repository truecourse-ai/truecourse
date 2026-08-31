/**
 * PR-bench library: the pieces behind `pr-bench.mts`.
 *
 * The bench evaluates whether a PR introduced behavior regressions by running
 * the guard pipeline at the PR's merge-base and at its head, generating the
 * scenario corpus AT EACH COMMIT (head seeded from base's generated corpus so
 * every base↔head scenario difference is PR-caused), and diffing per-scenario
 * verdicts partition by partition:
 *
 *   unchanged  — same scenario bytes in both corpora → verdict flips are the
 *                classic regression signal
 *   changed    — same id, different bytes (a spec/interface change re-authored
 *                it) → a head red is "changed obligation not met"
 *   added      — head-only id → a head red is "new obligation not met"
 *   removed    — base-only id → reported as a dropped obligation
 *
 * Results are memoized in a per-commit LEDGER keyed by scenario CONTENT HASH,
 * so a commit that several PRs share as merge-base runs each scenario once.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { load as parseYaml } from 'js-yaml'

// ---------------------------------------------------------------------------
// Config + bench-root layout

export interface BenchConfig {
  /** Git URL or local path the target repo was cloned from (recorded by `init`). */
  repo: string
  /** The branch merge-bases are computed against (usually `main`). */
  mainBranch: string
  /** Argv prefix that invokes the TrueCourse CLI, e.g. `["truecourse"]` or `["node", "/…/tools/cli/dist/index.js"]`. */
  truecourse: string[]
  /** Extra environment for every TrueCourse invocation. */
  env?: Record<string, string>
}

export interface BenchPaths {
  root: string
  configFile: string
  repo: string
  seedstore: string
  cache: string
  ledgerDir: string
  corporaDir: string
  reportsDir: string
}

export function benchPaths(root: string): BenchPaths {
  const abs = path.resolve(root)
  return {
    root: abs,
    configFile: path.join(abs, 'bench.json'),
    repo: path.join(abs, 'repo'),
    seedstore: path.join(abs, 'seedstore'),
    cache: path.join(abs, 'cache'),
    ledgerDir: path.join(abs, 'ledger'),
    corporaDir: path.join(abs, 'corpora'),
    reportsDir: path.join(abs, 'reports'),
  }
}

export function worktreeDir(paths: BenchPaths, role: 'base' | 'head'): string {
  return path.join(paths.root, `wt-${role}`)
}

export function readConfig(paths: BenchPaths): BenchConfig {
  if (!fs.existsSync(paths.configFile)) {
    throw new Error(`${paths.configFile} not found — run \`pr-bench init\` first`)
  }
  const cfg = JSON.parse(fs.readFileSync(paths.configFile, 'utf8')) as BenchConfig
  if (!Array.isArray(cfg.truecourse) || cfg.truecourse.length === 0) {
    throw new Error(`bench.json: "truecourse" must be a non-empty argv array`)
  }
  return cfg
}

// ---------------------------------------------------------------------------
// Small IO helpers

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

// ---------------------------------------------------------------------------
// Git

export function git(repoDir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' }).trim()
}

export function gitSucceeds(repoDir: string, ...args: string[]): boolean {
  const res = spawnSync('git', ['-C', repoDir, ...args], { stdio: 'ignore' })
  return res.status === 0
}

export function resolveSha(repoDir: string, ref: string): string {
  return git(repoDir, 'rev-parse', `${ref}^{commit}`)
}

/**
 * Put the role's persistent worktree at `sha`. Created on first use; afterwards
 * force-checked-out and cleaned, keeping `.truecourse/` (the store is reset
 * separately, from the seedstore — never inherited from the previous checkout).
 */
export function ensureWorktreeAt(paths: BenchPaths, role: 'base' | 'head', sha: string): string {
  const wt = worktreeDir(paths, role)
  if (!fs.existsSync(wt)) {
    // A hand-deleted worktree dir stays registered and blocks `add`.
    git(paths.repo, 'worktree', 'prune')
    git(paths.repo, 'worktree', 'add', '--detach', wt, sha)
    return wt
  }
  git(wt, 'checkout', '--force', '--detach', sha)
  // -e .truecourse: untracked-but-not-ignored in the target repo, must survive.
  git(wt, 'clean', '-fd', '-e', '.truecourse')
  return wt
}

// ---------------------------------------------------------------------------
// The per-worktree .truecourse store

/**
 * Rebuild `<wt>/.truecourse` from scratch: seedstore overlay, then an optional
 * scenarios override (the head run seeds from base's generated corpus), then the
 * shared LLM cache symlinked in as `.cache` so every commit reuses content-keyed
 * LLM results.
 */
export function resetStore(wt: string, paths: BenchPaths, scenariosFrom?: string): void {
  const store = path.join(wt, '.truecourse')
  // rmSync does not follow the .cache symlink — the shared cache survives.
  fs.rmSync(store, { recursive: true, force: true })
  fs.mkdirSync(store, { recursive: true })
  if (fs.existsSync(paths.seedstore)) {
    fs.cpSync(paths.seedstore, store, { recursive: true })
  }
  if (scenariosFrom) {
    const dest = path.join(store, 'scenarios')
    fs.rmSync(dest, { recursive: true, force: true })
    fs.cpSync(scenariosFrom, dest, { recursive: true })
  }
  fs.mkdirSync(paths.cache, { recursive: true })
  const cacheLink = path.join(store, '.cache')
  fs.rmSync(cacheLink, { recursive: true, force: true })
  fs.symlinkSync(paths.cache, cacheLink)
}

/**
 * The committable half of the store — what `promote` rolls forward into the
 * seedstore. Mirrors the split in `packages/core/src/config/paths.ts`
 * (GITIGNORE_CONTENTS); `scenarios/externals.local.json` rides along on purpose
 * (it is the bench's local secrets overlay, kept in the seedstore, never in git).
 */
export const PROMOTABLE_STORE_PATHS = [
  'config.json',
  'specs',
  'scenarios',
  'contracts',
  'guard/interfaces.authored.json',
  'guard/interfaces.findings.md',
] as const

/** Store paths inside a promotable dir that are run-results, not corpus. */
const PROMOTE_EXCLUDES = ['contracts/result.json'] as const

export function promoteStore(wt: string, paths: BenchPaths): string[] {
  const store = path.join(wt, '.truecourse')
  const copied: string[] = []
  for (const rel of PROMOTABLE_STORE_PATHS) {
    const src = path.join(store, rel)
    if (!fs.existsSync(src)) continue
    const dest = path.join(paths.seedstore, rel)
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.cpSync(src, dest, { recursive: true })
    copied.push(rel)
  }
  for (const rel of PROMOTE_EXCLUDES) {
    fs.rmSync(path.join(paths.seedstore, rel), { force: true })
  }
  return copied
}

// ---------------------------------------------------------------------------
// TrueCourse invocation

export function runTruecourse(
  cfg: BenchConfig,
  cwd: string,
  args: string[],
  opts: { allowFailure?: boolean } = {},
): number {
  const [cmd, ...prefix] = cfg.truecourse
  const argv = [...prefix, ...args]
  console.log(`\n$ ${[cmd, ...argv].join(' ')}  (in ${cwd})`)
  const res = spawnSync(cmd, argv, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...cfg.env },
  })
  if (res.error) throw res.error
  const status = res.status ?? 1
  if (status !== 0 && !opts.allowFailure) {
    throw new Error(`\`truecourse ${args.join(' ')}\` exited ${status}`)
  }
  return status
}

// ---------------------------------------------------------------------------
// Corpus inventory (scenario id → content hash)

export interface CorpusEntry {
  id: string
  /** sha256 over the scenario file's raw bytes. */
  hash: string
  /** Path relative to `.truecourse/scenarios/`. */
  file: string
}

export interface CorpusInventory {
  sha: string
  generatedAt: string
  scenarios: CorpusEntry[]
}

function walkYamlFiles(dir: string, rel = ''): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...walkYamlFiles(path.join(dir, entry.name), relPath))
    else if (/\.ya?ml$/.test(entry.name)) out.push(relPath)
  }
  return out.sort()
}

export function inventoryCorpus(wt: string, sha: string): CorpusInventory {
  const dir = path.join(wt, '.truecourse', 'scenarios')
  if (!fs.existsSync(dir)) {
    throw new Error(`${dir} does not exist — did guard generate run?`)
  }
  const scenarios: CorpusEntry[] = []
  const seen = new Map<string, string>()
  for (const file of walkYamlFiles(dir)) {
    const bytes = fs.readFileSync(path.join(dir, file))
    const doc = parseYaml(bytes.toString('utf8'))
    const id = doc && typeof doc === 'object' && 'id' in doc ? (doc as { id?: unknown }).id : undefined
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error(`scenario file ${file} has no top-level \`id\` — refusing to inventory`)
    }
    const prior = seen.get(id)
    if (prior) throw new Error(`scenario id ${id} appears in both ${prior} and ${file}`)
    seen.set(id, file)
    scenarios.push({ id, hash: crypto.createHash('sha256').update(bytes).digest('hex'), file })
  }
  return { sha, generatedAt: new Date().toISOString(), scenarios }
}

// ---------------------------------------------------------------------------
// Run-result ledger (memoized per-scenario outcomes, keyed by content hash)

export type ScenarioOutcome = 'pass' | 'fail' | 'stale' | 'orphaned' | 'error' | 'blocked'

export interface LedgerEntry {
  id: string
  title: string
  outcome: ScenarioOutcome
  runId: string
  ranAt: string
  failure?: { step: number; expected: string; actual: string }
}

export interface Ledger {
  sha: string
  /** Keyed by the scenario's content hash — a re-authored scenario re-runs. */
  entries: Record<string, LedgerEntry>
}

export function ledgerFile(paths: BenchPaths, sha: string): string {
  return path.join(paths.ledgerDir, `${sha}.json`)
}

export function readLedger(paths: BenchPaths, sha: string): Ledger {
  const file = ledgerFile(paths, sha)
  return fs.existsSync(file) ? readJson<Ledger>(file) : { sha, entries: {} }
}

// The subset of guard/LATEST.json the bench consumes (GuardLatestSchema).
interface GuardLatestSubset {
  run: { runId: string; ranAt: string }
  scenarios: Array<{
    id: string
    title: string
    outcome: ScenarioOutcome
    failure?: { step: number; expected: string; actual: string }
  }>
}

export function readGuardLatest(wt: string): GuardLatestSubset {
  const file = path.join(wt, '.truecourse', 'guard', 'LATEST.json')
  if (!fs.existsSync(file)) throw new Error(`${file} missing after guard run`)
  return readJson<GuardLatestSubset>(file)
}

/** Fold the LATEST rows for `ids` into the ledger, keyed by each id's corpus hash. */
export function mergeRunIntoLedger(
  ledger: Ledger,
  latest: GuardLatestSubset,
  inventory: CorpusInventory,
  ids: ReadonlySet<string>,
): void {
  const hashById = new Map(inventory.scenarios.map((s) => [s.id, s.hash]))
  for (const row of latest.scenarios) {
    if (!ids.has(row.id)) continue
    const hash = hashById.get(row.id)
    if (!hash) continue
    ledger.entries[hash] = {
      id: row.id,
      title: row.title,
      outcome: row.outcome,
      runId: latest.run.runId,
      ranAt: latest.run.ranAt,
      ...(row.failure
        ? { failure: { step: row.failure.step, expected: row.failure.expected, actual: row.failure.actual } }
        : {}),
    }
  }
}

// ---------------------------------------------------------------------------
// Diff + report

export type PartitionKind = 'unchanged' | 'changed' | 'added' | 'removed'

export interface DiffRow {
  id: string
  kind: PartitionKind
  base?: LedgerEntry
  head?: LedgerEntry
}

export function diffCorpora(
  base: CorpusInventory,
  head: CorpusInventory,
  baseLedger: Ledger,
  headLedger: Ledger,
): DiffRow[] {
  const baseById = new Map(base.scenarios.map((s) => [s.id, s]))
  const headById = new Map(head.scenarios.map((s) => [s.id, s]))
  const rows: DiffRow[] = []
  for (const [id, b] of baseById) {
    const h = headById.get(id)
    const kind: PartitionKind = !h ? 'removed' : h.hash === b.hash ? 'unchanged' : 'changed'
    rows.push({ id, kind, base: baseLedger.entries[b.hash], head: h ? headLedger.entries[h.hash] : undefined })
  }
  for (const [id, h] of headById) {
    if (!baseById.has(id)) rows.push({ id, kind: 'added', head: headLedger.entries[h.hash] })
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id))
}

const BAD: ReadonlySet<ScenarioOutcome> = new Set(['fail'])
const INFRA: ReadonlySet<ScenarioOutcome> = new Set(['error', 'blocked', 'stale', 'orphaned'])

export interface DiffReport {
  regressions: DiffRow[]
  newObligationsNotMet: DiffRow[]
  fixed: DiffRow[]
  removed: DiffRow[]
  infraFlips: DiffRow[]
  counts: Record<PartitionKind, number>
  markdown: string
}

export function buildReport(rows: DiffRow[], baseSha: string, headSha: string): DiffReport {
  const counts: Record<PartitionKind, number> = { unchanged: 0, changed: 0, added: 0, removed: 0 }
  for (const r of rows) counts[r.kind]++

  const regressions = rows.filter(
    (r) => r.kind === 'unchanged' && r.base?.outcome === 'pass' && r.head && BAD.has(r.head.outcome),
  )
  const newObligationsNotMet = rows.filter(
    (r) => (r.kind === 'added' || r.kind === 'changed') && r.head && BAD.has(r.head.outcome),
  )
  const fixed = rows.filter(
    (r) => r.kind === 'unchanged' && r.base && BAD.has(r.base.outcome) && r.head?.outcome === 'pass',
  )
  const removed = rows.filter((r) => r.kind === 'removed')
  const infraFlips = rows.filter(
    (r) =>
      r.head !== undefined &&
      INFRA.has(r.head.outcome) &&
      (r.kind === 'added' || r.kind === 'changed' || (r.base !== undefined && !INFRA.has(r.base.outcome))),
  )

  const lines: string[] = []
  const short = (sha: string) => sha.slice(0, 10)
  lines.push(`# PR bench: ${short(baseSha)} → ${short(headSha)}`)
  lines.push('')
  lines.push(`Corpus partitions: ${counts.unchanged} unchanged, ${counts.changed} changed, ${counts.added} added, ${counts.removed} removed.`)
  lines.push('')

  const section = (title: string, verdict: string, items: DiffRow[], render: (r: DiffRow) => string[]) => {
    lines.push(`## ${title} (${items.length})`)
    lines.push('')
    if (items.length === 0) {
      lines.push(verdict ? `None. ${verdict}` : 'None.')
    } else {
      for (const r of items) lines.push(...render(r), '')
    }
    lines.push('')
  }

  const detail = (e: LedgerEntry | undefined): string[] => {
    if (!e?.failure) return []
    const clip = (s: string) => (s.length > 240 ? `${s.slice(0, 240)}…` : s)
    return [
      `  - step ${e.failure.step}: expected ${clip(e.failure.expected)}`,
      `    actual: ${clip(e.failure.actual)}`,
      `  - evidence: wt-head/.truecourse/guard/evidence/${e.runId}/${e.id}/ (ephemeral — gone after the next materialization)`,
    ]
  }

  section('Regressions — unchanged scenario, base green, head red', 'No behavior covered by an unchanged scenario regressed.', regressions, (r) => [
    `- **${r.id}** — ${r.head?.title ?? ''}`,
    ...detail(r.head),
  ])
  section('New or changed obligations not met — head red', 'Every new/changed obligation the head corpus encodes is met.', newObligationsNotMet, (r) => [
    `- **${r.id}** (${r.kind}) — ${r.head?.title ?? ''}${r.base ? ` — base outcome: ${r.base.outcome} (control)` : ' — no base counterpart'}`,
    ...detail(r.head),
  ])
  section('Fixed — unchanged scenario, base red, head green', '', fixed, (r) => [
    `- **${r.id}** — ${r.head?.title ?? ''}`,
  ])
  section('Dropped obligations — scenario only in the base corpus', '', removed, (r) => [
    `- **${r.id}** — ${r.base?.title ?? ''} (base outcome: ${r.base?.outcome ?? 'not run'})`,
  ])
  section('Infra flips — head outcome error/blocked/stale/orphaned', '', infraFlips, (r) => [
    `- **${r.id}** (${r.kind}) — head: ${r.head?.outcome}${r.base ? `, base: ${r.base.outcome}` : ''}`,
  ])

  return { regressions, newObligationsNotMet, fixed, removed, infraFlips, counts, markdown: lines.join('\n') }
}
