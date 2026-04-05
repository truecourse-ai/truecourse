import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const s3PublicBucketAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/s3-public-bucket-access',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (methodName !== 'putPublicAccessBlock') return null

    // Search the full call text for BlockPublicAcls or BlockPublicPolicy set to false
    const callText = node.text
    const falseBlockMatch = /BlockPublicAcls\s*:\s*false|BlockPublicPolicy\s*:\s*false/.exec(callText)
    if (falseBlockMatch) {
      const key = falseBlockMatch[0].split(':')[0].trim()
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'S3 bucket with public access enabled',
        `S3 putPublicAccessBlock with ${key}: false allows public access to the bucket.`,
        sourceCode,
        'Set BlockPublicAcls and BlockPublicPolicy to true to block all public access.',
      )
    }

    return null
  },
}
