import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsS3PublicAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-s3-public-access',
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

    if (ctorName !== 'Bucket') return null

    const nodeText = node.text

    // Only apply to S3 buckets that have some AWS CDK S3 characteristics
    if (!/versioned|removalPolicy|encryption|blockPublicAccess|enforceSSL|accessControl/i.test(nodeText) &&
        !/s3\.|S3\.|aws-s3/i.test(nodeText)) {
      return null
    }

    // Flag if accessControl is set to a public value
    if (/accessControl\s*:\s*BucketAccessControl\.PUBLIC_READ|accessControl\s*:\s*BucketAccessControl\.PUBLIC_READ_WRITE|accessControl\s*:\s*BucketAccessControl\.AUTHENTICATED_READ/.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'S3 bucket public access',
        'S3 Bucket configured with a public accessControl ACL. The bucket contents may be publicly readable.',
        sourceCode,
        'Remove the public accessControl setting and use blockPublicAccess: BlockPublicAccess.BLOCK_ALL.',
      )
    }

    // Flag if blockPublicAccess is absent
    if (!/blockPublicAccess/.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'S3 bucket public access',
        `new Bucket() does not set blockPublicAccess. Public ACLs and policies may be applied to the bucket.`,
        sourceCode,
        'Add blockPublicAccess: BlockPublicAccess.BLOCK_ALL to the S3 Bucket construct.',
      )
    }

    return null
  },
}
