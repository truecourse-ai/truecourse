import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const contradictoryOptionalChainVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/contradictory-optional-chain',
  languages: JS_LANGUAGES,
  nodeTypes: ['non_null_expression'],
  visit(node, filePath, sourceCode) {
    // A non_null_expression is the TypeScript `!` postfix operator
    // Check if the inner expression contains an optional chain (?.)
    const inner = node.namedChildren[0]
    if (!inner) return null

    function containsOptionalChain(n: SyntaxNode): boolean {
      if (n.children.some((c) => c.text === '?.')) return true
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && containsOptionalChain(child)) return true
      }
      return false
    }

    if (containsOptionalChain(inner)) {
      // Skip when on the right side of && — the left side acts as a null guard
      let parent = node.parent
      while (parent) {
        if (parent.type === 'binary_expression' && parent.children.some((c) => c.text === '&&')) {
          const right = parent.childForFieldName('right')
          // Check if the non_null_expression is structurally within the right operand
          if (right) {
            let n: import('tree-sitter').SyntaxNode | null = node
            while (n && n !== parent) {
              if (n === right) return null
              n = n.parent
            }
          }
        }
        parent = parent.parent
      }
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Non-null assertion after optional chain',
        `\`${node.text}\` uses \`!\` non-null assertion after optional chaining — if the chain short-circuits to \`undefined\`, the assertion is contradicted.`,
        sourceCode,
        'Remove the `!` and handle the undefined case, or remove the optional chaining if the value is guaranteed non-null.',
      )
    }
    return null
  },
}
