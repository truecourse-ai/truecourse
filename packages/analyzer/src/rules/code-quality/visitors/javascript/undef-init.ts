import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const undefInitVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/undef-init',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['variable_declarator'],
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    if (!value) return null

    if (value.type === 'undefined' || (value.type === 'identifier' && value.text === 'undefined')) {
      // OK — this is undefined initialization
    } else {
      return null
    }

    const name = node.childForFieldName('name')

    // Check that the variable declaration uses let (not const — you can't do const x = undefined usefully)
    const parent = node.parent
    if (!parent) return null

    const kind = parent.children[0]
    if (!kind) return null
    if (kind.text !== 'let' && kind.text !== 'var') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Initializing to undefined: ${name?.text ?? 'var'}`,
      `Explicitly initializing \`${name?.text ?? 'variable'}\` to \`undefined\` is unnecessary — uninitialized variables are already \`undefined\`.`,
      sourceCode,
      `Remove the \`= undefined\` initializer.`,
    )
  },
}
