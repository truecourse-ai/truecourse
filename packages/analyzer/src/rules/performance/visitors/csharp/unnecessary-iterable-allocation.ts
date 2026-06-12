import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver, walkCSharp } from '../../../_shared/csharp-helpers.js'
import { getCSharpChainRoot } from './_helpers.js'

/**
 * `foreach (var x in xs.Where(...).ToList())` — the ToList()/ToArray() copies
 * the sequence into a list only to enumerate it once. Skipped when the body
 * mutates the source collection: there the snapshot is intentional (avoids
 * "Collection was modified" at runtime).
 */
const MATERIALIZERS = new Set(['ToList', 'ToArray'])
const MUTATING_METHODS = new Set([
  'Add', 'AddRange', 'Insert', 'InsertRange',
  'Remove', 'RemoveAt', 'RemoveAll', 'RemoveRange', 'Clear',
])

function bodyMutatesCollection(body: SyntaxNode, collectionText: string): boolean {
  let mutates = false
  walkCSharp(body, (n: SyntaxNode) => {
    if (mutates) return
    if (n.type === 'invocation_expression') {
      if (MUTATING_METHODS.has(getCSharpMethodName(n)) && getCSharpReceiver(n) === collectionText) {
        mutates = true
      }
      return
    }
    // dict[key] = ... / list[i] = ... on the source collection
    if (n.type === 'assignment_expression') {
      const left = n.childForFieldName('left')
      if (left?.type === 'element_access_expression' &&
          left.childForFieldName('expression')?.text === collectionText) {
        mutates = true
      }
    }
  })
  return mutates
}

export const csharpUnnecessaryIterableAllocationVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/unnecessary-iterable-allocation',
  languages: ['csharp'],
  nodeTypes: ['foreach_statement'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (right?.type !== 'invocation_expression') return null
    const method = getCSharpMethodName(right)
    if (!MATERIALIZERS.has(method)) return null
    if (getCSharpArguments(right).length !== 0) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const root = getCSharpChainRoot(right)
    if ((root.type === 'identifier' || root.type === 'member_access_expression') &&
        bodyMutatesCollection(body, root.text)) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `${method}() in foreach header`,
      `${method}() copies the whole sequence into memory before the foreach enumerates it once. Enumerate the sequence directly.`,
      sourceCode,
      `Remove the ${method}() call and iterate the sequence lazily.`,
    )
  },
}
