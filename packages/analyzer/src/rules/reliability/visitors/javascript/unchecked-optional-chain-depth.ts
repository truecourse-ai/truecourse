import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const uncheckedOptionalChainDepthVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unchecked-optional-chain-depth',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['member_expression'],
  visit(node, filePath, sourceCode) {
    // Count consecutive optional chains: a?.b?.c?.d?.e
    // Only flag the outermost one to avoid duplicate reports
    const parent = node.parent
    if (parent?.type === 'member_expression' && parent.text.includes('?.')) return null

    let depth = 0
    let current: SyntaxNode | null = node
    while (current) {
      if (current.type === 'member_expression' && current.text.includes('?.')) {
        // Check if this specific member_expression uses ?.
        const nodeText = current.text
        const objChild = current.childForFieldName('object')
        if (objChild) {
          const after = nodeText.substring(objChild.text.length)
          if (after.startsWith('?.')) {
            depth++
          }
        }
      }
      // Walk down to the object (left side)
      if (current.type === 'member_expression') {
        current = current.childForFieldName('object')
      } else {
        break
      }
    }

    if (depth > 3) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Deep optional chaining',
        `Optional chaining ${depth} levels deep suggests missing data validation or overly nested data structures.`,
        sourceCode,
        'Validate the data shape upfront (e.g., with a Zod schema) instead of relying on deep optional chaining.',
      )
    }

    return null
  },
}
