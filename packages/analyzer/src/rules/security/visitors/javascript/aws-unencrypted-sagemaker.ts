import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsUnencryptedSageMakerVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-sagemaker',
  languages: ['typescript', 'javascript'],
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const ctor = node.childForFieldName('constructor')
    if (!ctor) return null

    let ctorName = ''
    if (ctor.type === 'identifier') {
      ctorName = ctor.text
    } else if (ctor.type === 'member_expression') {
      const prop = ctor.childForFieldName('property')
      if (prop) ctorName = prop.text
    }

    if (ctorName !== 'CfnNotebookInstance' && ctorName !== 'NotebookInstance') return null

    const nodeText = node.text
    if (!/kmsKeyId|kmsKey/i.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted SageMaker notebook',
        `new ${ctorName}() does not specify a KMS key. Notebook storage is unencrypted.`,
        sourceCode,
        'Add kmsKeyId (for CfnNotebookInstance) or kmsKey to encrypt the SageMaker notebook instance.',
      )
    }

    return null
  },
}
