import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwsUnencryptedEbsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-ebs-python',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) funcName = attr.text
    }

    if (funcName !== 'Volume' && funcName !== 'CfnVolume') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check for encrypted=False or missing encrypted keyword arg
    let hasEncrypted = false
    let encryptedFalse = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'encrypted') {
          hasEncrypted = true
          if (value?.text === 'False') encryptedFalse = true
        }
      }
    }

    if (encryptedFalse || (!hasEncrypted && (funcName === 'Volume' || funcName === 'CfnVolume'))) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted EBS volume',
        `${funcName}() created without encryption. Data at rest is unprotected.`,
        sourceCode,
        'Add encrypted=True to encrypt the EBS volume.',
      )
    }

    return null
  },
}
