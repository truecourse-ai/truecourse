import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_METHODLIKE_TYPES, getCSharpFunctionName, isCSharpFunctionBoundary } from './_helpers.js'

const MAX_NESTING = 5

const NESTING_TYPES = new Set([
  'if_statement', 'for_statement', 'foreach_statement', 'while_statement',
  'do_statement', 'switch_statement', 'try_statement', 'catch_clause',
  'using_statement', 'lock_statement', 'fixed_statement',
])

function maxNestingDepth(node: SyntaxNode, root: SyntaxNode, currentDepth: number): number {
  let maxDepth = currentDepth
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    // Lambdas / local functions / nested types own their nesting budget.
    if (isCSharpFunctionBoundary(child.type) && child.id !== root.id) continue
    if (child.type === 'class_declaration' || child.type === 'struct_declaration'
      || child.type === 'record_declaration') continue

    const childDepth = NESTING_TYPES.has(child.type) ? currentDepth + 1 : currentDepth
    const childMax = maxNestingDepth(child, root, childDepth)
    if (childMax > maxDepth) maxDepth = childMax
  }
  return maxDepth
}

export const csharpTooManyNestedBlocksVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-nested-blocks',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'block') return null

    const depth = maxNestingDepth(body, node, 0)
    if (depth <= MAX_NESTING) return null

    const name = getCSharpFunctionName(node)
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Too many nested blocks',
      `Method \`${name}\` has ${depth} levels of nesting (threshold: ${MAX_NESTING}). Deep nesting makes code hard to read and test.`,
      sourceCode,
      'Use early returns (guard clauses) to reduce nesting, or extract nested logic into helper methods.',
    )
  },
}
