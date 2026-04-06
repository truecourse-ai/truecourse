import type { CodeRuleVisitor } from '../../../types.js'

import { pythonAsyncWithForResourcesVisitor } from './async-with-for-resources.js'

export { pythonAsyncWithForResourcesVisitor }

export const RELIABILITY_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonAsyncWithForResourcesVisitor,
]
