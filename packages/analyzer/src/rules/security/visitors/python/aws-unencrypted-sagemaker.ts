import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwsUnencryptedSageMakerVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-sagemaker-python',
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

    if (funcName !== 'CfnNotebookInstance' && funcName !== 'NotebookInstance') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Flag if kms_key_id is absent
    let hasKmsKey = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        if (name?.text === 'kms_key_id' || name?.text === 'kms_key') {
          hasKmsKey = true
        }
      }
    }

    if (!hasKmsKey) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted SageMaker notebook',
        `${funcName}() created without a KMS key. Notebook instance data is not encrypted.`,
        sourceCode,
        'Provide a kms_key_id to encrypt the SageMaker notebook instance.',
      )
    }

    return null
  },
}
