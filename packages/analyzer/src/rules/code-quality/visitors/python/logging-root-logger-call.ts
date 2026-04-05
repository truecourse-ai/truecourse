import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const ROOT_LOGGER_METHODS = new Set(['debug', 'info', 'warning', 'error', 'critical', 'exception', 'log'])

export const pythonLoggingRootLoggerCallVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/logging-root-logger-call',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text === 'logging' && attr && ROOT_LOGGER_METHODS.has(attr.text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Root logger call',
        `\`logging.${attr.text}()\` calls the root logger directly. Use a named logger via \`logging.getLogger(__name__)\` for proper log categorization.`,
        sourceCode,
        'Create a module-level logger: `logger = logging.getLogger(__name__)` and call `logger.' + attr.text + '(...)` instead.',
      )
    }

    return null
  },
}
