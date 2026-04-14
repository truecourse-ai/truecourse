import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const literalCallVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/literal-call',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    const LITERAL_CALL_TYPES = new Set(['number', 'string', 'true', 'false', 'null', 'undefined', 'template_string'])

    if (LITERAL_CALL_TYPES.has(fn.type)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Literal used as function',
        `\`${fn.text}\` is a ${fn.type} literal, not a function — calling it will throw a TypeError.`,
        sourceCode,
        'Replace the literal with the intended function reference.',
      )
    }

    return null
  },
}
