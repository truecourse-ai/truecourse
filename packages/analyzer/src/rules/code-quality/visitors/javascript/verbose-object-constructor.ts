import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const verboseObjectConstructorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/verbose-object-constructor',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const ctor = node.childForFieldName('constructor')
    if (!ctor || ctor.text !== 'Object') return null
    const args = node.childForFieldName('arguments')
    if (args && args.namedChildCount > 0) return null
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Verbose object constructor',
      '`new Object()` should be replaced with the object literal `{}`.',
      sourceCode,
      'Replace `new Object()` with `{}`.',
    )
  },
}
