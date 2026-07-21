import fs from 'node:fs'
import type { AnalysisRule, CodeViolation } from '@truecourse/shared'
import { detectLanguage } from '../language-config.js'
import { withParsedTree } from '../parser.js'
import { checkCodeRules, hasTypeAwareVisitors, hasSchemaAwareVisitors } from '../rules/combined-code-checker.js'
import { buildScopedCompilerOptions, createTypeQueryService, type TypeQueryService } from '../ts-compiler.js'
import { buildSchemaIndex, type SchemaIndex } from '../services/schema-index.js'
import type { DeterministicScanInput } from './types.js'

/** ~25ms of CPU-bound work between event-loop yields — same headroom the old loop used. */
const YIELD_INTERVAL_MS = 25

export interface ScanCallbacks {
  /** After one-time setup (type program + schema index) is built, before the first file. */
  onSetupDone?(): void
  /** Before a file is processed. Drives the watchdog and identifies the in-flight file. */
  onFileStart?(index: number, filePath: string): void
  /** After a file's violations are computed. */
  onFileResult(index: number, filePath: string, violations: CodeViolation[]): void
  /** Checked between files — return true to stop early (cooperative cancellation). */
  shouldStop?(): boolean
}

/**
 * The core deterministic per-file scan, extracted so it can run either inside a
 * worker thread (the default, so a pathological file can be killed) or in-thread
 * as a fallback. It builds the whole-project TypeQuery / schema index once, then
 * walks each file's tree-sitter AST through the enabled visitors.
 *
 * It reports progress through `cb` rather than returning a big array so the
 * controller can stream results and enforce a per-file timeout. Callers must
 * have awaited {@link initParsers} before invoking this.
 */
export async function runDeterministicScan(input: DeterministicScanInput, cb: ScanCallbacks): Promise<void> {
  const { files, enabledRuleKeys, tsFiles, databaseResult, repoPath, startIndex } = input
  const keySet = new Set(enabledRuleKeys)

  // `checkCodeRules` only reads `key`/`type`/`enabled` off each rule to compute
  // the enabled-key set, so minimal stubs are sufficient (and fully serializable).
  const rules = enabledRuleKeys.map(
    (key) => ({ key, type: 'deterministic', enabled: true }) as unknown as AnalysisRule,
  )

  let typeQuery: TypeQueryService | undefined
  if (hasTypeAwareVisitors(keySet) && tsFiles.length > 0) {
    const scoped = buildScopedCompilerOptions(repoPath)
    typeQuery = createTypeQueryService(tsFiles, scoped, repoPath)
  }
  let schemaIndex: SchemaIndex | undefined
  if (hasSchemaAwareVisitors(keySet)) {
    schemaIndex = buildSchemaIndex(databaseResult)
  }

  // Setup (the expensive, message-silent phase) is done — let the controller
  // retire its setup watchdog and switch to per-file budgets.
  cb.onSetupDone?.()

  let lastYield = Date.now()
  for (let i = startIndex; i < files.length; i++) {
    if (cb.shouldStop?.()) return

    const { filePath, absPath } = files[i]
    cb.onFileStart?.(i, filePath)

    let violations: CodeViolation[] = []
    try {
      const lang = detectLanguage(filePath)
      if (lang) {
        const content = fs.readFileSync(absPath, 'utf-8')
        violations = withParsedTree(filePath, content, lang, (tree) =>
          checkCodeRules(tree, filePath, content, rules, lang, typeQuery, schemaIndex),
        )
      }
    } catch {
      // Skip files that fail to read or parse — matches the prior loop's behavior.
    }
    cb.onFileResult(i, filePath, violations)

    // Yield periodically so message delivery flushes and (in the fallback) the
    // spinner keeps ticking. Cheap and bounded.
    const now = Date.now()
    if (now - lastYield >= YIELD_INTERVAL_MS) {
      await new Promise((r) => setImmediate(r))
      lastYield = now
    }
  }
}
