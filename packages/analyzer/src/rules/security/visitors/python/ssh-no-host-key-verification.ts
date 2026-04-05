import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSshNoHostKeyVerificationVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/ssh-no-host-key-verification',
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

    // paramiko: client.set_missing_host_key_policy(AutoAddPolicy())
    if (methodName === 'set_missing_host_key_policy') {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          const argText = arg.text
          if (argText.includes('AutoAddPolicy') || argText.includes('WarningPolicy')) {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'SSH without host key verification',
              `set_missing_host_key_policy(${argText}) bypasses host key verification, enabling MITM attacks.`,
              sourceCode,
              'Use RejectPolicy or known_hosts verification: client.set_missing_host_key_policy(paramiko.RejectPolicy()).',
            )
          }
        }
      }
    }

    // fabric/asyncssh: connect(host, known_hosts=None)
    if (methodName === 'connect' || methodName === 'SSHClient') {
      const args = node.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          if (arg.type === 'keyword_argument') {
            const name = arg.childForFieldName('name')
            const value = arg.childForFieldName('value')
            if ((name?.text === 'known_hosts' || name?.text === 'check_host_keys') &&
                (value?.text === 'None' || value?.text === "'ignore'" || value?.text === '"ignore"')) {
              return makeViolation(
                this.ruleKey, node, filePath, 'high',
                'SSH without host key verification',
                `SSH connection with ${name.text}=${value.text} disables host key verification.`,
                sourceCode,
                'Provide a known_hosts file for host key verification.',
              )
            }
          }
        }
      }
    }

    return null
  },
}
