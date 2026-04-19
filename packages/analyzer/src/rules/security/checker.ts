import type { Tree } from 'web-tree-sitter'
import type { AnalysisRule, CodeViolation, SupportedLanguage } from '@truecourse/shared'
import { walkAstWithVisitors } from '../types.js'
import { SECURITY_JS_VISITORS } from './visitors/javascript/index.js'
import { SECURITY_PYTHON_VISITORS } from './visitors/python/index.js'
import { SECURITY_UNIVERSAL_VISITORS } from './visitors/universal.js'
import type { CodeRuleVisitor } from '../types.js'

const ALL_SECURITY_VISITORS: CodeRuleVisitor[] = [
  ...SECURITY_JS_VISITORS,
  ...SECURITY_PYTHON_VISITORS,
  ...SECURITY_UNIVERSAL_VISITORS,
]

/**
 * Check security domain code rules by walking the AST.
 */
export function checkSecurityRules(
  tree: Tree,
  filePath: string,
  sourceCode: string,
  enabledRules: AnalysisRule[],
  language?: SupportedLanguage,
): CodeViolation[] {
  const enabledKeys = new Set(
    enabledRules
      .filter((r) => r.domain === 'security' && r.type === 'deterministic' && r.enabled)
      .map((r) => r.key),
  )

  if (enabledKeys.size === 0) return []

  return walkAstWithVisitors(tree, filePath, sourceCode, ALL_SECURITY_VISITORS, enabledKeys, language)
}
