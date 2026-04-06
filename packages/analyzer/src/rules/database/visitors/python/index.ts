import type { CodeRuleVisitor } from '../../../types.js'

import { pythonConnectionNotReleasedVisitor } from './connection-not-released.js'

export { pythonConnectionNotReleasedVisitor }

export const DATABASE_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonConnectionNotReleasedVisitor,
]
