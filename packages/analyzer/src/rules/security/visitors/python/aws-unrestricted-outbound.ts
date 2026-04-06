import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

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

    const nodeText = node.text
    const hasAllTraffic = nodeText.includes('ALL_TRAFFIC') || nodeText.includes('all_traffic') ||
      /port.*-1|from_port.*0.*to_port.*65535/i.test(nodeText)
    const hasWildcard = nodeText.includes('0.0.0.0/0') || nodeText.includes('::/0') ||
      nodeText.includes('Peer.any_ipv4()') || nodeText.includes('Peer.any_ipv6()')

    if (hasAllTraffic && hasWildcard) {
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
