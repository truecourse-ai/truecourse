import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonLoggingConfigInsecureListenVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/logging-config-insecure-listen',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type !== 'attribute') return null
    const attr = fn.childForFieldName('attribute')
    const obj = fn.childForFieldName('object')

    if (attr?.text !== 'listen') return null

    // Check parent object is logging.config or config
    const objText = obj?.text ?? ''
    if (!objText.includes('config') && !objText.includes('logging')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Insecure logging config listener',
      `${objText}.listen() opens a network socket that can receive and apply arbitrary logging configuration.`,
      sourceCode,
      'Avoid logging.config.listen(). Use file-based configuration or authenticated configuration endpoints.',
    )
  },
}
