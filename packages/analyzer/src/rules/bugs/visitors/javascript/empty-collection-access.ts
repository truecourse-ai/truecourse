import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const emptyCollectionAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-collection-access',
  languages: JS_LANGUAGES,
  nodeTypes: ['subscript_expression'],
  visit(node, filePath, sourceCode) {
    const obj = node.childForFieldName('object')
    if (!obj) return null

    // Flag [][index]
    if (obj.type === 'array' && obj.namedChildren.length === 0) {
      const index = node.childForFieldName('index')
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Empty collection access',
        `Accessing index \`${index?.text ?? '?'}\` on an empty array literal always returns \`undefined\`.`,
        sourceCode,
        'Check that you are accessing the correct array, or initialize it with elements first.',
      )
    }

    return null
  },
}
