import {
  PLUGINS,
  discoverFiles,
  analyzeFile,
  initParsers,
  type EnforceContext,
} from '@truecourse/analyzer'
import type { FileAnalysis, Invariant, Violation } from '@truecourse/shared'
import { readAllActiveInvariants } from '../../lib/invariant-store.js'
import { log } from '../../lib/logger.js'
import type { LLMProvider } from '../llm/provider.js'
import { createLLMRunner } from './llm-adapter.js'

// ---------------------------------------------------------------------------
// Public entry — runs invariant enforcement; called from the analyze pipeline
// ---------------------------------------------------------------------------

export type InvariantEnforceEvent =
  | { kind: 'plugin-start'; pluginType: string; activeCount: number }
  | {
      kind: 'plugin-progress'
      pluginType: string
      /** done: number of invariants that have completed enforce (i.e. settled). */
      done: number
      /** running: number of invariants currently in-flight (always ≤ 1 today
       *  since enforce runs sequentially per plugin; reserved for parallel
       *  enforce in a future iteration). */
      running: number
      total: number
      elapsedMs: number
    }
  | { kind: 'plugin-done'; pluginType: string; violations: number; durationMs: number }
  | { kind: 'plugin-failed'; pluginType: string; error: string }

export async function enforceInvariants(opts: {
  repoPath: string
  /**
   * LLM provider. Optional — when undefined (user opted out of LLM checks),
   * plugins that need LLM enforcement skip themselves; static plugins still run.
   */
  llm?: LLMProvider
  /** Pre-analyzed files; if omitted, the pipeline analyzes them itself. */
  files?: FileAnalysis[]
  /**
   * Per-plugin progress hook. Fires once per plugin with active invariants
   * in this repo: `plugin-start` → optional `plugin-progress` → `plugin-done`
   * (or `plugin-failed`). Unknown plugin types and schema-invalid invariants
   * are surfaced via logs only — no event.
   */
  onProgress?: (event: InvariantEnforceEvent) => void
}): Promise<{ violations: Violation[]; pluginsRun: string[]; pluginsSkipped: string[] }> {
  const { repoPath, llm, onProgress } = opts
  const files = opts.files ?? (await analyzeAllFiles(repoPath))
  const active = readAllActiveInvariants(repoPath)
  if (active.length === 0) {
    return { violations: [], pluginsRun: [], pluginsSkipped: [] }
  }

  // Group active invariants by plugin type so we can emit per-plugin progress.
  const byPluginType = new Map<string, Invariant[]>()
  for (const inv of active) {
    const list = byPluginType.get(inv.type) ?? []
    list.push(inv)
    byPluginType.set(inv.type, list)
  }

  const runner = llm ? createLLMRunner(llm) : undefined
  const ctx: EnforceContext = { repoPath, files, llm: runner }
  const out: Violation[] = []
  const pluginsRun = new Set<string>()
  const pluginsSkipped = new Set<string>()

  for (const [pluginType, invariants] of byPluginType) {
    const plugin = PLUGINS.find((p) => p.type === pluginType)
    if (!plugin) {
      log.warn(`[invariants] no plugin for type "${pluginType}" — skipping ${invariants.length} invariant(s)`)
      pluginsSkipped.add(pluginType)
      continue
    }

    onProgress?.({ kind: 'plugin-start', pluginType, activeCount: invariants.length })
    const startedAt = Date.now()
    let pluginViolationCount = 0
    let enforcedAny = false
    let throwFailed = false

    for (let i = 0; i < invariants.length; i++) {
      const inv = invariants[i]
      const validated = validateAgainstPlugin(inv, plugin)
      if (!validated) {
        // Schema validation failure — plugin can't process this invariant.
        // Mark plugin as skipped (matches the legacy single-loop semantics)
        // but continue with remaining invariants for the same plugin.
        pluginsSkipped.add(pluginType)
        continue
      }

      // Emit pre-call progress (running goes up by 1) so the tracker can
      // refresh elapsed time before the LLM call resolves. Mirrors how the
      // rule pipeline's createLlmTracker emits onCallStart + onCallDone.
      onProgress?.({
        kind: 'plugin-progress',
        pluginType,
        done: i,
        running: 1,
        total: invariants.length,
        elapsedMs: Date.now() - startedAt,
      })

      try {
        const violations = await plugin.enforce(validated, ctx)
        for (const v of violations) {
          out.push({
            ...v,
            type: 'invariant',
            invariantId: v.invariantId ?? inv.id,
          })
          pluginViolationCount++
        }
        enforcedAny = true
      } catch (err) {
        log.error(
          `[invariants] plugin ${plugin.type} enforce failed for ${inv.id}: ${(err as Error).message}`,
        )
        throwFailed = true
        onProgress?.({
          kind: 'plugin-failed',
          pluginType,
          error: (err as Error).message,
        })
      }

      // Post-call progress (running back to 0, done +1).
      onProgress?.({
        kind: 'plugin-progress',
        pluginType,
        done: i + 1,
        running: 0,
        total: invariants.length,
        elapsedMs: Date.now() - startedAt,
      })
    }

    if (throwFailed) {
      pluginsSkipped.add(pluginType)
    }
    if (enforcedAny) {
      pluginsRun.add(pluginType)
      onProgress?.({
        kind: 'plugin-done',
        pluginType,
        violations: pluginViolationCount,
        durationMs: Date.now() - startedAt,
      })
    }
  }

  return {
    violations: out,
    pluginsRun: [...pluginsRun],
    pluginsSkipped: [...pluginsSkipped],
  }
}

// ---------------------------------------------------------------------------
// Per-plugin schema validation
// ---------------------------------------------------------------------------

type PluginLike = {
  type: string
  version: number
  declarationSchema: { safeParse: (input: unknown) => { success: boolean; data?: unknown; error?: unknown } }
  migrate?: (raw: unknown, fromVersion: number) => Invariant['declaration']
}

function validateAgainstPlugin(inv: Invariant, plugin: PluginLike): Invariant | null {
  let declaration: unknown = inv.declaration
  if (inv.pluginVersion !== plugin.version) {
    if (!plugin.migrate) {
      log.warn(
        `[invariants] ${inv.id}: plugin ${plugin.type} version ${plugin.version} can't read v${inv.pluginVersion} (no migration); skipping`,
      )
      return null
    }
    try {
      declaration = plugin.migrate(inv.declaration, inv.pluginVersion)
    } catch (err) {
      log.warn(`[invariants] ${inv.id}: migration failed: ${(err as Error).message}`)
      return null
    }
  }

  const parsed = plugin.declarationSchema.safeParse(declaration)
  if (!parsed.success) {
    log.warn(`[invariants] ${inv.id}: declaration failed schema validation; skipping`)
    return null
  }

  return { ...inv, declaration: parsed.data }
}

// ---------------------------------------------------------------------------
// Helper — analyze all files when caller didn't pre-analyze
// ---------------------------------------------------------------------------

async function analyzeAllFiles(repoPath: string): Promise<FileAnalysis[]> {
  // Same parser bootstrap as suggest's analyzeAllFiles. Idempotent.
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
