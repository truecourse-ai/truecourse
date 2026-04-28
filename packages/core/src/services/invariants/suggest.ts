import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import {
  PLUGINS,
  loadSpecBundle,
  discoverFiles,
  analyzeFile,
  initParsers,
  type DiscoverContext,
  type DiscoverDiff,
  type SuggestMode,
  type SpecBundle,
  type ProgressReporter,
} from '@truecourse/analyzer'
import type { FileAnalysis, InvariantDraft, InvariantCheckpoint } from '@truecourse/shared'
import {
  clearAllDrafts,
  rejectedSignatureSet,
  readAllActiveInvariants,
  readCheckpoint,
  writeCheckpoint,
  writeDraft,
} from '../../lib/invariant-store.js'
import { log } from '../../lib/logger.js'
import type { LLMProvider } from '../llm/provider.js'
import { createLLMRunner } from './llm-adapter.js'

// ---------------------------------------------------------------------------
// Diff computation against checkpoint
// ---------------------------------------------------------------------------

function fileHash(filePath: string): string {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(filePath))
    .digest('hex')
    .slice(0, 16)
}

function buildFileHashes(repoPath: string, files: FileAnalysis[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of files) {
    const abs = path.isAbsolute(f.filePath) ? f.filePath : path.join(repoPath, f.filePath)
    if (!fs.existsSync(abs)) continue
    out[path.relative(repoPath, abs)] = fileHash(abs)
  }
  return out
}

function buildSpecHashes(spec: SpecBundle): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of spec.sections) out[s.id] = s.contentHash
  return out
}

function computeDiff(
  prev: InvariantCheckpoint | null,
  fileHashes: Record<string, string>,
  specHashes: Record<string, string>,
): DiscoverDiff {
  if (!prev) {
    return {
      changedFiles: Object.keys(fileHashes),
      changedSpecSectionIds: Object.keys(specHashes),
    }
  }

  const changedFiles: string[] = []
  for (const [p, h] of Object.entries(fileHashes)) {
    if (prev.fileHashes[p] !== h) changedFiles.push(p)
  }
  for (const p of Object.keys(prev.fileHashes)) {
    if (!(p in fileHashes)) changedFiles.push(p) // deletion
  }

  const changedSpecSectionIds: string[] = []
  for (const [id, h] of Object.entries(specHashes)) {
    if (prev.specSectionHashes[id] !== h) changedSpecSectionIds.push(id)
  }
  for (const id of Object.keys(prev.specSectionHashes)) {
    if (!(id in specHashes)) changedSpecSectionIds.push(id) // deletion
  }

  return { changedFiles, changedSpecSectionIds }
}

// ---------------------------------------------------------------------------
// File analysis
// ---------------------------------------------------------------------------

