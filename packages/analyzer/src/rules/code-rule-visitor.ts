/**
 * Code rule visitor registry — assembles visitors from all language files.
 *
 * To add visitors for a new language:
 * 1. Create code-visitors/{language}.ts
 * 2. Export a {LANGUAGE}_VISITORS array
 * 3. Import and spread it into ALL_CODE_VISITORS below
 */

export type { CodeRuleVisitor } from './code-visitors/common.js'
export { makeViolation } from './code-visitors/common.js'

import { JS_VISITORS } from './code-visitors/javascript.js'
import { PYTHON_VISITORS } from './code-visitors/python.js'
import { UNIVERSAL_VISITORS } from './code-visitors/universal.js'
import type { CodeRuleVisitor } from './code-visitors/common.js'

export const ALL_CODE_VISITORS: CodeRuleVisitor[] = [
  ...JS_VISITORS,
  ...PYTHON_VISITORS,
  ...UNIVERSAL_VISITORS,
]
