import { PLUGINS, type EstimateContext } from '@truecourse/analyzer'
import { readAllActiveInvariants } from '../../lib/invariant-store.js'

// ---------------------------------------------------------------------------
// Predict the LLM cost of running invariant enforcement on `analyze`. Used by
// the pre-flight prompt so users see the full picture (rule LLM cost +
// invariant LLM cost) before approving.
//
// Plugins opt in by implementing `estimateEnforce`. Plugins without it
// contribute 0 (treated as static). Active invariants whose plugin type is
// no longer registered are silently skipped here — `enforceInvariants`
// handles the warn/skip path at run time.
// ---------------------------------------------------------------------------

export interface InvariantEnforceEstimateResult {
  /** Total active invariants considered (across plugins). */
  activeCount: number
  /** Aggregate LLM calls predicted across all active invariants. */
  totalLlmCalls: number
  /** Rough total token estimate. */
  totalEstimatedTokens: number
  /** Per-plugin breakdown for the prompt's tier table. */
  perPlugin: Record<
    string,
    { activeCount: number; llmCalls: number; estimatedTokens: number }
  >
  /**
   * Absolute paths of all files invariant enforcement will read. Used by
   * `analyze-core` to dedupe against the rule pipeline's file set so the
   * displayed "files" count reflects the union, not the sum.
   */
  filePaths: string[]
}

/**
 * Step definitions for the analyze-progress tracker — one line per plugin
 * that has at least one active invariant in this repo. Drives the per-plugin
 * progress display. Returns [] when nothing is accepted.
 */
export function activeInvariantSteps(repoPath: string): { key: string; label: string }[] {
  const active = readAllActiveInvariants(repoPath)
  const counts = new Map<string, number>()
  for (const inv of active) counts.set(inv.type, (counts.get(inv.type) ?? 0) + 1)
  const out: { key: string; label: string }[] = []
  for (const type of counts.keys()) {
    const plugin = PLUGINS.find((p) => p.type === type)
    if (!plugin) continue
    out.push({
      key: `invariant:${type}`,
      label: `${plugin.metadata.name} checks`,
    })
  }
  return out
}

export function estimateInvariantEnforcement(
  repoPath: string,
  opts: { fileContents?: Map<string, string> } = {},
): InvariantEnforceEstimateResult {
  const active = readAllActiveInvariants(repoPath)
  const perPlugin: InvariantEnforceEstimateResult['perPlugin'] = {}
  let totalLlmCalls = 0
  let totalEstimatedTokens = 0

  const ctx: EstimateContext = { repoPath, fileContents: opts.fileContents }
  const filePathSet = new Set<string>()

  for (const inv of active) {
    const plugin = PLUGINS.find((p) => p.type === inv.type)
    if (!plugin) continue

    const bucket =
      perPlugin[inv.type] ??
      (perPlugin[inv.type] = { activeCount: 0, llmCalls: 0, estimatedTokens: 0 })
    bucket.activeCount++

    if (plugin.estimateEnforce) {
      const est = plugin.estimateEnforce(inv, ctx)
      bucket.llmCalls += est.llmCalls
      bucket.estimatedTokens += est.estimatedTokens
      totalLlmCalls += est.llmCalls
      totalEstimatedTokens += est.estimatedTokens
      if (est.filePaths) {
        for (const p of est.filePaths) filePathSet.add(p)
      }
    }
  }

  return {
    activeCount: active.length,
    totalLlmCalls,
    totalEstimatedTokens,
    perPlugin,
    filePaths: [...filePathSet],
  }
}
