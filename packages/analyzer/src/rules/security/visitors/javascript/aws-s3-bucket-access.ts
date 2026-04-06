import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsS3BucketAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-s3-bucket-access',
  languages: ['typescript', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      const obj = fn.childForFieldName('object')
      if (prop) methodName = prop.text
      if (obj) objectName = obj.text
    }

    if (methodName !== 'grantPublicAccess') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Overly permissive S3 bucket',
      `${objectName ? objectName + '.' : ''}grantPublicAccess() grants read access to all internet users.`,
      sourceCode,
      'Remove grantPublicAccess(). Use presigned URLs or CloudFront with OAI instead.',
    )
  },
}
