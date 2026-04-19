import type { Tree } from 'web-tree-sitter'
import type { AnalysisRule, CodeViolation, SupportedLanguage } from '@truecourse/shared'
import { walkAstWithVisitors } from '../types.js'
import { STYLE_JS_VISITORS } from './visitors/javascript/index.js'
import { STYLE_PYTHON_VISITORS } from './visitors/python/index.js'

const STYLE_VISITORS = [
  ...STYLE_JS_VISITORS,
  ...STYLE_PYTHON_VISITORS,
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
