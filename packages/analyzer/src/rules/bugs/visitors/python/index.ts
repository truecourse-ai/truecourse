import type { CodeRuleVisitor } from '../../../types.js'

import { pythonAllBranchesIdenticalVisitor } from './all-branches-identical.js'

export { pythonAllBranchesIdenticalVisitor }

export const BUGS_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonAllBranchesIdenticalVisitor,
]
