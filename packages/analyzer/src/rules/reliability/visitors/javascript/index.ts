import type { CodeRuleVisitor } from '../../../types.js'

import { catchRethrowNoContextVisitor } from './catch-rethrow-no-context.js'

export { catchRethrowNoContextVisitor }

export const RELIABILITY_JS_VISITORS: CodeRuleVisitor[] = [
  catchRethrowNoContextVisitor,
]
