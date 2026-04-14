import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonImportOutsideTopLevelVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/import-outside-top-level',
  languages: ['python'],
  nodeTypes: ['import_statement', 'import_from_statement'],
  visit(node, filePath, sourceCode) {
    // An import is "outside top level" if any ancestor is a function/class/if/for/while/try
    const blockingTypes = new Set([
      'function_definition', 'async_function_definition', 'class_definition',
      'if_statement', 'elif_clause', 'else_clause',
      'for_statement', 'while_statement', 'try_statement',
      'with_statement', 'match_statement',
    ])

    let parent = node.parent
    while (parent) {
      if (blockingTypes.has(parent.type)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Import outside top level',
          'Import statement inside a function or conditional block should be at module top level.',
          sourceCode,
          'Move the import to the top of the module.',
        )
      }
      parent = parent.parent
    }
    return null
  },
}
