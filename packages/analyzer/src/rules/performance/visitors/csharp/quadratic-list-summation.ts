import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, isCSharpStringNode } from '../../../_shared/csharp-helpers.js'
import { CSHARP_LOOP_TYPES, isInsideCSharpLoop } from './_helpers.js'

/**
 * The classic C# StringBuilder rule: `s += "..."` in a loop copies the whole
 * accumulated string every iteration — O(n^2). Only fires when the right-hand
 * side is recognizably a string (literal, interpolated string, concatenation
 * containing a string, or .ToString() call); numeric `total += x` stays
 * silent.
 */
function containsStringNode(node: SyntaxNode): boolean {
  if (isCSharpStringNode(node)) return true
  for (const child of node.namedChildren) {
    if (child && containsStringNode(child)) return true
  }
  return false
}

function isStringLike(node: SyntaxNode): boolean {
  if (isCSharpStringNode(node)) return true
  if (node.type === 'binary_expression') return containsStringNode(node)
  if (node.type === 'invocation_expression') return getCSharpMethodName(node) === 'ToString'
  return false
}

/**
 * The += is not quadratic when the variable is freshly assigned earlier in
 * the same loop iteration (per-iteration line building) — mirror the Python
 * visitor's reset check.
 */
function isResetEarlierInLoop(node: SyntaxNode, varName: string): boolean {
  let loopBody: SyntaxNode | null = null
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'block' && current.parent && CSHARP_LOOP_TYPES.has(current.parent.type)) {
      loopBody = current
      break
    }
    current = current.parent
  }
  if (!loopBody) return false

  for (const child of loopBody.namedChildren) {
    if (!child || child.startIndex >= node.startIndex) break
    if (child.type === 'expression_statement') {
      const expr = child.namedChildren[0]
      if (expr?.type === 'assignment_expression' &&
          expr.childForFieldName('operator')?.text === '=' &&
          expr.childForFieldName('left')?.text === varName) {
        return true
      }
    }
    if (child.type === 'local_declaration_statement') {
      const decl = child.namedChildren.find((c) => c?.type === 'variable_declaration')
      const declarators = decl?.namedChildren.filter((c) => c?.type === 'variable_declarator') ?? []
      if (declarators.some((d) => d?.childForFieldName('name')?.text === varName)) return true
    }
  }
  return false
}

export const csharpQuadraticListSummationVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/quadratic-list-summation',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('operator')?.text !== '+=') return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    if (!isInsideCSharpLoop(node)) return null
    if (!isStringLike(right)) return null

    if (left.type === 'identifier' && isResetEarlierInLoop(node, left.text)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'String concatenation with += in loop',
      'Building a string with += in a loop copies the accumulated string on every iteration — O(n^2). Use a StringBuilder.',
      sourceCode,
      'Accumulate into a StringBuilder (sb.Append(...)) and call sb.ToString() after the loop, or use string.Join().',
    )
  },
}
