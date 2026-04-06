import type { CodeRuleVisitor } from '../../../types.js'

export { pythonDeclarationsInGlobalScopeVisitor } from './declarations-in-global-scope.js'

import { pythonDeclarationsInGlobalScopeVisitor } from './declarations-in-global-scope.js'

export const ARCHITECTURE_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonDeclarationsInGlobalScopeVisitor,
]
