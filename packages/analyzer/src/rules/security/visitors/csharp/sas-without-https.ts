import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, lastSegment } from './_helpers.js'

/**
 * A storage shared access signature generated while explicitly allowing plain
 * HTTP: `GetSharedAccessSignature(..., protocols: SharedAccessProtocol.HttpsOrHttp)`.
 * A SAS is a bearer secret; permitting HTTP lets it travel in plaintext where
 * it can be intercepted. The SAS must be pinned to `HttpsOnly`.
 *
 * Keyed on the explicit `HttpsOrHttp` value (any argument position or the
 * named `protocols` argument) to stay zero-FP — the "protocol omitted"
 * overload is left to type-aware analysis.
 */

/** True when the value names `SharedAccessProtocol.HttpsOrHttp` (or bare `HttpsOrHttp`). */
function isHttpsOrHttp(value: SyntaxNode): boolean {
  if (value.type !== 'member_access_expression' && value.type !== 'identifier' && value.type !== 'qualified_name') {
    return false
  }
  return lastSegment(value.text) === 'HttpsOrHttp'
}

export const csharpSasWithoutHttpsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/sas-without-https',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'GetSharedAccessSignature') return null
    const hasHttp = getCallArgs(node).some((a) => isHttpsOrHttp(a.value))
    if (!hasHttp) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'SAS without HTTPS-only protocol',
      'This shared access signature allows plain HTTP (SharedAccessProtocol.HttpsOrHttp), so the bearer token can travel in plaintext and be intercepted.',
      sourceCode,
      'Generate the SAS with SharedAccessProtocol.HttpsOnly so the token is never sent over HTTP.',
    )
  },
}
