import type { Tree } from 'tree-sitter'
import type { AnalysisRule, CodeViolation, SupportedLanguage } from '@truecourse/shared'
import { walkAstWithVisitors, type CodeRuleVisitor } from './types.js'

// Import all domain visitors
import { SECURITY_JS_VISITORS } from './security/visitors/javascript.js'
import { SECURITY_PYTHON_VISITORS } from './security/visitors/python.js'
import { SECURITY_UNIVERSAL_VISITORS } from './security/visitors/universal.js'
import { BUGS_JS_VISITORS } from './bugs/visitors/javascript.js'
import { BUGS_PYTHON_VISITORS } from './bugs/visitors/python.js'
import { CODE_QUALITY_JS_VISITORS } from './code-quality/visitors/javascript.js'
import { CODE_QUALITY_PYTHON_VISITORS } from './code-quality/visitors/python.js'
import { CODE_QUALITY_UNIVERSAL_VISITORS } from './code-quality/visitors/universal.js'
import { PERFORMANCE_JS_VISITORS } from './performance/visitors/javascript.js'
import { PERFORMANCE_PYTHON_VISITORS } from './performance/visitors/python.js'
import { RELIABILITY_JS_VISITORS } from './reliability/visitors/javascript.js'
import { RELIABILITY_PYTHON_VISITORS } from './reliability/visitors/python.js'
import { STYLE_JS_VISITORS } from './style/visitors/javascript.js'
import { STYLE_PYTHON_VISITORS } from './style/visitors/python.js'
import { ARCHITECTURE_JS_VISITORS } from './architecture/visitors/javascript.js'
import { ARCHITECTURE_PYTHON_VISITORS } from './architecture/visitors/python.js'
import { DATABASE_JS_VISITORS } from './database/visitors/javascript.js'
import { DATABASE_PYTHON_VISITORS } from './database/visitors/python.js'

const ALL_CODE_VISITORS: CodeRuleVisitor[] = [
  ...SECURITY_JS_VISITORS,
  ...SECURITY_PYTHON_VISITORS,
  ...SECURITY_UNIVERSAL_VISITORS,
  ...BUGS_JS_VISITORS,
  ...BUGS_PYTHON_VISITORS,
  ...CODE_QUALITY_JS_VISITORS,
  ...CODE_QUALITY_PYTHON_VISITORS,
  ...CODE_QUALITY_UNIVERSAL_VISITORS,
  ...PERFORMANCE_JS_VISITORS,
  ...PERFORMANCE_PYTHON_VISITORS,
  ...RELIABILITY_JS_VISITORS,
  ...RELIABILITY_PYTHON_VISITORS,
  ...STYLE_JS_VISITORS,
  ...STYLE_PYTHON_VISITORS,
  ...ARCHITECTURE_JS_VISITORS,
  ...ARCHITECTURE_PYTHON_VISITORS,
  ...DATABASE_JS_VISITORS,
  ...DATABASE_PYTHON_VISITORS,
]

/**
 * Check all code-level rules by walking the AST and firing matching visitors.
 * This is a combined checker that runs security, bugs, and code-quality domain
 * visitors in a single AST pass for efficiency.
 *
 * Drop-in replacement for the old checkCodeRules function.
 */
export function checkCodeRules(
  tree: Tree,
  filePath: string,
  sourceCode: string,
  enabledRules: AnalysisRule[],
  language?: SupportedLanguage,
): CodeViolation[] {
  const enabledKeys = new Set(
    enabledRules
      .filter((r) => r.type === 'deterministic' && r.enabled)
      .map((r) => r.key),
  )

  if (enabledKeys.size === 0) return []

  return walkAstWithVisitors(tree, filePath, sourceCode, ALL_CODE_VISITORS, enabledKeys, language)
}
