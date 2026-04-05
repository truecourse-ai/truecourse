import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * RUF067: Detects non-empty __init__.py files.
 * __init__.py should contain only imports — code beyond that causes side effects
 * when the package is imported.
 */
export const pythonNonEmptyInitModuleVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/non-empty-init-module',
  languages: ['python'],
  nodeTypes: ['module'],
  visit(node, filePath, sourceCode) {
    // Only apply to __init__.py files
    if (!filePath.endsWith('__init__.py')) return null

    // Check if the module has any non-import, non-comment statements
    for (const child of node.namedChildren) {
      const t = child.type
      if (
        t === 'import_statement' ||
        t === 'import_from_statement' ||
        t === 'comment' ||
        t === 'expression_statement' && child.text.startsWith('"') || // docstring
        t === 'expression_statement' && child.text.startsWith("'")
      ) {
        continue
      }
      // Allow __all__ assignment
      if (t === 'assignment' || t === 'expression_statement') {
        const text = child.text.trim()
        if (text.startsWith('__all__') || text.startsWith('__version__') || text.startsWith('__author__')) {
          continue
        }
      }
      // Any other statement is non-trivial code
      if (
        t !== 'import_statement' &&
        t !== 'import_from_statement' &&
        t !== 'comment'
      ) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Non-empty __init__.py',
          '`__init__.py` contains code beyond imports. Package init files should be minimal to avoid side effects on import.',
          sourceCode,
          'Move business logic out of `__init__.py` into dedicated modules.',
        )
      }
    }

    return null
  },
}
