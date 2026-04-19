import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'

const ADMIN_PORTS = new Set(['22', '3389'])

/** Check if a keyword argument value contains an admin port number. */
function hasAdminPortValue(node: SyntaxNode): boolean {
  // Check for integer literal
  if (node.type === 'integer') {
    return ADMIN_PORTS.has(node.text)
  }
  // Check for Port enum: Port.SSH, Port.RDP
  if (containsPythonIdentifierExact(node, 'SSH') || containsPythonIdentifierExact(node, 'RDP')) {
    return true
  }
  // Recurse into children for nested structures
  for (const child of node.namedChildren) {
    if (hasAdminPortValue(child)) return true
  }
  return false
}

/** Check if a node contains a wildcard CIDR (0.0.0.0/0 or ::/0) or Peer.any_ipv4/6(). */
function hasWildcardCidr(node: SyntaxNode): boolean {
  if (node.type === 'string') {
    const stripped = node.text.replace(/^['"]|['"]$/g, '')
    return stripped === '0.0.0.0/0' || stripped === '::/0'
  }
  // Peer.any_ipv4() or Peer.any_ipv6()
  if (node.type === 'call') {
    const fn = node.childForFieldName('function')
    if (fn?.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr?.text === 'any_ipv4' || attr?.text === 'any_ipv6') return true
    }
  }
  for (const child of node.namedChildren) {
    if (hasWildcardCidr(child)) return true
  }
  return false
}

export const pythonAwsUnrestrictedAdminAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unrestricted-admin-access',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) funcName = attr.text
    } else if (fn.type === 'identifier') {
      funcName = fn.text
    }

    if (funcName !== 'add_ingress_rule' && funcName !== 'authorize_security_group_ingress' &&
        funcName !== 'SecurityGroup' && funcName !== 'CfnSecurityGroup') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Walk keyword arguments to find admin ports and wildcard CIDRs
    let foundAdminPort = false
    let foundWildcard = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (!name || !value) continue

        const keyName = name.text
        if (keyName === 'port' || keyName === 'from_port' || keyName === 'to_port' ||
            keyName === 'FromPort' || keyName === 'ToPort' || keyName === 'connection') {
          if (hasAdminPortValue(value)) foundAdminPort = true
        }
        if (keyName === 'peer' || keyName === 'cidr_ip' || keyName === 'cidr_ipv6' ||
            keyName === 'CidrIp' || keyName === 'CidrIpv6' || keyName === 'source_security_group' ||
            keyName === 'ip_protocol') {
          if (hasWildcardCidr(value)) foundWildcard = true
        }
      } else {
        // Positional arguments — check both conditions
        if (hasAdminPortValue(arg)) foundAdminPort = true
        if (hasWildcardCidr(arg)) foundWildcard = true
      }
    }

    if (foundAdminPort && foundWildcard) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unrestricted admin IP access',
        'Security group allows SSH/RDP access from any IP address (0.0.0.0/0). This exposes admin services to the internet.',
        sourceCode,
        'Restrict admin access to specific trusted IP ranges.',
      )
    }

    return null
  },
}
