import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getFunctionBody } from './_helpers.js'

export const jsNoEmptyFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-empty-function',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode || bodyNode.type !== 'statement_block') return null

    if (bodyNode.namedChildren.length > 0) return null

    for (let i = 0; i < bodyNode.childCount; i++) {
      const child = bodyNode.child(i)
      if (child && child.type === 'comment') return null
    }

    // Skip empty functions inside .catch() — intentional no-op error suppression
    const parent = node.parent
    if (parent?.type === 'arguments') {
      const grandparent = parent.parent
      if (grandparent?.type === 'call_expression') {
        const gpFn = grandparent.childForFieldName('function')
        if (gpFn?.type === 'member_expression') {
          const gpProp = gpFn.childForFieldName('property')
          if (gpProp?.text === 'catch') return null
        }
      }
    }

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'anonymous'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Empty function body',
      `Function \`${name}\` has an empty body. Add an implementation or a comment explaining why it's empty.`,
      sourceCode,
      'Add an implementation, throw a "not implemented" error, or add a comment explaining why the body is empty.',
    )
  },
}
