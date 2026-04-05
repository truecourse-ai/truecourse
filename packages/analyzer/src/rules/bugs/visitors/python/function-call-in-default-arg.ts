import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { SAFE_DEFAULT_CALLS } from './_helpers.js'

export const pythonFunctionCallInDefaultArgVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/function-call-in-default-argument',
  languages: ['python'],
  nodeTypes: ['default_parameter', 'typed_default_parameter'],
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    if (!value || value.type !== 'call') return null

    const fn = value.childForFieldName('function')
    if (!fn) return null

    // Allow known safe calls like list(), dict(), etc. (although they'd be caught by mutable-default-arg)
    if (fn.type === 'identifier' && SAFE_DEFAULT_CALLS.has(fn.text)) return null

    // Flag any other function call — it runs once at definition time
    const paramName = node.childForFieldName('name')?.text ?? 'parameter'
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Function call in default argument',
      `Default value for \`${paramName}\` is a function call \`${value.text}\` — this is evaluated once when the function is defined, not on each call.`,
      sourceCode,
      `Use \`${paramName}=None\` and call the function inside the function body: \`if ${paramName} is None: ${paramName} = ${value.text}\`.`,
    )
  },
}
