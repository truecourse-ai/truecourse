import type { CodeRuleVisitor } from '../../../types.js'

export { csharpDuplicateImportVisitor } from './duplicate-import.js'
export { csharpDeclarationsInGlobalScopeVisitor } from './declarations-in-global-scope.js'
export { csharpUnusedImportVisitor } from './unused-import.js'

import { csharpDuplicateImportVisitor } from './duplicate-import.js'
import { csharpDeclarationsInGlobalScopeVisitor } from './declarations-in-global-scope.js'
import { csharpUnusedImportVisitor } from './unused-import.js'

export const ARCHITECTURE_CSHARP_VISITORS: CodeRuleVisitor[] = [
  csharpDuplicateImportVisitor,
  csharpDeclarationsInGlobalScopeVisitor,
  csharpUnusedImportVisitor,
]
