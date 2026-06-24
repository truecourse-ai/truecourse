import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCreatedTypeName, lastSegment } from './_helpers.js'

/**
 * DSA from System.Security.Cryptography: `DSA.Create()` and the
 * `DSACryptoServiceProvider`/`DSACng`/`DSAOpenSsl` provider classes. DSA is a
 * weak asymmetric algorithm (small key sizes, SHA-1 signatures) and should be
 * replaced by RSA or ECDSA.
 */
const DSA_TYPES = new Set(['DSACryptoServiceProvider', 'DSACng', 'DSAOpenSsl'])

export const csharpUseOfDsaVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/use-of-dsa',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'object_creation_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'object_creation_expression') {
      if (!DSA_TYPES.has(getCreatedTypeName(node))) return null
    } else {
      if (getCSharpMethodName(node) !== 'Create') return null
      if (lastSegment(getCSharpReceiver(node)) !== 'DSA') return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Use of weak DSA algorithm',
      'DSA is a weak asymmetric algorithm (small key sizes and SHA-1 signatures). It should not protect sensitive data.',
      sourceCode,
      'Use RSA (RSA.Create) or ECDSA (ECDsa.Create) instead.',
    )
  },
}
