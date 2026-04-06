import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_WEAK_HASH = new Set(['md5', 'sha1'])

export const pythonWeakHashingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-hashing',
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

    if (objectName === 'hashlib' && PYTHON_WEAK_HASH.has(methodName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Weak hashing algorithm',
        `hashlib.${methodName}() uses a cryptographically weak algorithm.`,
        sourceCode,
        'Use hashlib.sha256() or stronger.',
      )
    }

    return null
  },
}
