import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Normalize a condition's text for comparison (collapse insignificant whitespace). */
function normalize(node: SyntaxNode): string {
  return node.text.replace(/\s+/g, ' ').trim()
}

/** All identifier names referenced anywhere in a subtree. */
function identifiersIn(node: SyntaxNode, out: Set<string>): void {
  if (node.type === 'identifier') out.add(node.text)
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child) identifiersIn(child, out)
  }
}

/**
 * Whether the first `if` body could change the value the condition tests, by
 * assigning or incrementing/decrementing an identifier that the condition reads,
 * or by calling a method on such a receiver (which could mutate it). Only then
 * is re-checking the same condition legitimate, so we bail out.
 */
function mayChangeCondition(body: SyntaxNode, conditionNames: Set<string>): boolean {
  let result = false
  const walk = (node: SyntaxNode): void => {
    if (result) return
    if (node.type === 'assignment_expression') {
      const names = new Set<string>()
      const left = node.childForFieldName('left')
      if (left) identifiersIn(left, names)
      if ([...names].some((n) => conditionNames.has(n))) { result = true; return }
    }
    if (node.type === 'postfix_unary_expression' || node.type === 'prefix_unary_expression') {
      const names = new Set<string>()
      identifiersIn(node, names)
      if ([...names].some((n) => conditionNames.has(n))) { result = true; return }
    }
    if (node.type === 'invocation_expression') {
      // A call whose receiver is one of the condition identifiers may mutate it.
      const fn = node.childForFieldName('function')
      if (fn?.type === 'member_access_expression') {
        const recv = fn.childForFieldName('expression')
        const names = new Set<string>()
        if (recv) identifiersIn(recv, names)
        if ([...names].some((n) => conditionNames.has(n))) { result = true; return }
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child) walk(child)
    }
  }
  walk(body)
  return result
}

/**
 * Two consecutive `if` statements testing the identical condition, where the
 * first has no `else` branch and the first body cannot change the value tested.
 * The second check is then guaranteed to have the same result — it is redundant
 * or, more likely, a logic mistake where a different condition was intended.
 *
 * Bailing out when the first `if` has an `else`, or its body has any side
 * effect (call/assignment/increment) that could flip the condition, keeps the
 * rule free of false positives.
 */
export const csharpSequentialSameConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/sequential-same-condition',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Only consider the first of a pair to avoid double-reporting.
    if (node.parent?.type !== 'block') return null

    // An `else` (this if being an alternative) means it is part of a chain.
    if (node.childForFieldName('alternative')) return null

    const condition = node.childForFieldName('condition')
    const consequence = node.childForFieldName('consequence')
    if (!condition || !consequence) return null

    // Next statement sibling in the same block.
    let next: SyntaxNode | null = node.nextNamedSibling
    while (next && next.type === 'comment') next = next.nextNamedSibling
    if (next?.type !== 'if_statement') return null

    const nextCondition = next.childForFieldName('condition')
    if (!nextCondition) return null
    if (normalize(condition) !== normalize(nextCondition)) return null

    const conditionNames = new Set<string>()
    identifiersIn(condition, conditionNames)
    if (mayChangeCondition(consequence, conditionNames)) return null

    return makeViolation(
      this.ruleKey, next, filePath, 'low',
      'Sequential checks on the same condition',
      'This `if` repeats the condition of the immediately preceding `if`, whose body cannot change the result — the second check is redundant or a logic mistake.',
      sourceCode,
      'Merge the two branches, or fix the second condition if a different test was intended.',
    )
  },
}
