import type { Tree } from 'tree-sitter'
import type { AnalysisRule, CodeViolation, SupportedLanguage } from '@truecourse/shared'
import { walkAstWithVisitors } from '../types.js'
import { RELIABILITY_JS_VISITORS } from './visitors/javascript/index.js'
import { RELIABILITY_PYTHON_VISITORS } from './visitors/python/index.js'
import type { CodeRuleVisitor } from '../types.js'

const ALL_RELIABILITY_VISITORS: CodeRuleVisitor[] = [
  ...RELIABILITY_JS_VISITORS,
  ...RELIABILITY_PYTHON_VISITORS,
]

/**
 * Check reliability domain code rules by walking the AST.
 */
export function checkReliabilityRules(
  tree: Tree,
  filePath: string,
  sourceCode: string,
  enabledRules: AnalysisRule[],
  language?: SupportedLanguage,
): CodeViolation[] {
  const enabledKeys = new Set(
    enabledRules
      .filter((r) => r.domain === 'reliability' && r.type === 'deterministic' && r.enabled)
      .map((r) => r.key),
  )

  if (enabledKeys.size === 0) return []

  return walkAstWithVisitors(tree, filePath, sourceCode, ALL_RELIABILITY_VISITORS, enabledKeys, language)
}
