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

    // Check if the module has any non-trivial statements.
    // Legitimate __init__.py content: imports, re-exports, __all__, docstrings,
    // class/function definitions (public API), type aliases, and decorators.
    for (const child of node.namedChildren) {
      const t = child.type

      // Always allowed: imports, comments
      if (
        t === 'import_statement' ||
        t === 'import_from_statement' ||
        t === 'comment'
      ) {
        continue
      }

      // Docstrings (string expression statements)
      if (t === 'expression_statement') {
        const inner = child.namedChildren[0]
        if (inner?.type === 'string') continue

        // __all__, __version__, __author__ assignments
        const text = child.text.trim()
        if (text.startsWith('__all__') || text.startsWith('__version__') || text.startsWith('__author__')) {
          continue
        }
      }

      // Class and function definitions — standard public API pattern
      if (
        t === 'class_definition' ||
        t === 'function_definition' ||
        t === 'decorated_definition'
      ) {
        continue
      }

      // Top-level assignments for __all__, __version__, __author__, type aliases
      if (t === 'assignment') {
        const left = child.childForFieldName('left')
        const text = left?.text ?? ''
        if (text.startsWith('__all__') || text.startsWith('__version__') || text.startsWith('__author__')) {
          continue
        }
      }

      // Type alias statements (Python 3.12+)
      if (t === 'type_alias_statement') {
        continue
      }

      // If-statement guards (e.g. `if TYPE_CHECKING:`) are common in __init__.py
      if (t === 'if_statement') {
        continue
      }

      // Any other statement is non-trivial code
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Non-empty __init__.py',
        '`__init__.py` contains code beyond imports and definitions. Package init files should be minimal to avoid side effects on import.',
        sourceCode,
        'Move business logic out of `__init__.py` into dedicated modules.',
      )
    }

    return null
  },
}
