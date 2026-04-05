import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const s3UnrestrictedAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/s3-unrestricted-access',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    // Use raw text for pattern matching to preserve inner double quotes
    const raw = node.text

    // Detect JSON bucket policy with wildcard principal
    if (raw.includes('"Principal"') && (raw.includes('"*"') || raw.includes(': "*"') || raw.includes(':"*"'))) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'S3 bucket policy with wildcard principal',
        'S3 bucket policy grants access to all principals (*), making the bucket publicly accessible.',
        sourceCode,
        'Restrict the Principal to specific AWS accounts or IAM roles.',
      )
    }

    return null
  },
}
