import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSslVersionUnsafeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/ssl-version-unsafe',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (!left || !right) return null

    // ctx.minimum_version = ssl.TLSVersion.TLSv1 or TLSv1_1
    if (left.type === 'attribute') {
      const attr = left.childForFieldName('attribute')
      if (attr?.text === 'minimum_version') {
        const val = right.text
        if (val.includes('TLSv1_1') || (val.includes('TLSv1') && !val.includes('TLSv1_2') && !val.includes('TLSv1_3'))) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Unsafe SSL/TLS minimum version',
            `Setting minimum TLS version to ${val}. TLS 1.0 and 1.1 are deprecated.`,
            sourceCode,
            'Set minimum_version to ssl.TLSVersion.TLSv1_2 or higher.',
          )
        }
      }
    }

    return null
  },
}
