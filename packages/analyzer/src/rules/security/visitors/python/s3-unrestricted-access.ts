import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonS3UnrestrictedAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/s3-unrestricted-access',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const val = node.text.replace(/^[rRbBuU]*['"`]{1,3}|['"`]{1,3}$/g, '')

    if (val.includes('"Principal"') && val.includes('"*"')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'S3 bucket policy with wildcard principal',
        'S3 bucket policy string contains a wildcard principal (*), granting public access.',
        sourceCode,
        'Restrict the Principal to specific AWS accounts or IAM roles.',
      )
    }

    return null
  },
}
