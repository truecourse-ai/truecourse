import type { Tree } from 'tree-sitter'
import type { AnalysisRule, CodeViolation, SupportedLanguage } from '@truecourse/shared'
import { walkAstWithVisitors } from '../types.js'
import { CODE_QUALITY_JS_VISITORS } from './visitors/javascript.js'
import { CODE_QUALITY_PYTHON_VISITORS } from './visitors/python.js'
import { CODE_QUALITY_UNIVERSAL_VISITORS } from './visitors/universal.js'
import type { CodeRuleVisitor } from '../types.js'

const ALL_CODE_QUALITY_VISITORS: CodeRuleVisitor[] = [
  ...CODE_QUALITY_JS_VISITORS,
  ...CODE_QUALITY_PYTHON_VISITORS,
  ...CODE_QUALITY_UNIVERSAL_VISITORS,
]

/**
 * Check code-quality domain code rules by walking the AST.
 */
export function checkCodeQualityRules(
  tree: Tree,
  filePath: string,
  sourceCode: string,
  enabledRules: AnalysisRule[],
  language?: SupportedLanguage,
): CodeViolation[] {
  const enabledKeys = new Set(
    enabledRules
      .filter((r) => r.domain === 'code-quality' && r.type === 'deterministic' && r.enabled)
      .map((r) => r.key),
  )

  if (enabledKeys.size === 0) return []

  return walkAstWithVisitors(tree, filePath, sourceCode, ALL_CODE_QUALITY_VISITORS, enabledKeys, language)
}
