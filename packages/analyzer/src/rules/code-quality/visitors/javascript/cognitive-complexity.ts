import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'
import type { SyntaxNode } from 'tree-sitter'

export const cognitiveComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/cognitive-complexity',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    let complexity = 0
    const NESTING_TYPES = new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_statement', 'catch_clause', 'ternary_expression'])
    const INCREMENT_TYPES = new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_statement', 'catch_clause', 'ternary_expression'])

    function walk(n: SyntaxNode, nesting: number) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) return

      if (INCREMENT_TYPES.has(n.type)) {
        complexity += 1 + nesting
      }
      if (n.type === 'else_clause') {
        complexity += 1
      }
      if (n.type === 'binary_expression') {
        const op = n.children.find((c) => c.type === '&&' || c.type === '||')
        if (op) complexity += 1
      }

      const nextNesting = NESTING_TYPES.has(n.type) ? nesting + 1 : nesting
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child, nextNesting)
      }
    }

    walk(bodyNode, 0)

    if (complexity > 15) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'High cognitive complexity',
        `Function \`${name}\` has cognitive complexity ${complexity} (max 15). Simplify by extracting helper functions or reducing nesting.`,
        sourceCode,
        'Break the function into smaller, focused helper functions.',
      )
    }
    return null
  },
}
