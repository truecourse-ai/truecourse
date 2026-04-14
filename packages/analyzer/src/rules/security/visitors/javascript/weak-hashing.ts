import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const WEAK_ALGORITHMS = new Set(['md5', 'sha1'])

export const weakHashingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-hashing',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (methodName !== 'createHash') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const argText = firstArg.text.replace(/['"]/g, '').toLowerCase()
    if (WEAK_ALGORITHMS.has(argText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Weak hashing algorithm',
        `crypto.createHash('${argText}') uses a cryptographically weak algorithm.`,
        sourceCode,
        'Use SHA-256 or stronger (e.g., crypto.createHash("sha256")).',
      )
    }

    return null
  },
}
