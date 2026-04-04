import type { Tree } from 'tree-sitter'
import type { AnalysisRule, CodeViolation, SupportedLanguage } from '@truecourse/shared'
import { walkAstWithVisitors } from '../types.js'
import { BUGS_JS_VISITORS } from './visitors/javascript.js'
import { BUGS_PYTHON_VISITORS } from './visitors/python.js'
import type { CodeRuleVisitor } from '../types.js'

const ALL_BUGS_VISITORS: CodeRuleVisitor[] = [
  ...BUGS_JS_VISITORS,
  ...BUGS_PYTHON_VISITORS,
]

/**
 * Check bugs domain code rules by walking the AST.
 */
export function checkBugsRules(
  tree: Tree,
  filePath: string,
  sourceCode: string,
  enabledRules: AnalysisRule[],
  language?: SupportedLanguage,
): CodeViolation[] {
  const enabledKeys = new Set(
    enabledRules
      .filter((r) => r.domain === 'bugs' && r.type === 'deterministic' && r.enabled)
      .map((r) => r.key),
  )

  if (enabledKeys.size === 0) return []

  return walkAstWithVisitors(tree, filePath, sourceCode, ALL_BUGS_VISITORS, enabledKeys, language)
}
