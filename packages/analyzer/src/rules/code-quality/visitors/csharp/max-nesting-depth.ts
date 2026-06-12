import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isCSharpFunctionBoundary } from './_helpers.js'

const MAX_DEPTH = 4

// `using` and `lock` statements are idiomatic resource scoping, not logic
// nesting — they are deliberately excluded.
const NESTING_TYPES = new Set([
  'if_statement', 'for_statement', 'foreach_statement', 'while_statement',
  'do_statement', 'try_statement', 'switch_statement',
])

function getNestingDepth(node: SyntaxNode): number {
  let depth = 0
  let prev: SyntaxNode = node
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (NESTING_TYPES.has(current.type)) {
      // An `else if` chain stays at the SAME level — don't count the parent
      // if when we arrived through its alternative as another if.
      const isElseIfLink = current.type === 'if_statement'
        && prev.type === 'if_statement'
        && current.childForFieldName('alternative')?.id === prev.id
      if (!isElseIfLink) depth++
    }
    if (isCSharpFunctionBoundary(current.type)) break
    prev = current
    current = current.parent
  }
  return depth
}

export const csharpMaxNestingDepthVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/max-nesting-depth',
  languages: ['csharp'],
  nodeTypes: ['if_statement', 'for_statement', 'foreach_statement', 'while_statement', 'do_statement'],
  visit(node, filePath, sourceCode) {
    // An `else if` is not deeper nesting of its own.
    const parent = node.parent
    if (parent?.type === 'if_statement' && parent.childForFieldName('alternative')?.id === node.id) return null

    const depth = getNestingDepth(node)
    if (depth < MAX_DEPTH) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Block nested ${depth + 1} levels deep`,
      `Block is nested ${depth + 1} levels deep — maximum is ${MAX_DEPTH}. Extract logic into helper methods.`,
      sourceCode,
      'Extract the deeply nested code into a named method.',
    )
  },
}
