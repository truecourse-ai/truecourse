import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonStaticJoinToFstringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/static-join-to-fstring',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Detect "".join(["static", var, "parts"]) or "sep".join([...]) with static strings
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || attr.text !== 'join') return null

    const sep = fn.childForFieldName('object')
    if (!sep || sep.type !== 'string') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const arg = args.namedChildren[0]
    if (!arg || arg.type !== 'list') return null

    // Check if list contains at least one non-string element (variable)
    const hasVar = arg.namedChildren.some((c) => c.type !== 'string')
    if (!hasVar) {
      // All static strings — can just concatenate
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Static string join',
        '`"".join()` on all static strings — use string concatenation or a single string literal.',
        sourceCode,
        'Replace with a single string literal.',
      )
    }

    // Has variables: "".join([...]) with mix → f-string
    if (sep.text === '""' || sep.text === "''") {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Static join to f-string',
        '`"".join([..., var, ...])` can be replaced with an f-string for clarity.',
        sourceCode,
        'Replace with an f-string.',
      )
    }

    return null
  },
}
