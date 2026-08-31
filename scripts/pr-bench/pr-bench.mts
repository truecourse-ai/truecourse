/**
 * PR bench — run the guard pipeline at a PR's merge-base and head, diff the
 * per-scenario verdicts, and report what the PR broke, met, or dropped.
 *
 * Usage (from the TrueCourse repo root):
 *
 *   pnpm tsx scripts/pr-bench/pr-bench.mts init <bench-root> --repo <url|path> [--main main] [--truecourse "node /…/tools/cli/dist/index.js"]
 *   pnpm tsx scripts/pr-bench/pr-bench.mts run-commit <bench-root> <ref> [--role base|head] [--scenarios-from <dir>]
 *   pnpm tsx scripts/pr-bench/pr-bench.mts eval <bench-root> (--pr <n> | --head <ref>) [--base <ref>] [--merge-ref]
 *   pnpm tsx scripts/pr-bench/pr-bench.mts promote <bench-root> [--from base|head] [--force]
 *
 * See scripts/pr-bench/README.md for the workflow (bootstrap, eval, promote).
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseArgs } from 'node:util'
import {
  benchPaths,
  buildReport,
  diffCorpora,
  ensureWorktreeAt,
  git,
  gitSucceeds,
  inventoryCorpus,
  ledgerFile,
  mergeRunIntoLedger,
  promoteStore,
  readConfig,
  readGuardLatest,
  readLedger,
  resetStore,
  resolveSha,
  runTruecourse,
  writeJson,
  worktreeDir,
  type BenchConfig,
  type BenchPaths,
  type CorpusInventory,
  type Ledger,
} from './lib.mts'

function fail(message: string): never {
  console.error(`error: ${message}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// init

function cmdInit(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      repo: { type: 'string' },
      main: { type: 'string', default: 'main' },
      truecourse: { type: 'string', default: 'truecourse' },
    },
  })
  const root = positionals[0]
  if (!root) fail('init needs a <bench-root> directory')
  if (!values.repo) fail('init needs --repo <git url or local path>')

  const paths = benchPaths(root)
  for (const dir of [paths.root, paths.seedstore, paths.cache, paths.ledgerDir, paths.corporaDir, paths.reportsDir]) {
    fs.mkdirSync(dir, { recursive: true })
  }
  if (!fs.existsSync(paths.repo)) {
    console.log(`Cloning ${values.repo} → ${paths.repo}`)
    git(paths.root, 'clone', values.repo, paths.repo)
  }
  const cfg: BenchConfig = {
    repo: values.repo,
    mainBranch: values.main,
    truecourse: values.truecourse.split(/\s+/),
  }
  writeJson(paths.configFile, cfg)
  console.log(`\nInitialized ${paths.root}`)
  console.log(`\nBootstrap next (authors the corpus once, on ${cfg.mainBranch}):`)
  console.log(`  1. pr-bench run-commit ${root} origin/${cfg.mainBranch}`)
  console.log(`  2. review specs/scenarios in ${worktreeDir(paths, 'base')}/.truecourse (conflicts, dismissals)`)
  console.log(`  3. pr-bench promote ${root}`)
  console.log(`Then evaluate PRs with: pr-bench eval ${root} --pr <n>`)
}

// ---------------------------------------------------------------------------
// The core: materialize a commit's store, generate its corpus, run memoized

interface CommitRun {
  sha: string
  wt: string
  inventory: CorpusInventory
  ledger: Ledger
}

function materializeAndRun(
  paths: BenchPaths,
  cfg: BenchConfig,
  ref: string,
  role: 'base' | 'head',
  scenariosFrom?: string,
): CommitRun {
  const sha = resolveSha(paths.repo, ref)
  console.log(`\n=== [${role}] ${sha} (${ref}) ===`)
  const wt = ensureWorktreeAt(paths, role, sha)
  resetStore(wt, paths, scenariosFrom)

  // The pipeline. Scan and setup are cache-/disk-replaying, so on a warmed
  // seedstore they only pay for what the commit actually changed.
  runTruecourse(cfg, wt, ['spec', 'scan', '-y'])
  runTruecourse(cfg, wt, ['guard', 'setup', '-y'])
  runTruecourse(cfg, wt, ['guard', 'generate', '-y'])

  const inventory = inventoryCorpus(wt, sha)
  writeJson(path.join(paths.corporaDir, `${sha}.json`), inventory)

  const ledger = readLedger(paths, sha)
  const misses = inventory.scenarios.filter((s) => !ledger.entries[s.hash])
  console.log(`corpus: ${inventory.scenarios.length} scenarios, ${misses.length} not yet run at ${sha.slice(0, 10)}`)

  if (misses.length === 0) {
    console.log('all scenarios memoized — skipping guard run')
    return { sha, wt, inventory, ledger }
  }

  // guard run exits non-zero on a red board — that is a result, not a failure.
  if (misses.length >= inventory.scenarios.length / 2) {
    // One boot for the whole board beats per-scenario boots; fresh rows for the
    // already-memoized scenarios are strictly newer data, so merge everything.
    runTruecourse(cfg, wt, ['guard', 'run', '--verbose'], { allowFailure: true })
    const latest = readGuardLatest(wt)
    mergeRunIntoLedger(ledger, latest, inventory, new Set(inventory.scenarios.map((s) => s.id)))
    writeJson(ledgerFile(paths, sha), ledger)
  } else {
    for (const miss of misses) {
      runTruecourse(cfg, wt, ['guard', 'run', '--scenario', miss.id], { allowFailure: true })
      const latest = readGuardLatest(wt)
      mergeRunIntoLedger(ledger, latest, inventory, new Set([miss.id]))
      writeJson(ledgerFile(paths, sha), ledger)
    }
  }

  const unrecorded = inventory.scenarios.filter((s) => !ledger.entries[s.hash])
  if (unrecorded.length > 0) {
    fail(`guard run left ${unrecorded.length} scenario(s) without a recorded outcome: ${unrecorded.map((s) => s.id).join(', ')}`)
  }
  return { sha, wt, inventory, ledger }
}

function cmdRunCommit(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      role: { type: 'string', default: 'base' },
      'scenarios-from': { type: 'string' },
      'no-fetch': { type: 'boolean', default: false },
    },
  })
  const [root, ref] = positionals
  if (!root || !ref) fail('run-commit needs <bench-root> and <ref>')
  if (values.role !== 'base' && values.role !== 'head') fail('--role must be base or head')

  const paths = benchPaths(root)
  const cfg = readConfig(paths)
  if (!values['no-fetch']) git(paths.repo, 'fetch', 'origin')
  materializeAndRun(paths, cfg, ref, values.role, values['scenarios-from'])
}

// ---------------------------------------------------------------------------
// eval

function cmdEval(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      pr: { type: 'string' },
      head: { type: 'string' },
      base: { type: 'string' },
      'merge-ref': { type: 'boolean', default: false },
    },
  })
  const root = positionals[0]
  if (!root) fail('eval needs a <bench-root>')
  if (!values.pr && !values.head) fail('eval needs --pr <n> or --head <ref>')

  const paths = benchPaths(root)
  const cfg = readConfig(paths)
  git(paths.repo, 'fetch', 'origin')

  let headRef: string
  if (values.pr) {
    const n = values.pr
    const kind = values['merge-ref'] ? 'merge' : 'head'
    headRef = `refs/prbench/pr-${n}-${kind}`
    // The merge ref tests base+PR as it would land; it is absent while the PR conflicts.
    git(paths.repo, 'fetch', '--force', 'origin', `pull/${n}/${kind}:${headRef}`)
  } else {
    headRef = values.head as string
  }
  const headSha = resolveSha(paths.repo, headRef)
  const baseSha = values.base
    ? resolveSha(paths.repo, values.base)
    : git(paths.repo, 'merge-base', `origin/${cfg.mainBranch}`, headSha)

  const base = materializeAndRun(paths, cfg, baseSha, 'base')
  // The head corpus grows out of base's generated one, so every base↔head
  // scenario difference is caused by the PR, not by seedstore staleness.
  const head = materializeAndRun(
    paths,
    cfg,
    headSha,
    'head',
    path.join(base.wt, '.truecourse', 'scenarios'),
  )

  const rows = diffCorpora(base.inventory, head.inventory, base.ledger, head.ledger)
  const report = buildReport(rows, baseSha, headSha)
  const reportFile = path.join(paths.reportsDir, `${baseSha.slice(0, 10)}..${headSha.slice(0, 10)}.md`)
  fs.writeFileSync(reportFile, report.markdown)

  console.log(`\n=== verdict ===`)
  console.log(`partitions: ${report.counts.unchanged} unchanged, ${report.counts.changed} changed, ${report.counts.added} added, ${report.counts.removed} removed`)
  console.log(`regressions:               ${report.regressions.length}`)
  console.log(`new obligations not met:   ${report.newObligationsNotMet.length}`)
  console.log(`fixed:                     ${report.fixed.length}`)
  console.log(`dropped obligations:       ${report.removed.length}`)
  console.log(`infra flips (need triage): ${report.infraFlips.length}`)
  console.log(`\nreport: ${reportFile}`)
  if (report.regressions.length > 0 || report.newObligationsNotMet.length > 0) process.exitCode = 2
}

// ---------------------------------------------------------------------------
// promote

function cmdPromote(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      from: { type: 'string', default: 'base' },
      force: { type: 'boolean', default: false },
    },
  })
  const root = positionals[0]
  if (!root) fail('promote needs a <bench-root>')
  if (values.from !== 'base' && values.from !== 'head') fail('--from must be base or head')

  const paths = benchPaths(root)
  const cfg = readConfig(paths)
  const wt = worktreeDir(paths, values.from)
  if (!fs.existsSync(wt)) fail(`${wt} does not exist — run-commit first`)
  const sha = git(wt, 'rev-parse', 'HEAD')

  git(paths.repo, 'fetch', 'origin')
  const onMain = gitSucceeds(paths.repo, 'merge-base', '--is-ancestor', sha, `origin/${cfg.mainBranch}`)
  if (!onMain && !values.force) {
    fail(
      `${sha.slice(0, 10)} is not on origin/${cfg.mainBranch} — promoting a PR-side corpus would poison every later baseline. Pass --force only if you mean it.`,
    )
  }

  const copied = promoteStore(wt, paths)
  console.log(`Promoted from ${values.from} worktree @ ${sha.slice(0, 10)} into seedstore:`)
  for (const rel of copied) console.log(`  - ${rel}`)
}

// ---------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2)
switch (command) {
  case 'init':
    cmdInit(rest)
    break
  case 'run-commit':
    cmdRunCommit(rest)
    break
  case 'eval':
    cmdEval(rest)
    break
  case 'promote':
    cmdPromote(rest)
    break
  default:
    console.error('usage: pr-bench <init|run-commit|eval|promote> … (see scripts/pr-bench/README.md)')
    process.exit(1)
}
