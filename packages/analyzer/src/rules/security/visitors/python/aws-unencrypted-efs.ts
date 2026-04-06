import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwsUnencryptedEfsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-efs-python',
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

    if (funcName !== 'FileSystem' && funcName !== 'CfnFileSystem') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    let hasEncryption = false
    let encryptedFalse = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'encrypted') {
          hasEncryption = true
          if (value?.text === 'False') encryptedFalse = true
        }
      }
    }

    if (encryptedFalse || !hasEncryption) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted EFS file system',
        `${funcName}() created without encryption at rest. File system data is unprotected.`,
        sourceCode,
        'Add encrypted=True to enable EFS encryption at rest.',
      )
    }

    return null
  },
}
