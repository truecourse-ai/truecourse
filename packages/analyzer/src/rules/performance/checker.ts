import type { Tree } from 'web-tree-sitter'
import type { AnalysisRule, CodeViolation, SupportedLanguage } from '@truecourse/shared'
import { walkAstWithVisitors } from '../types.js'
import { PERFORMANCE_JS_VISITORS } from './visitors/javascript/index.js'
import { PERFORMANCE_PYTHON_VISITORS } from './visitors/python/index.js'
import type { CodeRuleVisitor } from '../types.js'

const ALL_PERFORMANCE_VISITORS: CodeRuleVisitor[] = [
  ...PERFORMANCE_JS_VISITORS,
  ...PERFORMANCE_PYTHON_VISITORS,
]

/**
 * Check performance domain code rules by walking the AST.
 */
export function checkPerformanceRules(
  tree: Tree,
  filePath: string,
  sourceCode: string,
  enabledRules: AnalysisRule[],
  language?: SupportedLanguage,
): CodeViolation[] {
  const enabledKeys = new Set(
    enabledRules
      .filter((r) => r.domain === 'performance' && r.type === 'deterministic' && r.enabled)
      .map((r) => r.key),
  )

  if (enabledKeys.size === 0) return []

  return walkAstWithVisitors(tree, filePath, sourceCode, ALL_PERFORMANCE_VISITORS, enabledKeys, language)
}
