import type { CodeRuleVisitor } from '../../../types.js'

export { pythonDuplicateImportVisitor } from './duplicate-import.js'
export { pythonDeclarationsInGlobalScopeVisitor } from './declarations-in-global-scope.js'
export { pythonUnusedImportVisitor } from './unused-import.js'

import { pythonDuplicateImportVisitor } from './duplicate-import.js'
import { pythonDeclarationsInGlobalScopeVisitor } from './declarations-in-global-scope.js'
import { pythonUnusedImportVisitor } from './unused-import.js'

export const ARCHITECTURE_PYTHON_VISITORS: CodeRuleVisitor[] = [
  pythonDuplicateImportVisitor,
  pythonDeclarationsInGlobalScopeVisitor,
  pythonUnusedImportVisitor,
]
