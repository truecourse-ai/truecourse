import type { CodeRuleVisitor } from '../../../types.js'

import { angularSanitizationBypassVisitor } from './angular-sanitization-bypass.js'

export { angularSanitizationBypassVisitor }

export const SECURITY_JS_VISITORS: CodeRuleVisitor[] = [
  angularSanitizationBypassVisitor,
]
