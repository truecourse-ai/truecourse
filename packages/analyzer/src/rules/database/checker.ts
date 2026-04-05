/**
 * Database domain checker — includes both deterministic AST visitors and
 * LLM-based rules evaluated server-side.
 */

import type { Tree } from 'tree-sitter'
import type { AnalysisRule, CodeViolation, SupportedLanguage } from '@truecourse/shared'
import { walkAstWithVisitors } from '../types.js'
import { DATABASE_JS_VISITORS } from './visitors/javascript.js'
import { DATABASE_PYTHON_VISITORS } from './visitors/python.js'
import type { CodeRuleVisitor } from '../types.js'

const ALL_DATABASE_VISITORS: CodeRuleVisitor[] = [
  ...DATABASE_JS_VISITORS,
  ...DATABASE_PYTHON_VISITORS,
]

/**
 * Check database domain code rules by walking the AST.
 */
export function checkDatabaseRules(
  tree: Tree,
  filePath: string,
  sourceCode: string,
  enabledRules: AnalysisRule[],
  language?: SupportedLanguage,
): CodeViolation[] {
  const enabledKeys = new Set(
    enabledRules
      .filter((r) => r.domain === 'database' && r.type === 'deterministic' && r.enabled)
      .map((r) => r.key),
  )

  if (enabledKeys.size === 0) return []

  return walkAstWithVisitors(tree, filePath, sourceCode, ALL_DATABASE_VISITORS, enabledKeys, language)
}
