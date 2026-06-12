import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, getCreatedTypeName, isStringNode, staticStringText } from './_helpers.js'

/**
 * Server bound to every interface: a `0.0.0.0` URL passed to
 * UseUrls/Run/Listen, or `IPAddress.Any`/`IPv6Any` handed to socket
 * binding APIs.
 */
const URL_BIND_METHODS = new Set(['UseUrls', 'Run', 'RunAsync', 'Listen', 'Start'])
const SOCKET_BIND_METHODS = new Set(['Listen', 'Bind'])
const SOCKET_BIND_TYPES = new Set(['TcpListener', 'IPEndPoint', 'UdpClient'])

function isAnyAddress(node: SyntaxNode): boolean {
  if (node.type !== 'member_access_expression') return false
  const recv = node.childForFieldName('expression')?.text ?? ''
  const name = node.childForFieldName('name')?.text ?? ''
  return /(?:^|\.)IPAddress$/.test(recv) && (name === 'Any' || name === 'IPv6Any')
}

export const csharpBindAllInterfacesVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/bind-all-interfaces',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'object_creation_expression'],
  visit(node, filePath, sourceCode) {
    const isCreation = node.type === 'object_creation_expression'
    const callee = isCreation ? getCreatedTypeName(node) : getCSharpMethodName(node)
    const args = getCallArgs(node)

    if (!isCreation && URL_BIND_METHODS.has(callee)) {
      const zeroUrl = args.find((a) => isStringNode(a.value) && staticStringText(a.value).includes('0.0.0.0'))
      if (zeroUrl) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Server binding to all interfaces',
          `${callee}() binds to 0.0.0.0, exposing the service on every network interface.`,
          sourceCode,
          'Bind to localhost (or a specific interface) and front the service with a reverse proxy, or make the host configurable.',
        )
      }
    }

    const acceptsEndpoint = isCreation ? SOCKET_BIND_TYPES.has(callee) : SOCKET_BIND_METHODS.has(callee)
    if (acceptsEndpoint) {
      const anyArg = args.find((a) => isAnyAddress(a.value))
      if (anyArg) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Server binding to all interfaces',
          `${isCreation ? 'new ' + callee : callee}() binds to IPAddress.Any, exposing the listener on every network interface.`,
          sourceCode,
          'Bind to IPAddress.Loopback or a specific interface unless external exposure is intended.',
        )
      }
    }

    return null
  },
}
