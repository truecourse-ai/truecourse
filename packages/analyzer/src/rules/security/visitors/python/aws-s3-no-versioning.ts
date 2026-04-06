import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwsS3NoVersioningVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-s3-no-versioning-python',
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

    if (funcName !== 'Bucket' && funcName !== 'CfnBucket') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Flag if versioning is disabled or absent
    const nodeText = node.text
    if (/versioning.*VersioningConfiguration.*Status.*Suspended/i.test(nodeText) ||
        /versioning_configuration.*status.*"suspended"/i.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'S3 bucket without versioning',
        `${funcName}() configured with versioning suspended. Objects cannot be recovered after accidental deletion.`,
        sourceCode,
        'Enable versioning: set versioning=BucketVersioning.ENABLED.',
      )
    }

    return null
  },
}
