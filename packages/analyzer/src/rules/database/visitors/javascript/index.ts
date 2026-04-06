import type { CodeRuleVisitor } from '../../../types.js'

import { connectionNotReleasedVisitor } from './connection-not-released.js'

export { connectionNotReleasedVisitor }

export const DATABASE_JS_VISITORS: CodeRuleVisitor[] = [
  connectionNotReleasedVisitor,
]
