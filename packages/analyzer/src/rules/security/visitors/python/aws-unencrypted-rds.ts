import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwsUnencryptedRdsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-rds-python',
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

    if (funcName !== 'DatabaseInstance' && funcName !== 'CfnDBInstance') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'storage_encrypted' && value?.text === 'False') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Unencrypted RDS database',
            `${funcName}() created with storage_encrypted=False. Database data at rest is unprotected.`,
            sourceCode,
            'Set storage_encrypted=True to enable RDS storage encryption.',
          )
        }
      }
    }

    return null
  },
}
