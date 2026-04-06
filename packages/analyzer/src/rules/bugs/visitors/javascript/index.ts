import type { CodeRuleVisitor } from '../../../types.js'

import { allBranchesIdenticalVisitor } from './all-branches-identical.js'

export { allBranchesIdenticalVisitor }

export const BUGS_JS_VISITORS: CodeRuleVisitor[] = [
  allBranchesIdenticalVisitor,
]
