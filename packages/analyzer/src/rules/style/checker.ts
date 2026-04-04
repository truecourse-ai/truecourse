import type { Tree } from 'tree-sitter'
import type { AnalysisRule, CodeViolation, SupportedLanguage } from '@truecourse/shared'
import { walkAstWithVisitors } from '../types.js'

const STYLE_VISITORS: import('../types.js').CodeRuleVisitor[] = [
  // Visitors will be added as rules are implemented
]

export function checkStyleRules(
  tree: Tree,
  filePath: string,
  sourceCode: string,
  enabledRules: AnalysisRule[],
  language?: SupportedLanguage,
): CodeViolation[] {
  const enabledKeys = new Set(
    enabledRules
      .filter((r) => r.type === 'deterministic' && r.enabled && r.key.startsWith('style/'))
      .map((r) => r.key),
  )
  if (enabledKeys.size === 0) return []
  return walkAstWithVisitors(tree, filePath, sourceCode, STYLE_VISITORS, enabledKeys, language)
}
