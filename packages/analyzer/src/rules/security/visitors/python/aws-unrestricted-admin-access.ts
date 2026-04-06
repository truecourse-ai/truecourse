import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

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

    const nodeText = node.text
    const hasAdminPort = /port.*(?:22|3389)|from_port.*(?:22|3389)|to_port.*(?:22|3389)/i.test(nodeText)
    const hasWildcard = nodeText.includes('0.0.0.0/0') || nodeText.includes('::/0') ||
      nodeText.includes('Peer.any_ipv4()') || nodeText.includes('Peer.any_ipv6()')

    if (hasAdminPort && hasWildcard) {
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