async function analyzeAllFiles(repoPath: string): Promise<FileAnalysis[]> {
  // Tree-sitter WASM parsers must be initialized before analyzeFile can parse
  // anything. The analyze pipeline initializes them via runAnalysis; suggest
  // can run standalone (before analyze, e.g. CLI `truecourse invariants
  // suggest`), so it must initialize them itself. Idempotent — calling twice
  // is a no-op.
  await initParsers()

  const filePaths = await discoverFiles(repoPath)
  const out: FileAnalysis[] = []
  for (const fp of filePaths) {
    try {
      const result = await analyzeFile(fp)
      if (result) out.push(result)
    } catch (err) {
      log.warn(`[invariants] analyzeFile failed for ${fp}: ${(err as Error).message}`)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface SuggestResult {
  mode: SuggestMode
  spec: { sections: number; empty: boolean; searchedPaths: string[] }
  drafts: InvariantDraft[]
  pluginsRun: string[]
  pluginsSkipped: string[]
}

// ---------------------------------------------------------------------------
// Public entry — `truecourse invariants suggest [--diff]`
// ---------------------------------------------------------------------------

export async function suggestInvariants(opts: {
  repoPath: string
  mode: SuggestMode
  llm: LLMProvider
  /**
   * When true, drops all existing drafts before persisting new ones. Defaults
   * to true on `full`, false on `diff` (diff mode only refreshes drafts whose
   * scope intersects the diff).
   */
  clearDrafts?: boolean
  /** Optional progress reporter — fires at each pipeline phase + per plugin. */
  onProgress?: ProgressReporter
}): Promise<SuggestResult> {
  const { repoPath, mode, llm, onProgress } = opts
  const clearDrafts = opts.clearDrafts ?? mode === 'full'
  const startedAt = Date.now()
  const report: ProgressReporter = (e) => {
    try { onProgress?.(e) } catch (err) {
      log.warn(`[Invariants] progress reporter threw: ${(err as Error).message}`)
    }
  }

  log.info(`[Invariants] suggest started (mode=${mode}, repo=${repoPath})`)
  report({ kind: 'start', mode })

  const spec = loadSpecBundle(repoPath)
  log.info(
    `[Invariants] spec loaded: ${spec.sections.length} section(s), empty=${spec.empty}, ` +
    `searched=${spec.searchedPaths.join(', ') || '(none)'}`,
  )
  report({
    kind: 'spec-loaded',
    sections: spec.sections.length,
    empty: spec.empty,
    searchedPaths: spec.searchedPaths,
  })

  const files = await analyzeAllFiles(repoPath)
  log.info(`[Invariants] files analyzed: ${files.length}`)
  report({ kind: 'files-analyzed', count: files.length })

  const existingInvariants = readAllActiveInvariants(repoPath)
  const rejected = rejectedSignatureSet(repoPath)
  const runner = createLLMRunner(llm)

  const fileHashes = buildFileHashes(repoPath, files)
  const specHashes = buildSpecHashes(spec)
  const prevCheckpoint = readCheckpoint(repoPath)
  const diff = mode === 'diff'
    ? computeDiff(prevCheckpoint, fileHashes, specHashes)
    : undefined
  if (diff) {
    log.info(
      `[Invariants] diff: ${diff.changedFiles.length} changed file(s), ` +
      `${diff.changedSpecSectionIds.length} changed section(s)`,
    )
  }

  if (clearDrafts) clearAllDrafts(repoPath)

  const ctx: DiscoverContext = {
    repoPath,
    mode,
    diff,
    files,
    spec,
    existingInvariants,
    rejectedSignatures: rejected,
    llm: runner,
    report,
  }

  const allDrafts: InvariantDraft[] = []
  const pluginsRun: string[] = []
  const pluginsSkipped: string[] = []

  for (const plugin of PLUGINS) {
    if (mode === 'diff' && diff && diff.changedFiles.length === 0 && diff.changedSpecSectionIds.length === 0) {
      log.info(`[Invariants] plugin ${plugin.type}: skipped (diff mode, no changes)`)
      pluginsSkipped.push(plugin.type)
      continue
    }

    log.info(`[Invariants] plugin ${plugin.type}: starting`)
    report({ kind: 'plugin-start', plugin: plugin.type })
    const pluginStartedAt = Date.now()

    try {
      const drafts = await plugin.discover(ctx)
      let kept = 0
      for (const d of drafts) {
        if (rejected.has(buildDraftSignature(d))) continue
        writeDraft(repoPath, d)
        allDrafts.push(d)
        kept++
      }
      const durationMs = Date.now() - pluginStartedAt
      log.info(
        `[Invariants] plugin ${plugin.type}: produced ${drafts.length} draft(s) ` +
        `(${kept} kept, ${drafts.length - kept} suppressed by rejected-signatures) in ${durationMs}ms`,
      )
      report({ kind: 'plugin-end', plugin: plugin.type, drafts: kept, durationMs })
      pluginsRun.push(plugin.type)
    } catch (err) {
      const message = (err as Error).message
      log.error(`[Invariants] plugin ${plugin.type} discover failed: ${message}`)
      report({ kind: 'plugin-failed', plugin: plugin.type, error: message })
      pluginsSkipped.push(plugin.type)
    }
  }

  // Update checkpoint
  const checkpoint: InvariantCheckpoint = {
    truecourseVersion: process.env.npm_package_version ?? '0.0.0',
    timestamp: new Date().toISOString(),
    fileHashes,
    specSectionHashes: specHashes,
    coveredScopes: existingInvariants.map((i) => i.scope),
  }
  writeCheckpoint(repoPath, checkpoint)

  const durationMs = Date.now() - startedAt
  log.info(
    `[Invariants] suggest done: ${allDrafts.length} draft(s), ` +
    `${pluginsRun.length} plugin(s) run, ${pluginsSkipped.length} skipped, ${durationMs}ms`,
  )
  report({ kind: 'done', drafts: allDrafts.length, durationMs })

  return {
    mode,
    spec: {
      sections: spec.sections.length,
      empty: spec.empty,
      searchedPaths: spec.searchedPaths,
    },
    drafts: allDrafts,
    pluginsRun,
    pluginsSkipped,
  }
}

// ---------------------------------------------------------------------------
// Draft signature for rejected-set dedupe
// ---------------------------------------------------------------------------

export function buildDraftSignature(draft: { type: string; scope: string }): string {
  return crypto
    .createHash('sha256')
    .update(`${draft.type}|${draft.scope}`)
    .digest('hex')
    .slice(0, 16)
}
