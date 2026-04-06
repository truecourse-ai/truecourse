import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsS3InsecureHttpVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-s3-insecure-http',
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

    // Only apply if this looks like an S3 Bucket (not some other Bucket construct)
    if (!/s3\.|S3\.|aws-s3|aws_s3/i.test(nodeText) && !/versioned|removalPolicy|encryption|blockPublicAccess|enforceSSL/i.test(nodeText)) {
      return null
    }

    if (/enforceSSL\s*:\s*false/i.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'S3 bucket insecure HTTP',
        `new Bucket() has enforceSSL: false. HTTP requests to the bucket are permitted.`,
        sourceCode,
        'Set enforceSSL: true to deny HTTP requests and require HTTPS.',
      )
    }

    if (!/enforceSSL/.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'S3 bucket insecure HTTP',
        `new Bucket() does not set enforceSSL: true. HTTP access to the bucket may be allowed.`,
        sourceCode,
        'Add enforceSSL: true to the S3 Bucket construct to require HTTPS.',
      )
    }

    return null
  },
}
