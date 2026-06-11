import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isStringNode, staticStringText } from './_helpers.js'

/**
 * Reading X-Forwarded-For straight off the headers — the header is
 * client-controlled. ASP.NET's ForwardedHeaders middleware (which validates
 * KnownProxies) populates Connection.RemoteIpAddress safely.
 */
export const csharpIpForwardingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/ip-forwarding',
  languages: ['csharp'],
  nodeTypes: ['element_access_expression'],
  visit(node, filePath, sourceCode) {
    const receiver = node.childForFieldName('expression') ?? node.namedChildren[0]
    if (!receiver || !/\.Headers$|^Headers$/.test(receiver.text)) return null

    const argList = node.namedChildren.find((c) => c?.type === 'bracketed_argument_list')
    const index = argList?.namedChildren[0]?.namedChildren[0]
    if (!index || !isStringNode(index)) return null
    if (staticStringText(index).toLowerCase() !== 'x-forwarded-for') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Untrusted IP forwarding header',
      'X-Forwarded-For is read directly from request headers — clients can spoof it.',
      sourceCode,
      'Configure UseForwardedHeaders() with KnownProxies and read HttpContext.Connection.RemoteIpAddress instead.',
    )
  },
}
