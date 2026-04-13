import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'

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
        // Check for deprecated TLS versions via AST identifier matching
        const isUnsafe =
          containsPythonIdentifierExact(right, 'TLSv1_1') ||
          containsPythonIdentifierExact(right, 'PROTOCOL_TLSv1') ||
          containsPythonIdentifierExact(right, 'PROTOCOL_TLSv1_1') ||
          (containsPythonIdentifierExact(right, 'TLSv1') &&
           !containsPythonIdentifierExact(right, 'TLSv1_2') &&
           !containsPythonIdentifierExact(right, 'TLSv1_3'))
        if (isUnsafe) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Unsafe SSL/TLS minimum version',
            `Setting minimum TLS version to ${right.text}. TLS 1.0 and 1.1 are deprecated.`,
            sourceCode,
            'Set minimum_version to ssl.TLSVersion.TLSv1_2 or higher.',
          )
        }
      }
    }

    return null
  },
}
