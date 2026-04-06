import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnsafePickleUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-pickle-usage',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr) methodName = attr.text
      if (obj) objectName = obj.text
    }

    if (methodName !== 'loads' && methodName !== 'load') return null
    if (objectName !== 'pickle' && objectName !== 'cPickle' && objectName !== '_pickle') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'critical',
      'Unsafe pickle usage',
      `${objectName}.${methodName}() on untrusted data can execute arbitrary code.`,
      sourceCode,
      'Never deserialize pickle data from untrusted sources. Use JSON or a safe format instead.',
    )
  },
}
