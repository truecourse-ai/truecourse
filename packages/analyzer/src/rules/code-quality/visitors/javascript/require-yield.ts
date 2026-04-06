import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody } from './_helpers.js'
import type { SyntaxNode } from 'tree-sitter'

export const requireYieldVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/require-yield',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['generator_function', 'generator_function_declaration'],
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node) ?? node.namedChildren.find((c) => c.type === 'statement_block')
    if (!bodyNode) return null

    let hasYield = false

    function walk(n: SyntaxNode) {
      if (hasYield) return
      if (n.type === 'yield_expression') {
        hasYield = true
        return
      }
      if ((n.type === 'generator_function' || n.type === 'generator_function_declaration') && n !== node) return
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (!hasYield) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Generator without yield',
        `Generator function \`${name}\` never uses \`yield\`. Either add \`yield\` or remove the \`*\` to make it a regular function.`,
        sourceCode,
        'Add a `yield` expression, or remove the `*` to make this a regular function.',
      )
    }
    return null
  },
}
