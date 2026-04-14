import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsUnrestrictedAdminIpVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unrestricted-admin-ip',
  languages: ['typescript', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (methodName !== 'addIngressRule') return null

    const args = node.childForFieldName('arguments')
    if (!args || args.namedChildren.length < 2) return null

    const nodeText = node.text

    // Check for 0.0.0.0/0 or ::/0 (AnyIpv4/AnyIpv6)
    const hasOpenIngress = /AnyIpv4|AnyIpv6|Peer\.anyIpv4|Peer\.anyIpv6|0\.0\.0\.0\/0|::\/0/.test(nodeText)
    if (!hasOpenIngress) return null

    // Check for SSH (port 22) or RDP (port 3389)
    const hasAdminPort = /Port\.tcp\(22\)|Port\.tcp\(3389\)|allTraffic|tcp\(22\)|tcp\(3389\)/.test(nodeText)
    if (!hasAdminPort) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unrestricted admin IP access',
      'Security group addIngressRule() allows SSH/RDP (port 22/3389) from 0.0.0.0/0. This exposes admin ports to the internet.',
      sourceCode,
      'Restrict SSH/RDP access to specific known IP ranges instead of 0.0.0.0/0.',
    )
  },
}
