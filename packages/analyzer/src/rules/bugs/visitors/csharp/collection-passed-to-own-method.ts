import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Mutating collection methods that take another collection of the same kind.
 * Passing a collection to one of these on itself (`list.AddRange(list)`,
 * `set.UnionWith(set)`) is undefined, a no-op, or an infinite loop depending on
 * the implementation — never the intent.
 */
const SELF_MUTATING_METHODS = new Set([
  'AddRange',
  'InsertRange',
  'UnionWith',
  'IntersectWith',
  'ExceptWith',
  'SymmetricExceptWith',
])

/**
 * `collection.Method(collection)` where the receiver and the sole argument are
 * the syntactically identical collection expression and `Method` mutates the
 * collection using another one. To avoid false positives the receiver must be a
 * plain identifier or member access (no call), so we are comparing the same
 * stable reference, not two calls that happen to read the same way.
 */
export const csharpCollectionPassedToOwnMethodVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/collection-passed-to-own-method',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const method = fn.childForFieldName('name')?.text
    if (!method || !SELF_MUTATING_METHODS.has(method)) return null

    const receiver = fn.childForFieldName('expression')
    if (!receiver) return null
    if (receiver.type !== 'identifier' && receiver.type !== 'member_access_expression') return null
    if (receiver.text.includes('(')) return null

    const args = node.childForFieldName('arguments')?.namedChildren.filter((c) => c?.type === 'argument') ?? []
    if (args.length !== 1) return null
    const argExpr = args[0]!.namedChildren[0]
    if (!argExpr || argExpr.text !== receiver.text) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Collection passed to its own method',
      `\`${node.text}\` passes \`${receiver.text}\` to its own \`${method}\` — operating a collection against itself is undefined or a no-op.`,
      sourceCode,
      'Pass a different collection, or remove the call if it was unintended.',
    )
  },
}
