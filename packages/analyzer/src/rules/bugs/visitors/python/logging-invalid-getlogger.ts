import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects logging.getLogger() called with invalid arguments.
 * It should be called with __name__ or a module-level string constant, not
 * with dynamic values like __file__ or computed expressions.
 */
export const pythonLoggingInvalidGetloggerVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/logging-invalid-getlogger',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    const funcText = func.text
    if (funcText !== 'logging.getLogger' && funcText !== 'getLogger') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter((a) => a.type !== 'keyword_argument')
    if (positionalArgs.length === 0) return null // getLogger() with no args is fine

    const arg = positionalArgs[0]

    // __name__ is the correct way
    if (arg.type === 'identifier' && arg.text === '__name__') return null
    // String literals are okay (module names)
    if (arg.type === 'string') return null
    // None is also okay
    if (arg.type === 'none') return null

    // __file__ is invalid — commonly used by mistake
    if (arg.type === 'identifier' && (arg.text === '__file__' || arg.text === '__spec__')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Invalid getLogger argument',
        `\`logging.getLogger(${arg.text})\` uses an invalid argument — \`${arg.text}\` is not a valid logger name. Use \`__name__\` instead.`,
        sourceCode,
        'Use `logging.getLogger(__name__)` to get a properly named logger for the current module.',
      )
    }

    return null
  },
}
