import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'

/** Check if a node contains all-traffic port patterns: port=-1 or from_port=0+to_port=65535. */
function isAllTrafficPort(node: SyntaxNode): boolean {
  if (node.type === 'integer' && (node.text === '-1')) return true
  if (containsPythonIdentifierExact(node, 'ALL_TRAFFIC') || containsPythonIdentifierExact(node, 'all_traffic')) return true
  for (const child of node.namedChildren) {
    if (isAllTrafficPort(child)) return true
  }
  return false
}

/** Check if a node contains a wildcard CIDR (0.0.0.0/0 or ::/0) or Peer.any_ipv4/6(). */
function hasWildcardCidr(node: SyntaxNode): boolean {
  if (node.type === 'string') {
    const stripped = node.text.replace(/^['"]|['"]$/g, '')
    return stripped === '0.0.0.0/0' || stripped === '::/0'
  }
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

export const pythonAwsUnrestrictedOutboundVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unrestricted-outbound',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) funcName = attr.text
    }

    if (funcName !== 'add_egress_rule' && funcName !== 'authorize_security_group_egress') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Walk keyword arguments to detect all-traffic + wildcard patterns
    let foundAllTraffic = false
    let foundWildcard = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (!name || !value) continue

        const keyName = name.text
        if (keyName === 'port' || keyName === 'from_port' || keyName === 'to_port' ||
            keyName === 'ip_protocol' || keyName === 'connection') {
          if (isAllTrafficPort(value)) foundAllTraffic = true
        }
        if (keyName === 'peer' || keyName === 'cidr_ip' || keyName === 'cidr_ipv6' ||
            keyName === 'CidrIp' || keyName === 'CidrIpv6') {
          if (hasWildcardCidr(value)) foundWildcard = true
        }
      } else {
        // Positional arguments
        if (isAllTrafficPort(arg)) foundAllTraffic = true
        if (hasWildcardCidr(arg)) foundWildcard = true
      }
    }

    if (foundAllTraffic && foundWildcard) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Unrestricted outbound communications',
        'Security group allows all outbound traffic to any destination. This increases the blast radius of a compromise.',
        sourceCode,
        'Restrict egress rules to specific ports and destinations required by the application.',
      )
    }

    return null
  },
}
