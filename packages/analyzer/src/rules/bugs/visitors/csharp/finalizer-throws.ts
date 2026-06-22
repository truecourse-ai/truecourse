import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'

/**
 * Find a `throw_statement` reachable from the finalizer body that is not inside
 * a `catch_clause` (a throw inside a catch is a rethrow that is presumably
 * handled by an outer try) and not inside the `try` block of a try/catch (the
 * surrounding catch can stop it). This keeps the rule to throws that genuinely
 * escape. Lambdas/local functions inside the finalizer have their own control
 * flow, so they are not descended into.
 */
function findEscapingThrow(node: SyntaxNode, insideGuardedTry: boolean): SyntaxNode | null {
  if (node.type === 'throw_statement' && !insideGuardedTry) return node

  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child || CSHARP_FUNCTION_BOUNDARIES.has(child.type)) continue

    if (child.type === 'try_statement') {
      const hasCatch = child.namedChildren.some((c) => c?.type === 'catch_clause')
      const block = child.childForFieldName('body') ?? child.namedChildren.find((c) => c?.type === 'block')
      // The guarded `try` block: a catch may stop the throw, so don't flag it.
      if (block) {
        const found = findEscapingThrow(block, insideGuardedTry || hasCatch)
        if (found) return found
      }
      // catch/finally clauses: a throw here escapes unless an outer try guards it.
      for (const clause of child.namedChildren) {
        if (clause?.type === 'catch_clause' || clause?.type === 'finally_clause') {
          const found = findEscapingThrow(clause, insideGuardedTry)
          if (found) return found
        }
      }
      continue
    }

    const found = findEscapingThrow(child, insideGuardedTry)
    if (found) return found
  }
  return null
}

/**
 * A finalizer (`~Type()`) that lets an exception escape. An unhandled exception
 * thrown from a finalizer is not caught by anyone — the runtime treats it as
 * unrecoverable and terminates the process. Finalizers must complete without
 * throwing; any exception has to be caught and swallowed inside the finalizer.
 */
export const csharpFinalizerThrowsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/finalizer-throws',
  languages: ['csharp'],
  nodeTypes: ['destructor_declaration'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const thrown = findEscapingThrow(body, false)
    if (!thrown) return null

    return makeViolation(
      this.ruleKey, thrown, filePath, 'high',
      'Finalizer can throw',
      'An exception that escapes a finalizer is uncatchable and terminates the process. A finalizer must never let an exception propagate.',
      sourceCode,
      'Wrap the failing work in a try/catch inside the finalizer and swallow (or log) the exception so it cannot escape.',
    )
  },
}
