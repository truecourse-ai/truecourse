import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const arrayConstructorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/array-constructor',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const ctor = node.childForFieldName('constructor')
    if (ctor?.text !== 'Array') return null

    const args = node.childForFieldName('arguments')
    const argList = args?.namedChildren ?? []

    if (argList.length !== 1) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Array constructor',
        '`new Array(...)` is ambiguous. Use array literal syntax `[...]` instead.',
        sourceCode,
        'Replace `new Array(...)` with `[...]`.',
      )
    }
    return null
  },
}
