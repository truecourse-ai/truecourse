import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonLoggingDirectInstantiationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/logging-direct-instantiation',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text === 'logging' && attr?.text === 'Logger') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Direct logger instantiation',
        '`logging.Logger()` should not be instantiated directly. Use `logging.getLogger(__name__)` instead to go through the logging configuration system.',
        sourceCode,
        'Replace `logging.Logger(...)` with `logging.getLogger(__name__)`.',
      )
    }

    return null
  },
}
