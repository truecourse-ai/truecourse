import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, THROWABLE_TYPES } from './_helpers.js'

export const onlyThrowErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/only-throw-error',
  languages: JS_LANGUAGES,
  nodeTypes: ['throw_statement'],
  visit(node, filePath, sourceCode) {
    const argument = node.namedChildren[0]
    if (!argument) return null

    // Flag if throwing a literal value (not a `new Error(...)` or Error subclass)
    if (THROWABLE_TYPES.has(argument.type)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Non-Error thrown',
        `\`throw ${argument.text}\` throws a non-Error value — callers cannot get a stack trace from it.`,
        sourceCode,
        `Replace with \`throw new Error(${argument.type === 'string' ? argument.text : '"Error message"'})\`.`,
      )
    }

    // Also flag throw with a plain object literal (not Error)
    if (argument.type === 'object') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Non-Error thrown',
        'Throwing a plain object instead of an Error — callers cannot get a stack trace.',
        sourceCode,
        'Use `new Error("message")` or a subclass of Error.',
      )
    }

    return null
  },
}
