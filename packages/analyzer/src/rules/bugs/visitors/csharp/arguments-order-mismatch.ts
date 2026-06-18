import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const HAYSTACK_NEEDLE_METHODS = new Set(['StartsWith', 'EndsWith', 'Contains', 'IndexOf'])

/**
 * `value.StartsWith(value)` — the argument is the receiver itself, so the
 * check is vacuously true. Usually a copy-paste slip where a different
 * variable (the prefix/needle) was intended.
 */
export const csharpArgumentsOrderMismatchVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/arguments-order-mismatch',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null

    const method = fn.childForFieldName('name')?.text ?? ''
    if (!HAYSTACK_NEEDLE_METHODS.has(method)) return null

    const receiver = fn.childForFieldName('expression')
    if (!receiver || (receiver.type !== 'identifier' && receiver.type !== 'member_access_expression')) return null

    const firstArg = node.childForFieldName('arguments')?.namedChildren[0]?.namedChildren[0]
    if (!firstArg || (firstArg.type !== 'identifier' && firstArg.type !== 'member_access_expression')) return null

    if (firstArg.text !== receiver.text) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Arguments in wrong order',
      `\`${node.text}\` passes the receiver itself to \`.${method}()\` — the check is always true. A different argument was probably intended.`,
      sourceCode,
      `Pass the intended needle/prefix: \`${receiver.text}.${method}(other)\`.`,
    )
  },
}
