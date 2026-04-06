import type { CodeRuleVisitor } from '../../../types.js'

import { batchWritesInLoopVisitor } from './batch-writes-in-loop.js'

export { batchWritesInLoopVisitor }

export const PERFORMANCE_PYTHON_VISITORS: CodeRuleVisitor[] = [
  batchWritesInLoopVisitor,
]
