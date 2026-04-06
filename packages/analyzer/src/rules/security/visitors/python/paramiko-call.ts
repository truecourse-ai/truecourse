import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonParamikoCallVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/paramiko-call',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    }

    if (methodName !== 'connect') return null

    // Check if the object's text suggests paramiko (e.g., client, ssh, paramiko)
    const nodeText = node.text
    if (!nodeText.includes('paramiko') && !nodeText.includes('SSHClient') && !nodeText.includes('client')) {
      return null
    }

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check if look_for_keys or allow_agent are explicitly disabled along with missing host key check
    let hasAutoAddPolicy = false
    let parent = node.parent
    let depth = 0
    while (parent && depth < 10) {
      if (parent.text.includes('AutoAddPolicy') || parent.text.includes('WarningPolicy')) {
        hasAutoAddPolicy = true
        break
      }
      parent = parent.parent
      depth++
    }

    if (hasAutoAddPolicy) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Paramiko without host key verification',
        'Paramiko SSH client is connecting without strict host key verification (AutoAddPolicy or WarningPolicy).',
        sourceCode,
        'Use RejectPolicy or explicitly load known_hosts: client.load_system_host_keys().',
      )
    }

    return null
  },
}
