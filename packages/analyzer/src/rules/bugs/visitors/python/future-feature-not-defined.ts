import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Valid __future__ feature names as of Python 3.x
const VALID_FUTURE_FEATURES = new Set([
  'nested_scopes',
  'generators',
  'division',
  'absolute_import',
  'with_statement',
  'print_function',
  'unicode_literals',
  'barry_as_FLUFL',
  'generator_stop',
  'annotations',
])

export const pythonFutureFeatureNotDefinedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/future-feature-not-defined',
  languages: ['python'],
  nodeTypes: ['future_import_statement'],
  visit(node, filePath, sourceCode) {
    // future_import_statement: from __future__ import name1, name2, ...
    // namedChildren are dotted_name nodes (the imported feature names)
    for (const imp of node.namedChildren) {
      const name = imp.type === 'aliased_import'
        ? imp.namedChildren[0]?.text
        : imp.text

      if (name && !VALID_FUTURE_FEATURES.has(name)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Future feature not defined',
          `\`from __future__ import ${name}\` — \`${name}\` is not a valid future feature name and will raise SyntaxError at runtime.`,
          sourceCode,
          `Remove \`from __future__ import ${name}\` or use a valid feature name.`,
        )
      }
    }

    return null
  },
}
